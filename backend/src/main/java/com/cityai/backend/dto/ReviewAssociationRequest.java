package com.cityai.backend.dto;

import jakarta.validation.constraints.NotBlank;
import java.util.UUID;

public record ReviewAssociationRequest(
        @NotBlank String action, // CONFIRM_MATCH, REJECT_MATCH, FLAG_CONFLICT
        String reviewNotes,
        UUID targetGlobalIdentityId
) {}

