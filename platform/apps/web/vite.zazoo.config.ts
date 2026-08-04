/**
 * Standalone build for the Zazoo Lab, which ships as the `/oldplatform` page
 * on badami-vikas.github.io. It is deliberately separate from vite.config.ts:
 * the lab imports nothing from the @bridge workspace packages, so building it
 * on its own keeps the deploy independent of the platform build. Relative
 * `base` is required — the page is served from a subdirectory.
 *
 *   node node_modules/vite/bin/vite.js build --config vite.zazoo.config.ts
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  // pinned so the build/preview work from any working directory
  root: __dirname,
  base: "./",
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: {
    outDir: "dist-oldplatform",
    emptyOutDir: true,
    rollupOptions: { input: { zazoo: path.resolve(__dirname, "zazoo.html") } },
  },
});
