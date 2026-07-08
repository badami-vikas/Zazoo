/**
 * Entry for the desktop companion window (overlay.html) — a SEPARATE Vite
 * entry rather than an SPA route because the Tauri asset protocol serves
 * files without history-API fallback. Only the avatar companion mounts here;
 * none of the main app shell.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
import { OverlayApp } from "./app/avatar/OverlayApp";

createRoot(document.getElementById("overlay-root")!).render(
  <StrictMode>
    <OverlayApp />
  </StrictMode>,
);
