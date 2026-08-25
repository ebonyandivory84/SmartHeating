import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  root: "admin-src",
  base: "./",
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, "admin"),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        index_m: resolve(__dirname, "admin-src/index_m.html"),
        dashboard: resolve(__dirname, "admin-src/dashboard.html")
      }
    }
  },
  server: {
    port: 3000
  }
});
