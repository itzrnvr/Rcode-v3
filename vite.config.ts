import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

/*
 * The browser API server's port. electron/api/webServer.ts reads the same
 * variable with the same default, so the dev proxy and the server cannot
 * disagree — change this in one place only.
 */
const API_PORT = Number(process.env.RCODE_WEB_API_PORT ?? 5174);
const DEV_PORT = Number(process.env.RCODE_DEV_PORT ?? 5173);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  build: {
    outDir: "dist/renderer",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        preview: resolve(__dirname, "preview.html"),
        gallery: resolve(__dirname, "gallery.html"),
        oneui: resolve(__dirname, "oneui.html"),
      },
    },
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  server: {
    host: process.env.RCODE_DEV_HOST ?? "0.0.0.0",
    port: DEV_PORT,
    allowedHosts: true,
    // Never fall through to another port: Vite's auto-increment previously
    // claimed 5174, which is the API server, producing a confusing half-working
    // dev loop instead of a clear "port in use" failure.
    strictPort: true,
    proxy: {
      "/api/ipc": { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: true },
      "/api/events": {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: true,
        // Keep SSE frames flowing through Vite in development.
        configure: proxy => { proxy.on("proxyRes", proxyRes => { proxyRes.headers["cache-control"] = "no-store, no-transform"; }); },
      },
      "/api/health": { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: true },
    },
  },
});
