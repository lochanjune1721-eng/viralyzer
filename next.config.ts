import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: "standalone",
  // Bundled caption fonts must ship with the standalone server output.
  outputFileTracingIncludes: {
    "/api/**": ["./assets/**"],
  },
};

export default nextConfig;
