import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.NEXT_OUTPUT_STANDALONE === "true" ? { output: "standalone" } : {}),
  async rewrites() {
    const backendUrl = process.env.BACKEND_INTERNAL_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8080";
    return [
      // Proxy all /api/* to the backend (backend-node on 8080) EXCEPT /api/vahan/* and
      // /api/yolo/* which are Next.js native API routes
      // (frontend/src/app/api/vahan/[plate] and /api/yolo/detect).
      // Next.js path regex negative lookahead syntax: (?!vahan\/|yolo\/)
      {
        source: "/api/:path((?!vahan\\/|yolo\\/).*)",
        destination: `${backendUrl}/api/:path*`,
      },
      {
        source: "/ws/:path*",
        destination: `${backendUrl}/ws/:path*`,
      },
      {
        source: "/evidence/:path*",
        destination: `${backendUrl}/evidence/:path*`,
      },
      {
        source: "/videos/:path*",
        destination: `${backendUrl}/videos/:path*`,
      },
    ];
  },
};

export default nextConfig;
