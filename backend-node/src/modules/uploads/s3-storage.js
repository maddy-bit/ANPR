const { S3Client, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const fs = require('fs');
const config = require('../../config/env');

let client = null;

function getBucket() {
  const bucket = config.storage.s3Bucket;
  if (!bucket) throw new Error('S3_BUCKET must be configured when STORAGE_PROVIDER=S3');
  return bucket;
}

function getClient() {
  if (!config.storage.s3Region) throw new Error('AWS_REGION must be configured when STORAGE_PROVIDER=S3');
  const accessKeyId = config.storage.s3AccessKeyId;
  const secretAccessKey = config.storage.s3SecretAccessKey;
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    throw new Error('AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be configured together');
  }
  if (config.storage.s3Endpoint && !accessKeyId) {
    throw new Error('AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required with S3_ENDPOINT');
  }

  if (!client) {
    client = new S3Client({
      region: config.storage.s3Region,
      ...(config.storage.s3Endpoint ? { endpoint: config.storage.s3Endpoint } : {}),
      ...(accessKeyId ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    });
  }
  return client;
}

async function uploadFile(key, filePath, contentType, fileSize) {
  const upload = new Upload({
    client: getClient(),
    params: {
      Bucket: getBucket(),
      Key: key,
      Body: fs.createReadStream(filePath),
      ContentType: contentType,
      ContentLength: fileSize,
    },
    queueSize: 2,
    partSize: 8 * 1024 * 1024,
    leavePartsOnError: false,
  });
  return upload.done();
}

async function getObject(key, range) {
  return getClient().send(new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ...(range ? { Range: range } : {}),
  }));
}

async function deleteObject(key) {
  return getClient().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }));
}

function resetClientForTests() {
  client = null;
}

module.exports = { getBucket, getClient, uploadFile, getObject, deleteObject, resetClientForTests };

