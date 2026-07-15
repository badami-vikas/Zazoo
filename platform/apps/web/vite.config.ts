import { defineConfig } from "vite";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      // Three entries: the main app + the desktop companion window (R-002)
      // + the click-through annotation window (desktop-companion.md P1).
      // overlay.html/annotate.html are real files (not SPA routes) because
      // the Tauri asset protocol has no history-API fallback.
      input: {
        main: path.resolve(__dirname, "index.html"),
        overlay: path.resolve(__dirname, "overlay.html"),
        annotate: path.resolve(__dirname, "annotate.html"),
        // Zazoo Lab — companion emotional-performance test surface (Egg track).
        zazoo: path.resolve(__dirname, "zazoo.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
