package com.cityai.backend.util;

/**
 * Mirrors ai-service/utils/plate_normalizer.py so a plate typed into the
 * search box (spaced or normalized registration formats) matches what was stored
 * from OCR output.
 */
public final class PlateNormalizer {

    private PlateNormalizer() {
    }

    public static String normalize(String rawText) {
        if (rawText == null) {
            return "";
        }
        return rawText.toUpperCase().replaceAll("[^A-Z0-9]", "");
    }
}

