import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "node:path"

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // During dev, the Vite server proxies /api/* to the Python backend
      // running on :9090 so we don't need CORS handling in fetch().
      "/api": {
        target: "http://127.0.0.1:9090",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "es2020",
  },
})
