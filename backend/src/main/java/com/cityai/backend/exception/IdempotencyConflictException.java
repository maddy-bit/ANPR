package com.cityai.backend.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * Thrown when an incoming detection ingestion request matches an existing idempotency key
 * but carries a conflicting Tier 1 (identity) or Tier 2 (classification) payload,
 * or attempts to modify a sealed processing run.
 * Automatically mapped to HTTP 409 Conflict.
 */
@ResponseStatus(HttpStatus.CONFLICT)
public class IdempotencyConflictException extends RuntimeException {

    private final String idempotencyKey;
    private final Long existingDetectionId;

    public IdempotencyConflictException(String message) {
        super(message);
        this.idempotencyKey = null;
        this.existingDetectionId = null;
    }

    public IdempotencyConflictException(String idempotencyKey, Long existingDetectionId, String reason) {
        super(String.format("Idempotency conflict for key '%s' (existing detection ID %s): %s",
                idempotencyKey, existingDetectionId != null ? existingDetectionId : "N/A", reason));
        this.idempotencyKey = idempotencyKey;
        this.existingDetectionId = existingDetectionId;
    }

    public String getIdempotencyKey() {
        return idempotencyKey;
    }

    public Long getExistingDetectionId() {
        return existingDetectionId;
    }
}
