/**
 * Express Application Setup
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');

const config = require('./config/env');
const { rateLimiter } = require('./middleware/rate-limit');
const { errorHandler } = require('./middleware/error-handler');
const { correlationId } = require('./middleware/correlation-id');
const { adminTokenGuard, warnIfUnguarded } = require('./middleware/admin-token');

// Route modules
const healthRoutes = require('./modules/health/health.routes');
const cameraRoutes = require('./modules/cameras/camera.routes');
const cameraSourceRoutes = require('./modules/cameras/camera-source.routes');
const vehicleRoutes = require('./modules/vehicles/vehicle.routes');
const detectionRoutes = require('./modules/detections/detection.routes');
const uploadRoutes = require('./modules/uploads/upload.routes');
const identityRoutes = require('./modules/identities/identity.routes');
const analyticsRoutes = require('./modules/analytics/analytics.routes');
const auditRoutes = require('./modules/audit/audit.routes');
const aiProxyRoutes = require('./modules/proxy/ai-proxy.routes');
const agentRoutes = require('./modules/agent/agent.routes');
const investigationRoutes = require('./modules/investigations/investigation.routes');
const evidenceRoutes = require('./modules/evidence/evidence.routes');
const systemRoutes = require('./modules/system/system.routes');

const app = express();

// Request correlation (before everything that logs or errors)
app.use(correlationId);

// Security & Parsing
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowed = config.corsAllowedOrigins;
    if (allowed.includes('*') || allowed.includes(origin)) {
      return callback(null, true);
    }
    // Automatically permit Vercel preview deployments when vercel.app is in allowed list
    if (allowed.some(a => a.includes('vercel.app')) && origin.endsWith('.vercel.app')) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate Limiter
app.use(rateLimiter);

// Surface unguarded destructive routes once at boot (see middleware/admin-token.js)
warnIfUnguarded();

// Static Asset File Handlers
// Evidence frames: data/evidence/**
app.use('/evidence', express.static(config.storage.evidenceDir));
// Recorded camera videos: videos/**
app.use('/videos', express.static(config.storage.videosDir));

// API Routes
app.use('/api', healthRoutes);
app.use('/api/cameras', cameraRoutes);
app.use('/api/camera-sources', cameraSourceRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/detections', detectionRoutes);
app.use('/api/videos', uploadRoutes);
app.use('/api/identities', identityRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/investigations', investigationRoutes);
app.use('/api/evidence-vault', evidenceRoutes);
app.use('/api/system', systemRoutes);
app.use('/api', aiProxyRoutes);

// Fallback 404
app.use((req, res) => {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: `Cannot ${req.method} ${req.path}`,
    timestamp: new Date().toISOString(),
  });
});

// Central Error Handler
app.use(errorHandler);

module.exports = app;
