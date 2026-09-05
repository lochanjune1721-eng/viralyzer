import type { NextConfig } from "next";

// Vercel's builder is incompatible with the standalone output (it expects the
// default trace files), so standalone is only used for the Docker image.
const onVercel = !!process.env.VERCEL;

const nextConfig: NextConfig = {
  output: onVercel ? undefined : "standalone",
  // Let `next dev` serve through Codespaces / tunnel domains.
  allowedDevOrigins: ["*.app.github.dev", "*.trycloudflare.com", "*.ngrok-free.app"],
  // Bundled caption fonts must ship with the server output.
  outputFileTracingIncludes: {
    "/api/**": ["./assets/**"],
  },
};

export default nextConfig;
