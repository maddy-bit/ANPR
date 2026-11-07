package com.cityai.backend.storage;

import java.util.Locale;

/**
 * Validates actual binary magic bytes / file signatures of uploaded video files.
 * Ensures files are genuine video containers (MP4, AVI, MKV, MOV) and not spoofed files.
 */
public class VideoSignatureValidator {

    public record ValidationResult(
            boolean isValid,
            String detectedFormat,
            String canonicalMimeType,
            String errorMessage
    ) {
        public static ValidationResult valid(String format, String mime) {
            return new ValidationResult(true, format, mime, null);
        }

        public static ValidationResult invalid(String error) {
            return new ValidationResult(false, null, null, error);
        }
    }

    /**
     * Inspects the initial header bytes (typically first 32-64 bytes) to determine
     * if the file is a genuine video container.
     */
    public static ValidationResult validate(byte[] header, String filename, String declaredMime) {
        if (header == null || header.length < 12) {
            return ValidationResult.invalid("File is empty or too small to contain a valid video header.");
        }

        // 1. Check MP4 / MOV (ISO Base Media File Format)
        // Usually contains 'ftyp' at offset 4 (bytes 4..7 == 'ftyp')
        if (header.length >= 8 && header[4] == 'f' && header[5] == 't' && header[6] == 'y' && header[7] == 'p') {
            String brand = "";
            if (header.length >= 12) {
                brand = new String(header, 8, 4).toLowerCase(Locale.ROOT).trim();
            }
            if (brand.startsWith("qt")) {
                return ValidationResult.valid("MOV", "video/quicktime");
            }
            return ValidationResult.valid("MP4", "video/mp4");
        }

        // Alternative QuickTime MOV: starts with 'moov', 'mdat', 'wide', or 'free' atom header
        if (header.length >= 8) {
            String atomType = new String(header, 4, 4);
            if ("moov".equals(atomType) || "mdat".equals(atomType) || "wide".equals(atomType) || "free".equals(atomType)) {
                return ValidationResult.valid("MOV", "video/quicktime");
            }
        }

        // 2. Check AVI (RIFF container with 'AVI ' or 'AVIX' fourcc at offset 8)
        if (header.length >= 12 &&
                header[0] == 'R' && header[1] == 'I' && header[2] == 'F' && header[3] == 'F') {
            String fourcc = new String(header, 8, 4);
            if ("AVI ".equals(fourcc) || "AVIX".equals(fourcc)) {
                return ValidationResult.valid("AVI", "video/x-msvideo");
            }
        }

        // 3. Check Matroska (MKV / WebM)
        // Starts with EBML ID: 0x1A 0x45 0xDF 0xA3
        if ((header[0] & 0xFF) == 0x1A &&
                (header[1] & 0xFF) == 0x45 &&
                (header[2] & 0xFF) == 0xDF &&
                (header[3] & 0xFF) == 0xA3) {
            return ValidationResult.valid("MKV", "video/x-matroska");
        }

        return ValidationResult.invalid(
                "File signature does not match any supported video container (MP4, AVI, MKV, MOV). " +
                "The file appears corrupt or is an unsupported format."
        );
    }

    public static String getFileExtension(String filename) {
        if (filename == null || !filename.contains(".")) {
            return "";
        }
        return filename.substring(filename.lastIndexOf('.')).toLowerCase(Locale.ROOT).trim();
    }
}

