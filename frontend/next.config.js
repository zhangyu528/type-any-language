/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  env: {
    // NEXT_PUBLIC_* is baked into the client JS at first render in dev mode,
    // so this resolves before `next dev` boots. Fallback uses BACKEND_PORT
    // (if the host exports it) so changing the backend port doesn't leave
    // the frontend pointing at a stale default.
    NEXT_PUBLIC_API_URL:
      process.env.NEXT_PUBLIC_API_URL
      || `http://localhost:${process.env.BACKEND_PORT || 8000}`,
  },
  // 允许 build 写到独立目录,避免污染正在跑的 `next dev` 用的 `.next`。
  // 用法:NEXT_DIST_DIR=.next-build npx next build
  // dev server 仍默认用 `.next`(NEXT_DIST_DIR 未设置)。
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

module.exports = nextConfig;