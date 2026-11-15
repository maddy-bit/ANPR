package com.cityai.backend.dto;

import jakarta.validation.constraints.Positive;

public record ProcessVideoRequest(
        String clientRunToken,
        Boolean reprocess,
        @Positive(message = "frame_stride must be a positive integer")
        Integer frameStride,
        Boolean enableDehaze
) {
    public ProcessVideoRequest {
        if (reprocess == null) {
            reprocess = false;
        }
        if (frameStride == null) {
            frameStride = 5;
        }
        if (enableDehaze == null) {
            enableDehaze = false;
        }
    }
}

