/**
 * Entry for the Zazoo Lab (zazoo.html) — separate Vite entry like
 * overlay.html (Tauri asset protocol has no history-API fallback), and it
 * keeps the lab out of the main app bundle.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ZazooLab } from "./app/avatar/zazoo/ZazooLab";

createRoot(document.getElementById("zazoo-root")!).render(
  <StrictMode>
    <ZazooLab />
  </StrictMode>,
);
