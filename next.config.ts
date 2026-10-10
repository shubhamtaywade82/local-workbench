import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@nemesis-oss/ollama-sdk"],
  reactStrictMode: false,
};

export default nextConfig;
