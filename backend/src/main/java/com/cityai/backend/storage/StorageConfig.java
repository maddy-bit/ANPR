package com.cityai.backend.storage;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

@Configuration
public class StorageConfig {

    private static final Logger log = LoggerFactory.getLogger(StorageConfig.class);

    @Bean
    @Primary
    public StorageService primaryStorageService(
            @Value("${app.storage.provider:local}") String provider,
            LocalStorageService localStorageService,
            SupabaseStorageService supabaseStorageService
    ) {
        if ("supabase".equalsIgnoreCase(provider)) {
            if (supabaseStorageService.isConfigured()) {
                log.info("Primary StorageService: SupabaseStorageService (Cloud Object Storage)");
                return supabaseStorageService;
            } else {
                log.warn("Storage provider is set to 'supabase', but Supabase Storage credentials are missing. " +
                        "Falling back to LocalStorageService for durable local filesystem storage.");
                return localStorageService;
            }
        }
        log.info("Primary StorageService: LocalStorageService (Local Filesystem)");
        return localStorageService;
    }
}

