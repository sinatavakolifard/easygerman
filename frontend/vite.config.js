import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, Vite runs on :5173 and proxies /api and /audio to Flask on :5001
// (so cookies stay same-origin from the browser's perspective).
// In prod, `npm run build` outputs to dist/ and Flask serves it directly.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:5001",
      "/audio": "http://127.0.0.1:5001",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
