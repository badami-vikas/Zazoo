/**
 * Entry for the click-through annotation window (annotate.html) — a SEPARATE
 * Vite entry for the same reason overlay-main.tsx is (Tauri asset protocol
 * has no history-API fallback). Only the mark-rendering surface mounts here.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
import { AnnotateApp } from "./app/avatar/AnnotateApp";
import { installOverlayLabStub } from "./app/avatar/overlay-lab-stub";

// `annotate.html?lab=1` in a plain browser: stub the Tauri bridge so marks and
// the pointer glyph can be driven with window.__OVERLAY_LAB__.emit(...).
installOverlayLabStub();

createRoot(document.getElementById("annotate-root")!).render(
  <StrictMode>
    <AnnotateApp />
  </StrictMode>,
);
