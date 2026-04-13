import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiBase = process.env.CODEXNAMER_API_BASE ?? "http://127.0.0.1:42110";
const webPort = Number(process.env.CODEXNAMER_WEB_PORT ?? "43110");

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/scheduler/")
          ) {
            return "react-vendor";
          }

          return undefined;
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: Number.isFinite(webPort) ? webPort : 43110,
    proxy: {
      "/api": {
        target: apiBase,
        changeOrigin: true,
      },
    },
  },
});
