import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      "Content-Security-Policy":
        "script-src 'self' 'unsafe-eval' 'unsafe-inline'; connect-src *;",
    },
    proxy: {
      "/hiro-api": {
        target: "https://api.hiro.so",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/hiro-api/, ""),
      },
    },
  },
});