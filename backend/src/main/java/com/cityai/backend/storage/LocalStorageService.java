package com.cityai.backend.storage;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.*;
import java.nio.file.*;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;

/**
 * Local filesystem storage provider.
 * Streams data directly to disk without holding large files in heap memory.
 * Uses atomic file moving and path traversal safeguards.
 */
@Service
public class LocalStorageService implements StorageService {

    private static final Logger log = LoggerFactory.getLogger(LocalStorageService.class);
    private static final int BUFFER_SIZE = 65536; // 64 KB streaming buffer

    private final Path rootDirectory;

    public LocalStorageService(@Value("${app.storage.local-dir:../data/uploads}") String localDir) {
        Path p = Paths.get(localDir).toAbsolutePath().normalize();
        try {
            Files.createDirectories(p);
            this.rootDirectory = p.toRealPath();
            log.info("LocalStorageService initialized with root directory: {}", this.rootDirectory);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to initialize local video upload storage directory: " + localDir, e);
        }
    }

    @Override
    public String getProviderName() {
        return "LOCAL";
    }

    @Override
    public StorageObject store(InputStream inputStream, String objectKey, String contentType, long maxExpectedSize) throws IOException {
        Path targetPath = resolveAndValidate(objectKey);
        Path parent = targetPath.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }

        // Stream into temporary file first, then atomically move to avoid incomplete uploads
        Path tempPath = Files.createTempFile(parent, "upload-", ".tmp");
        long bytesWritten = 0;
        String sha256Hex;

        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            try (BufferedInputStream bis = new BufferedInputStream(new DigestInputStream(inputStream, md), BUFFER_SIZE);
                 BufferedOutputStream bos = new BufferedOutputStream(Files.newOutputStream(tempPath), BUFFER_SIZE)) {

                byte[] buf = new byte[BUFFER_SIZE];
                int read;
                while ((read = bis.read(buf)) != -1) {
                    bos.write(buf, 0, read);
                    bytesWritten += read;
                    if (maxExpectedSize > 0 && bytesWritten > maxExpectedSize) {
                        throw new IOException("Uploaded video exceeded maximum allowed size: " + maxExpectedSize + " bytes");
                    }
                }
                bos.flush();
            }
            sha256Hex = HexFormat.of().formatHex(md.digest());

            // Atomic move to final destination
            Files.move(tempPath, targetPath, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            log.info("Stored video file locally at '{}' ({} bytes, sha256: {})", objectKey, bytesWritten, sha256Hex);

        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 algorithm not available", e);
        } catch (Exception e) {
            // Clean up partial temp file on failure
            try {
                Files.deleteIfExists(tempPath);
            } catch (IOException ignored) {}
            throw e;
        }

        return new StorageObject(objectKey, bytesWritten, contentType, sha256Hex, Instant.now());
    }

    @Override
    public InputStream retrieve(String objectKey) throws IOException {
        Path path = resolveAndValidate(objectKey);
        if (!Files.exists(path)) {
            throw new FileNotFoundException("Stored object not found: " + objectKey);
        }
        return new BufferedInputStream(Files.newInputStream(path), BUFFER_SIZE);
    }

    @Override
    public void delete(String objectKey) throws IOException {
        Path path = resolveAndValidate(objectKey);
        boolean deleted = Files.deleteIfExists(path);
        if (deleted) {
            log.info("Deleted stored video object: {}", objectKey);
        }
    }

    @Override
    public boolean exists(String objectKey) {
        try {
            Path path = resolveAndValidate(objectKey);
            return Files.exists(path);
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    public long getSize(String objectKey) throws IOException {
        Path path = resolveAndValidate(objectKey);
        if (!Files.exists(path)) {
            throw new FileNotFoundException("Stored object not found: " + objectKey);
        }
        return Files.size(path);
    }

    /**
     * Resolves object key against root directory and strictly prevents path traversal attacks.
     */
    private Path resolveAndValidate(String objectKey) {
        if (objectKey == null || objectKey.isBlank()) {
            throw new IllegalArgumentException("Object key must not be empty");
        }
        // Normalize slashes
        String sanitized = objectKey.replace('\\', '/').replaceAll("^/+", "");
        Path target = rootDirectory.resolve(sanitized).normalize();

        // Enforce boundary within root directory
        if (!target.startsWith(rootDirectory)) {
            log.warn("Path traversal security violation attempted with object key: {}", objectKey);
            throw new SecurityException("Invalid object key: Path traversal is not permitted: " + objectKey);
        }
        return target;
    }
}

