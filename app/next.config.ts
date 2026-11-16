import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["node:sqlite"],
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
};

export default config;
