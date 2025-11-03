import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy all HTTP API requests
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      // Proxy all WebSocket requests
      "/ws": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        ws: true,
        rewrite: (path) => {
          console.log("Proxying WebSocket path:", path);
          return path;
        },
      },
    },
  },
});
