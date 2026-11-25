import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The app is client-rendered against an external API; no Cache Components / PPR.
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
