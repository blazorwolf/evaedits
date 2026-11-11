import type { NextConfig } from "next";

// ffmpeg.wasm's multithreaded core needs SharedArrayBuffer,
// which browsers only allow on cross-origin isolated pages.
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/editor/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
