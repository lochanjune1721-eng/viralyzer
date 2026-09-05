import type { NextConfig } from "next";

// Vercel's builder is incompatible with the standalone output (it expects the
// default trace files), so standalone is only used for the Docker image.
const onVercel = !!process.env.VERCEL;

const nextConfig: NextConfig = {
  output: onVercel ? undefined : "standalone",
  // Bundled caption fonts must ship with the server output.
  outputFileTracingIncludes: {
    "/api/**": ["./assets/**"],
  },
};

export default nextConfig;
