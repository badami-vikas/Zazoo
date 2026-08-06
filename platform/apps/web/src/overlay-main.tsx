/**
 * Entry for the desktop companion window (overlay.html) — a SEPARATE Vite
 * entry rather than an SPA route because the Tauri asset protocol serves
 * files without history-API fallback. Only the avatar companion mounts here;
 * none of the main app shell.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
import { installOverlayLabStub } from "./app/avatar/overlay-lab-stub";
import { OverlayApp } from "./app/avatar/OverlayApp";

// `overlay.html?lab=1` in a plain browser: stub the Tauri bridge so the
// companion UI is drivable/verifiable outside the desktop shell (same spirit
// as zazoo.html). Inert in the real app — the shell never adds the param, and
// the stub refuses to overwrite a real bridge.
installOverlayLabStub();

createRoot(document.getElementById("overlay-root")!).render(
  <StrictMode>
    <OverlayApp />
  </StrictMode>,
);
