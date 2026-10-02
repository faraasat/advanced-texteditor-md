import { resolve } from "node:path";
import type { NextConfig } from "next";

// GitHub Pages serves this project from /<repo>, and has no Node runtime, so the demo is a fully static export.
// The Pages workflow sets NEXT_PUBLIC_BASE_PATH; a plain `next build` here serves from "/".
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  assetPrefix: basePath || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  // The library is linked from the parent directory (file:..), so Turbopack's root must include it.
  turbopack: { root: resolve(process.cwd(), "..") },
};

export default nextConfig;
