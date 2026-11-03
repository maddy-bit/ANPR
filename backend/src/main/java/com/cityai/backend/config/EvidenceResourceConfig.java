package com.cityai.backend.config;

import java.io.File;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Serves saved evidence frames (data/evidence/<camera>/<file>.jpg) at GET /evidence/**
 * and recorded camera video files (videos/CAM-*.mp4) at GET /videos/**
 * with HTTP Range request support for HTML5 video playback without bundling
 * video binaries into the frontend application.
 */
@Configuration
public class EvidenceResourceConfig implements WebMvcConfigurer {

    private final String evidenceDir;
    private final String videosDir;

    public EvidenceResourceConfig(
            @Value("${app.evidence-dir}") String evidenceDir,
            @Value("${app.videos-dir:${VIDEOS_DIR:../videos}}") String videosDir) {
        this.evidenceDir = evidenceDir;
        this.videosDir = videosDir;
    }

    @Override
    public void addResourceHandlers(@org.springframework.lang.NonNull ResourceHandlerRegistry registry) {
        String location = "file:" + new File(evidenceDir).getAbsolutePath() + File.separator;
        registry.addResourceHandler("/evidence/**").addResourceLocations(location);

        File vDir = new File(videosDir);
        if (!vDir.exists() && new File("videos").exists()) {
            vDir = new File("videos");
        } else if (!vDir.exists() && new File("../videos").exists()) {
            vDir = new File("../videos");
        }
        String videoLocation = "file:" + vDir.getAbsolutePath() + File.separator;
        registry.addResourceHandler("/videos/**").addResourceLocations(videoLocation);
    }
}
