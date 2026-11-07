package com.cityai.backend.storage;

import java.io.IOException;
import java.io.InputStream;

/**
 * Storage abstraction for persisting and retrieving video files.
 * Implementations stream content directly without buffering large binaries into JVM heap.
 */
public interface StorageService {

    /**
     * Identifies the active storage provider (e.g. "LOCAL", "SUPABASE").
     */
    String getProviderName();

    /**
     * Streams an input stream into storage at the specified object key.
     * Computes the SHA-256 hash incrementally during streaming.
     */
    StorageObject store(InputStream inputStream, String objectKey, String contentType, long expectedSize) throws IOException;

    /**
     * Opens an input stream for reading the stored object.
     */
    InputStream retrieve(String objectKey) throws IOException;

    /**
     * Opens an input stream for reading a specific byte range of the stored object.
     */
    default InputStream retrieveRange(String objectKey, long start, long length) throws IOException {
        InputStream in = retrieve(objectKey);
        long skipped = 0;
        while (skipped < start) {
            long s = in.skip(start - skipped);
            if (s <= 0) break;
            skipped += s;
        }
        return new BoundedInputStream(in, length);
    }

    /**
     * Deletes the stored object if it exists.
     */
    void delete(String objectKey) throws IOException;

    /**
     * Checks if the object exists in storage.
     */
    boolean exists(String objectKey);

    /**
     * Returns the size of the stored object in bytes.
     */
    long getSize(String objectKey) throws IOException;
}

