const PAGES_MODE = process.env.GITHUB_PAGES === '1';
const REPO_NAME = 'type-any-language';
// GitHub Pages serves project pages under https://<user>.github.io/<repo>/
const PAGES_BASE_PATH = `/${REPO_NAME}`;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Docker prod 路径:standalone(给 nginx + standalone server 用)。
  // GitHub Pages / Vercel static 路径(GITHUB_PAGES=1):纯静态 export。
  // 二选一,不能同时开 —— `images.unoptimized` 是 `output: 'export'` 的硬性要求。
  ...(PAGES_MODE
    ? {
        output: 'export',
        basePath: PAGES_BASE_PATH,
        assetPrefix: PAGES_BASE_PATH,
        images: { unoptimized: true },
      }
    : {
        output: 'standalone',
      }),
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
  },
  // 允许 build 写到独立目录,避免污染正在跑的 `next dev` 用的 `.next`。
  // 用法:NEXT_DIST_DIR=.next-build npx next build
  // dev server 仍默认用 `.next`(NEXT_DIST_DIR 未设置)。
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

module.exports = nextConfig;
