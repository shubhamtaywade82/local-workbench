import type { NextConfig } from "next";

// Pin the root: a stray lockfile in a parent dir (e.g. ~/package-lock.json) makes Next
// infer that dir as root and nest server.js deep inside .next/standalone/.
const projectRoot = __dirname;

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: projectRoot,
  turbopack: { root: projectRoot },
  serverExternalPackages: ["@nemesis-oss/ollama-sdk"],
  reactStrictMode: false,
};

export default nextConfig;
