package com.cityai.backend.storage;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class LocalStorageServiceTest {

    @TempDir
    Path tempDir;

    private LocalStorageService storageService;

    @BeforeEach
    void setUp() {
        storageService = new LocalStorageService(tempDir.toString());
    }

    @Test
    void getProviderName_ReturnsLocal() {
        assertThat(storageService.getProviderName()).isEqualTo("LOCAL");
    }

    @Test
    void storeAndRetrieve_ValidPayload_SucceedsWithExactBytesAndSha256() throws IOException {
        String testData = "Fake CCTV binary video stream data for testing 1234567890";
        byte[] bytes = testData.getBytes(StandardCharsets.UTF_8);
        String key = "test/2026/clip.mp4";

        StorageObject result = storageService.store(
                new ByteArrayInputStream(bytes),
                key,
                "video/mp4",
                bytes.length
        );

        assertThat(result.key()).isEqualTo(key);
        assertThat(result.size()).isEqualTo(bytes.length);
        assertThat(result.contentType()).isEqualTo("video/mp4");
        assertThat(result.sha256Hash()).isNotEmpty();

        // Verify physical file on disk
        assertThat(storageService.exists(key)).isTrue();
        assertThat(storageService.getSize(key)).isEqualTo(bytes.length);

        // Retrieve and compare content
        try (InputStream in = storageService.retrieve(key)) {
            byte[] readBytes = in.readAllBytes();
            assertThat(readBytes).isEqualTo(bytes);
        }

        // Test Range retrieval (e.g. bytes 5 to 14: 10 bytes)
        try (InputStream rangeIn = storageService.retrieveRange(key, 5, 10)) {
            byte[] rangeBytes = rangeIn.readAllBytes();
            assertThat(rangeBytes).hasSize(10);
            byte[] expectedSlice = new byte[10];
            System.arraycopy(bytes, 5, expectedSlice, 0, 10);
            assertThat(rangeBytes).isEqualTo(expectedSlice);
        }
    }

    @Test
    void store_WhenStreamExceedsMaxSize_ThrowsAndCleansUpTempFile() {
        byte[] bytes = new byte[1024];
        String key = "oversized/clip.mp4";

        assertThatThrownBy(() -> storageService.store(
                new ByteArrayInputStream(bytes),
                key,
                "video/mp4",
                512 // Limit to 512 bytes
        )).isInstanceOf(IOException.class)
                .hasMessageContaining("exceeded maximum allowed size");

        // Target file must not exist
        assertThat(storageService.exists(key)).isFalse();
    }

    @Test
    void delete_ExistingFile_RemovesFromDisk() throws IOException {
        String key = "delete-me/clip.mp4";
        storageService.store(new ByteArrayInputStream(new byte[]{1, 2, 3}), key, "video/mp4", 3);

        assertThat(storageService.exists(key)).isTrue();
        storageService.delete(key);
        assertThat(storageService.exists(key)).isFalse();
    }

    @Test
    void retrieve_NonExistentFile_ThrowsFileNotFoundException() {
        assertThatThrownBy(() -> storageService.retrieve("does/not/exist.mp4"))
                .isInstanceOf(FileNotFoundException.class)
                .hasMessageContaining("Stored object not found");
    }

    @Test
    void pathTraversalAttempt_ThrowsSecurityException() {
        assertThatThrownBy(() -> storageService.store(
                new ByteArrayInputStream(new byte[]{1}),
                "../../etc/passwd",
                "video/mp4",
                1
        )).isInstanceOf(SecurityException.class)
                .hasMessageContaining("Path traversal is not permitted");

        assertThatThrownBy(() -> storageService.retrieve("../../../secret.key"))
                .isInstanceOf(SecurityException.class);
    }
}
