package com.cityai.backend.storage;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class VideoSignatureValidatorTest {

    @Test
    void validate_ValidMp4Header_ReturnsValidMp4() {
        // MP4 header: 4 bytes length, then 'ftyp', then 'isom'
        byte[] header = new byte[]{
                0x00, 0x00, 0x00, 0x20, // size
                'f', 't', 'y', 'p',       // box type
                'i', 's', 'o', 'm',       // major brand
                0x00, 0x00, 0x02, 0x00    // minor version
        };

        VideoSignatureValidator.ValidationResult result = VideoSignatureValidator.validate(header, "cctv.mp4", "video/mp4");

        assertThat(result.isValid()).isTrue();
        assertThat(result.detectedFormat()).isEqualTo("MP4");
        assertThat(result.canonicalMimeType()).isEqualTo("video/mp4");
        assertThat(result.errorMessage()).isNull();
    }

    @Test
    void validate_ValidMovHeaderWithQtBrand_ReturnsValidMov() {
        byte[] header = new byte[]{
                0x00, 0x00, 0x00, 0x14,
                'f', 't', 'y', 'p',
                'q', 't', ' ', ' ',
                0x00, 0x00, 0x00, 0x00
        };

        VideoSignatureValidator.ValidationResult result = VideoSignatureValidator.validate(header, "footage.mov", "video/quicktime");

        assertThat(result.isValid()).isTrue();
        assertThat(result.detectedFormat()).isEqualTo("MOV");
        assertThat(result.canonicalMimeType()).isEqualTo("video/quicktime");
    }

    @Test
    void validate_ValidMovHeaderWithMoovAtom_ReturnsValidMov() {
        byte[] header = new byte[]{
                0x00, 0x00, 0x01, 0x00,
                'm', 'o', 'o', 'v',
                0x00, 0x00, 0x00, 0x6c
        };

        VideoSignatureValidator.ValidationResult result = VideoSignatureValidator.validate(header, "footage.mov", "video/quicktime");

        assertThat(result.isValid()).isTrue();
        assertThat(result.detectedFormat()).isEqualTo("MOV");
        assertThat(result.canonicalMimeType()).isEqualTo("video/quicktime");
    }

    @Test
    void validate_ValidAviHeader_ReturnsValidAvi() {
        // RIFF....AVI 
        byte[] header = new byte[]{
                'R', 'I', 'F', 'F',
                0x50, 0x10, 0x00, 0x00, // file size - 8
                'A', 'V', 'I', ' ',
                'L', 'I', 'S', 'T'
        };

        VideoSignatureValidator.ValidationResult result = VideoSignatureValidator.validate(header, "junction.avi", "video/x-msvideo");

        assertThat(result.isValid()).isTrue();
        assertThat(result.detectedFormat()).isEqualTo("AVI");
        assertThat(result.canonicalMimeType()).isEqualTo("video/x-msvideo");
    }

    @Test
    void validate_ValidMkvHeader_ReturnsValidMkv() {
        // Matroska EBML: 0x1A 0x45 0xDF 0xA3
        byte[] header = new byte[]{
                (byte) 0x1A, (byte) 0x45, (byte) 0xDF, (byte) 0xA3,
                (byte) 0x93, 0x42, (byte) 0x82, (byte) 0x88,
                'm', 'a', 't', 'r', 'o', 's', 'k', 'a'
        };

        VideoSignatureValidator.ValidationResult result = VideoSignatureValidator.validate(header, "highway.mkv", "video/x-matroska");

        assertThat(result.isValid()).isTrue();
        assertThat(result.detectedFormat()).isEqualTo("MKV");
        assertThat(result.canonicalMimeType()).isEqualTo("video/x-matroska");
    }

    @Test
    void validate_SpoofedTextFile_ReturnsInvalid() {
        byte[] header = "This is a plain text file pretending to be mp4!".getBytes();

        VideoSignatureValidator.ValidationResult result = VideoSignatureValidator.validate(header, "fake.mp4", "video/mp4");

        assertThat(result.isValid()).isFalse();
        assertThat(result.errorMessage()).contains("does not match any supported video container");
    }

    @Test
    void validate_EmptyOrNullHeader_ReturnsInvalid() {
        VideoSignatureValidator.ValidationResult nullResult = VideoSignatureValidator.validate(null, "clip.mp4", "video/mp4");
        assertThat(nullResult.isValid()).isFalse();
        assertThat(nullResult.errorMessage()).contains("empty or too small");

        VideoSignatureValidator.ValidationResult emptyResult = VideoSignatureValidator.validate(new byte[0], "clip.mp4", "video/mp4");
        assertThat(emptyResult.isValid()).isFalse();
        assertThat(emptyResult.errorMessage()).contains("empty or too small");
    }

    @Test
    void validate_TruncatedHeaderLessThan12Bytes_ReturnsInvalid() {
        byte[] shortHeader = new byte[]{ 0x00, 0x00, 0x00, 0x20, 'f', 't', 'y', 'p' };

        VideoSignatureValidator.ValidationResult result = VideoSignatureValidator.validate(shortHeader, "short.mp4", "video/mp4");

        assertThat(result.isValid()).isFalse();
        assertThat(result.errorMessage()).contains("empty or too small");
    }

    @Test
    void validate_PngImageSpoofingMp4_ReturnsInvalid() {
        // PNG magic bytes: 0x89 'P' 'N' 'G' 0x0D 0x0A 0x1A 0x0A
        byte[] pngHeader = new byte[]{
                (byte) 0x89, 'P', 'N', 'G',
                0x0D, 0x0A, 0x1A, 0x0A,
                0x00, 0x00, 0x00, 0x0D
        };

        VideoSignatureValidator.ValidationResult result = VideoSignatureValidator.validate(pngHeader, "photo.mp4", "video/mp4");

        assertThat(result.isValid()).isFalse();
        assertThat(result.errorMessage()).contains("does not match any supported video container");
    }

    @Test
    void getFileExtension_NormalAndEdgeCases() {
        assertThat(VideoSignatureValidator.getFileExtension("traffic.mp4")).isEqualTo(".mp4");
        assertThat(VideoSignatureValidator.getFileExtension("TRAFFIC.AVI")).isEqualTo(".avi");
        assertThat(VideoSignatureValidator.getFileExtension("my.video.clip.mkv")).isEqualTo(".mkv");
        assertThat(VideoSignatureValidator.getFileExtension("noextension")).isEqualTo("");
        assertThat(VideoSignatureValidator.getFileExtension(null)).isEqualTo("");
    }
}
