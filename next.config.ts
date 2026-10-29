import type { NextConfig } from "next";

const allowedActionOrigins = process.env.ALLOWED_ACTION_ORIGINS
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedDevOrigins = Array.from(new Set([
  "127.0.0.1",
  ...(process.env.NEXT_DEV_ALLOWED_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) ?? []),
]));
const isProduction = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  // Prisma must not be bundled by Turbopack or model delegates can be missing at runtime.
  serverExternalPackages: ["@prisma/client", "sharp"],
  output: "standalone",
  poweredByHeader: false,
  allowedDevOrigins,
  experimental: {
    // Container CPU quotas do not reduce os.cpus(); bound build worker memory.
    cpus: 2,
    // Disposable image/acceptance builds never reuse their compiler cache.
    turbopackFileSystemCacheForBuild: process.env.SWW_DISABLE_BUILD_CACHE !== "1",
    proxyClientMaxBodySize: "40mb",
    serverActions: {
      // Same-origin by default. Configure explicitly when a trusted proxy
      // terminates requests on another hostname.
      ...(allowedActionOrigins?.length ? { allowedOrigins: allowedActionOrigins } : {}),
      bodySizeLimit: "26mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          ...(isProduction
            ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
            : []),
        ],
      },
      // Invitation and password-reset URLs are bearer capabilities: never
      // leak them to another origin in a Referer header.
      { source: "/invite/:token", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/reset-password/:token", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

export default nextConfig;
