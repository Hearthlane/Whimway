import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  logging: { incomingRequests: false, serverFunctions: false },
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "geolocation=(self), camera=(), microphone=()",
          },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com https://*.googleusercontent.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://*.googleapis.com https://*.gstatic.com https://*.supabase.co; frame-src https://www.google.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
          },
        ],
      },
    ];
  },
};
export default config;
