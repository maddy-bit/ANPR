package com.cityai.backend.dto;

import jakarta.validation.constraints.NotNull;

public record AssociateCandidateRequest(
        @NotNull Long sourceDetectionId,
        @NotNull Long candidateDetectionId,
        Boolean autoAssign
) {}

