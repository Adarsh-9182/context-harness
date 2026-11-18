import type { NextConfig } from "next";
const webExport = process.env.HARNESS_WEB_EXPORT === "true";
const config: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  devIndicators: false,
  output: "standalone",
  distDir: process.env.HARNESS_NEXT_DIST_DIR || ".next",
  serverExternalPackages: [
    "@electric-sql/pglite",
    "postgres",
    "ioredis",
    "nodemailer",
  ],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; script-src 'self' 'unsafe-inline' ${process.env.NODE_ENV !== "production" ? "'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
          },
        ],
      },
    ];
  },
};
export default webExport ? {
  outputFileTracingRoot: process.cwd(),
  devIndicators: false,
  output: "export",
  distDir: ".local/web-shell",
  // Keep the export on hosted entry points. Next's webpack loader expects a multi-value extension list.
  pageExtensions: ["hosted.tsx", "hosted.jsx"],
} satisfies NextConfig : config;
