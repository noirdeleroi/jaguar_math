import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas", "sharp", "jsqr", "@mathjax/src", "@mathjax/mathjax-newcm-font"],
  outputFileTracingIncludes: {
    "/api/assignments/*/papers.pdf": ["./node_modules/@mathjax/mathjax-newcm-font/mjs/svg/dynamic/**/*.js"],
    "/api/assignments/*/scans": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", "./node_modules/pdfjs-dist/wasm/**/*", "./node_modules/pdfjs-dist/standard_fonts/**/*", "./node_modules/pdfjs-dist/cmaps/**/*"],
  },
};

export default nextConfig;
