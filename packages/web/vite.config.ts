import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiBase = process.env.CODEXNAMER_API_BASE ?? process.env.CSM_API_BASE ?? "http://127.0.0.1:42110";
const webPort = Number(process.env.CODEXNAMER_WEB_PORT ?? process.env.CSM_WEB_PORT ?? "43110");

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: Number.isFinite(webPort) ? webPort : 43110,
    proxy: {
      "/api": {
        target: apiBase,
        changeOrigin: true
      }
    }
  }
});
