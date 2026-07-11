/**
 * Entry for the click-through annotation window (annotate.html) — a SEPARATE
 * Vite entry for the same reason overlay-main.tsx is (Tauri asset protocol
 * has no history-API fallback). Only the mark-rendering surface mounts here.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
import { AnnotateApp } from "./app/avatar/AnnotateApp";

createRoot(document.getElementById("annotate-root")!).render(
  <StrictMode>
    <AnnotateApp />
  </StrictMode>,
);
