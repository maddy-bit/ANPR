/**
 * Video Upload Service
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../../config/env');
const uploadRepo = require('./upload.repository');
const s3Storage = require('./s3-storage');
const { isValidVideo } = require('../../utils/video-validator');
const logger = require('../../config/logger');

const VIDEO_MIME_BY_EXTENSION = Object.freeze({
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
});

function getVideoMimeType(filename) {
  const extension = path.extname(String(filename || '')).toLowerCase();
  return VIDEO_MIME_BY_EXTENSION[extension] || null;
}

function ensureUploadDir() {
  const dir = config.storage.localDir;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

async function processUpload(file, cameraId) {
  if (!file) {
    const err = new Error('Upload file is empty or missing');
    err.status = 400;
    throw err;
  }

  const maxBytes = config.storage.maxFileSizeMb * 1024 * 1024;
  if (file.size > maxBytes) {
    const err = new Error(`Video file exceeds maximum allowed size of ${config.storage.maxFileSizeMb} MB`);
    err.status = 413;
    throw err;
  }

  // Allow only video extensions and validate the actual binary container as well.
  // Client-provided MIME types are untrusted and are never persisted as the response Content-Type.
  const extension = path.extname(file.originalname || '').toLowerCase();
  const mimeType = getVideoMimeType(file.originalname);
  if (!mimeType || !isValidVideo(file.path)) {
    try { fs.unlinkSync(file.path); } catch (e) {}
    const err = new Error('Invalid video upload: expected MP4, MOV, AVI, MKV, or WebM with a matching video filename');
    err.status = 415;
    throw err;
  }

  const uploadId = crypto.randomUUID();
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
  const targetFilename = `${uploadId}${extension}`;
  const storageKey = `${dateStr}/${targetFilename}`;
  const storageProvider = config.storage.provider;
  if (!['LOCAL', 'S3'].includes(storageProvider)) {
    try { fs.unlinkSync(file.path); } catch (e) {}
    const err = new Error(`Unsupported STORAGE_PROVIDER: ${storageProvider}`);
    err.status = 500;
    throw err;
  }

  let localPath = null;
  let storageBucket = null;
  try {
    if (storageProvider === 'S3') {
      storageBucket = s3Storage.getBucket();
      await s3Storage.uploadFile(storageKey, file.path, mimeType, file.size);
      try { fs.unlinkSync(file.path); } catch (cleanupErr) {
        logger.warn({ uploadId, error: cleanupErr.message }, 'Failed to remove temporary upload after S3 transfer');
      }
    } else {
      const targetDir = path.join(ensureUploadDir(), dateStr);
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      localPath = path.join(targetDir, targetFilename);
      fs.renameSync(file.path, localPath);
    }
  } catch (err) {
    try { fs.unlinkSync(file.path); } catch (cleanupErr) {
      logger.warn({ uploadId, error: cleanupErr.message }, 'Failed to remove temporary upload after storage failure');
    }
    throw err;
  }

  try {
    return await uploadRepo.create({
      id: uploadId,
      originalFilename: file.originalname,
      fileSize: file.size,
      mimeType,
      storagePath: storageKey,
      storageProvider,
      storageBucket,
      status: 'UPLOADED',
      uploadedAt: new Date(),
      cameraId: cameraId || null,
      activeRunGeneration: 0,
    });
  } catch (err) {
    // Roll back storage if metadata could not be persisted.
    try {
      if (storageProvider === 'S3') await s3Storage.deleteObject(storageKey);
      else if (localPath && fs.existsSync(localPath)) fs.unlinkSync(localPath);
    } catch (cleanupErr) {
      logger.error({ uploadId, err: cleanupErr.message }, 'Failed to clean orphaned video after metadata insert failure');
    }
    throw err;
  }
}

async function getUpload(id) {
  const upload = await uploadRepo.findById(id);
  if (!upload) {
    const err = new Error(`Video upload not found: ${id}`);
    err.status = 404;
    throw err;
  }
  return upload;
}

function resolveDiskPath(storagePath) {
  if (path.isAbsolute(storagePath)) {
    return storagePath;
  }
  return path.join(config.storage.localDir, storagePath);
}

function parseByteRange(rangeHeader, totalSize) {
  if (typeof rangeHeader !== 'string' || !/^bytes=/i.test(rangeHeader)) return null;
  const raw = rangeHeader.slice(rangeHeader.indexOf('=') + 1).trim();
  if (raw.includes(',')) return { multiRange: true };
  if (totalSize <= 0) return { invalid: true };

  const match = /^(\d*)-(\d*)$/.exec(raw);
  if (!match || (!match[1] && !match[2])) return { invalid: true };

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { invalid: true };
    start = Math.max(totalSize - suffixLength, 0);
    end = totalSize - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : totalSize - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return { invalid: true };
    if (start >= totalSize || start > end) return { invalid: true };
    end = Math.min(end, totalSize - 1);
  }
  return { start, end };
}

async function streamVideo(upload, rangeHeader, res) {
  if (String(upload.storageProvider || 'LOCAL').toUpperCase() === 'S3') {
    const totalSize = Number(upload.fileSize);
    const range = parseByteRange(rangeHeader, totalSize);
    if (range?.invalid) {
      res.setHeader('Content-Range', `bytes */${totalSize}`);
      return res.status(416).end();
    }
    const requestedRange = range && !range.multiRange ? `bytes=${range.start}-${range.end}` : null;
    let object;
    try {
      object = await s3Storage.getObject(upload.storageKey || upload.storagePath, requestedRange);
    } catch (err) {
      if (err && (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404)) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Video file missing from object storage' });
      }
      throw err;
    }
    if (!Number.isSafeInteger(Number(object.ContentLength)) || Number(object.ContentLength) <= 0
      || (!requestedRange && Number(object.ContentLength) !== totalSize)) {
      object.Body?.destroy();
      return res.status(502).json({ error: 'STORAGE_INTEGRITY_ERROR', message: 'Stored video metadata does not match object storage' });
    }
    const headers = {
      'Content-Type': upload.mimeType || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `inline; filename="${String(upload.originalFilename || 'video').replace(/[\\r\\n"]/g, '_')}"`,
    };
    if (requestedRange) {
      res.writeHead(206, {
        ...headers,
        'Content-Range': object.ContentRange,
        'Content-Length': object.ContentLength,
      });
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': object.ContentLength || totalSize });
    }
    const stream = object.Body;
    res.on('close', () => stream.destroy());
    stream.on('error', (err) => {
      logger.error({ uploadId: upload.id, err: err.message }, 'S3 video stream failed');
      if (!res.headersSent) res.status(502).end();
      else res.destroy(err);
    });
    return stream.pipe(res);
  }

  const fullPath = resolveDiskPath(upload.storagePath);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Video file missing from disk' });
  }

  const stat = fs.statSync(fullPath);
  const totalSize = stat.size;
  const mimeType = upload.mimeType || 'application/octet-stream';
  const headers = {
    'Content-Type': mimeType,
    'Accept-Ranges': 'bytes',
    'Content-Disposition': `inline; filename="${String(upload.originalFilename || 'video').replace(/[\\r\\n"]/g, '_')}"`,
  };

  if (typeof rangeHeader === 'string' && /^bytes=/i.test(rangeHeader)) {
    const range = parseByteRange(rangeHeader, totalSize);
    if (range?.invalid) {
      res.setHeader('Content-Range', `bytes */${totalSize}`);
      return res.status(416).end();
    }

    // Multi-range requests are uncommon for media playback; serve a full response.
    if (range && !range.multiRange) {
      const contentLength = range.end - range.start + 1;
      res.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${range.start}-${range.end}/${totalSize}`,
        'Content-Length': contentLength,
      });
      const stream = fs.createReadStream(fullPath, { start: range.start, end: range.end });
      res.on('close', () => stream.destroy());
      return stream.pipe(res);
    }
  }

  res.writeHead(200, { ...headers, 'Content-Length': totalSize });
  const stream = fs.createReadStream(fullPath);
  res.on('close', () => stream.destroy());
  return stream.pipe(res);
}

async function deleteUpload(id) {
  const upload = await getUpload(id);
  if (String(upload.storageProvider || 'LOCAL').toUpperCase() === 'S3') {
    await s3Storage.deleteObject(upload.storageKey || upload.storagePath);
  } else {
    const fullPath = resolveDiskPath(upload.storagePath);
    if (fs.existsSync(fullPath)) {
      try { fs.unlinkSync(fullPath); } catch (e) {}
    }
  }
  await uploadRepo.remove(id);
}

module.exports = {
  processUpload,
  getUpload,
  findAll: uploadRepo.findAll,
  streamVideo,
  parseByteRange,
  getVideoMimeType,
  deleteUpload,
  findDetectionsByUploadId: uploadRepo.findDetectionsByUploadId,
};
