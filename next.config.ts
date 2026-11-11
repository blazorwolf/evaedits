import type { NextConfig } from "next";

// ffmpeg.wasm's multithreaded core needs SharedArrayBuffer, which browsers
// only allow on cross-origin isolated pages. The isolation headers go on every
// route because the editor's worker scripts (under /_next and /ffmpeg) must
// carry them too, or the browser refuses to start the worker.
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
