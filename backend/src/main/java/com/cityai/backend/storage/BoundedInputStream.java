package com.cityai.backend.storage;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * FilterInputStream that bounds the number of bytes that can be read.
 * Prevents reading beyond the requested range without allocating heap memory.
 */
public class BoundedInputStream extends FilterInputStream {

    private long remaining;

    public BoundedInputStream(InputStream in, long maxBytes) {
        super(in);
        this.remaining = Math.max(0, maxBytes);
    }

    @Override
    public int read() throws IOException {
        if (remaining <= 0) {
            return -1;
        }
        int result = super.read();
        if (result != -1) {
            remaining--;
        }
        return result;
    }

    @Override
    public int read(byte[] b, int off, int len) throws IOException {
        if (remaining <= 0) {
            return -1;
        }
        int toRead = (int) Math.min(len, remaining);
        int bytesRead = super.read(b, off, toRead);
        if (bytesRead != -1) {
            remaining -= bytesRead;
        }
        return bytesRead;
    }

    @Override
    public int available() throws IOException {
        return (int) Math.min(super.available(), remaining);
    }

    @Override
    public long skip(long n) throws IOException {
        long toSkip = Math.min(n, remaining);
        long skipped = super.skip(toSkip);
        remaining -= skipped;
        return skipped;
    }
}

