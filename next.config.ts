import type { NextConfig } from "next";

// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig: NextConfig = {
  reactCompiler: true,
  webpack: (config: any) => {
    config.module.rules.push({
      test: /\.md$/,
      use: "raw-loader",
    });
    return config;
  },
  devIndicators: false,
};

// module.exports = nextConfig;

export default nextConfig;
