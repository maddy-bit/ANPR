package com.cityai.backend.storage;

import java.time.Instant;

public record StorageObject(
        String key,
        long size,
        String contentType,
        String sha256Hash,
        Instant storedAt
) {}

