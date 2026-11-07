package com.cityai.backend.storage;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;

/**
 * Cloud storage provider utilizing Supabase Storage Private Buckets.
 * Uses direct streaming via Supabase Storage REST API.
 * Requires SUPABASE_STORAGE_URL and SUPABASE_STORAGE_SERVICE_KEY (service-role key).
 */
@Service
public class SupabaseStorageService implements StorageService {

    private static final Logger log = LoggerFactory.getLogger(SupabaseStorageService.class);
    private static final int BUFFER_SIZE = 65536;

    private final String supabaseUrl;
    private final String serviceKey;
    private final String bucketName;
    private final boolean configured;

    public SupabaseStorageService(
            @Value("${app.storage.supabase.url:}") String supabaseUrl,
            @Value("${app.storage.supabase.service-key:}") String serviceKey,
            @Value("${app.storage.supabase.bucket:cctv-videos}") String bucketName
    ) {
        this.supabaseUrl = supabaseUrl != null ? supabaseUrl.replaceAll("/+$", "").trim() : "";
        this.serviceKey = serviceKey != null ? serviceKey.trim() : "";
        this.bucketName = bucketName != null ? bucketName.trim() : "cctv-videos";
        this.configured = !this.supabaseUrl.isBlank() && !this.serviceKey.isBlank();

        if (this.configured) {
            log.info("SupabaseStorageService configured for bucket '{}' at {}", this.bucketName, this.supabaseUrl);
        } else {
            log.info("SupabaseStorageService is disabled (missing SUPABASE_STORAGE_URL or SUPABASE_STORAGE_SERVICE_KEY). " +
                    "Local storage will serve as the active provider.");
        }
    }

    public boolean isConfigured() {
        return configured;
    }

    @Override
    public String getProviderName() {
        return "SUPABASE";
    }

    @Override
    public StorageObject store(InputStream inputStream, String objectKey, String contentType, long maxExpectedSize) throws IOException {
        checkConfigured();

        String uploadUrl = String.format("%s/storage/v1/object/%s/%s", supabaseUrl, bucketName, sanitizeKey(objectKey));
        log.info("Streaming video upload to Supabase Storage: {}", uploadUrl);

        HttpURLConnection conn = (HttpURLConnection) URI.create(uploadUrl).toURL().openConnection();
        conn.setRequestMethod("POST");
        conn.setDoOutput(true);
        conn.setRequestProperty("Authorization", "Bearer " + serviceKey);
        conn.setRequestProperty("Content-Type", contentType != null ? contentType : "application/octet-stream");
        conn.setRequestProperty("x-upsert", "true");
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(60000);

        long bytesWritten = 0;
        String sha256Hex;

        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            try (BufferedInputStream bis = new BufferedInputStream(new DigestInputStream(inputStream, md), BUFFER_SIZE);
                 OutputStream os = new BufferedOutputStream(conn.getOutputStream(), BUFFER_SIZE)) {

                byte[] buf = new byte[BUFFER_SIZE];
                int read;
                while ((read = bis.read(buf)) != -1) {
                    os.write(buf, 0, read);
                    bytesWritten += read;
                    if (maxExpectedSize > 0 && bytesWritten > maxExpectedSize) {
                        throw new IOException("Uploaded video exceeded max allowed size: " + maxExpectedSize);
                    }
                }
                os.flush();
            }

            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                String err = readErrorResponse(conn);
                throw new IOException("Supabase Storage rejected upload (HTTP " + code + "): " + err);
            }
            sha256Hex = HexFormat.of().formatHex(md.digest());

        } catch (Exception e) {
            conn.disconnect();
            throw new IOException("Failed to stream upload to Supabase Storage: " + e.getMessage(), e);
        }

        return new StorageObject(objectKey, bytesWritten, contentType, sha256Hex, Instant.now());
    }

    @Override
    public InputStream retrieve(String objectKey) throws IOException {
        checkConfigured();
        String downloadUrl = String.format("%s/storage/v1/object/authenticated/%s/%s", supabaseUrl, bucketName, sanitizeKey(objectKey));
        HttpURLConnection conn = (HttpURLConnection) URI.create(downloadUrl).toURL().openConnection();
        conn.setRequestMethod("GET");
        conn.setRequestProperty("Authorization", "Bearer " + serviceKey);
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(60000);

        int code = conn.getResponseCode();
        if (code == 404) {
            throw new FileNotFoundException("Supabase Storage object not found: " + objectKey);
        }
        if (code < 200 || code >= 300) {
            throw new IOException("Supabase Storage retrieval failed (HTTP " + code + "): " + readErrorResponse(conn));
        }
        return new BufferedInputStream(conn.getInputStream(), BUFFER_SIZE);
    }

    @Override
    public void delete(String objectKey) throws IOException {
        checkConfigured();
        String deleteUrl = String.format("%s/storage/v1/object/%s/%s", supabaseUrl, bucketName, sanitizeKey(objectKey));
        HttpURLConnection conn = (HttpURLConnection) URI.create(deleteUrl).toURL().openConnection();
        conn.setRequestMethod("DELETE");
        conn.setRequestProperty("Authorization", "Bearer " + serviceKey);
        conn.setConnectTimeout(10000);

        int code = conn.getResponseCode();
        if (code >= 200 && code < 300) {
            log.info("Deleted object from Supabase Storage: {}", objectKey);
        } else if (code != 404) {
            log.warn("Supabase Storage delete returned HTTP {}: {}", code, readErrorResponse(conn));
        }
    }

    @Override
    public boolean exists(String objectKey) {
        if (!configured) return false;
        try {
            String headUrl = String.format("%s/storage/v1/object/authenticated/%s/%s", supabaseUrl, bucketName, sanitizeKey(objectKey));
            HttpURLConnection conn = (HttpURLConnection) URI.create(headUrl).toURL().openConnection();
            conn.setRequestMethod("HEAD");
            conn.setRequestProperty("Authorization", "Bearer " + serviceKey);
            conn.setConnectTimeout(5000);
            return conn.getResponseCode() == 200;
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    public long getSize(String objectKey) throws IOException {
        checkConfigured();
        String headUrl = String.format("%s/storage/v1/object/authenticated/%s/%s", supabaseUrl, bucketName, sanitizeKey(objectKey));
        HttpURLConnection conn = (HttpURLConnection) URI.create(headUrl).toURL().openConnection();
        conn.setRequestMethod("HEAD");
        conn.setRequestProperty("Authorization", "Bearer " + serviceKey);
        conn.setConnectTimeout(5000);
        if (conn.getResponseCode() == 200) {
            return conn.getContentLengthLong();
        }
        throw new FileNotFoundException("Supabase Storage object not found: " + objectKey);
    }

    private void checkConfigured() {
        if (!configured) {
            throw new IllegalStateException("Supabase Storage is not configured. Set SUPABASE_STORAGE_URL and SUPABASE_STORAGE_SERVICE_KEY.");
        }
    }

    private String sanitizeKey(String key) {
        return key.replace('\\', '/').replaceAll("^/+", "");
    }

    private String readErrorResponse(HttpURLConnection conn) {
        try (InputStream es = conn.getErrorStream()) {
            if (es != null) {
                return new String(es.readAllBytes(), StandardCharsets.UTF_8);
            }
        } catch (Exception ignored) {}
        return "Unknown error";
    }
}

