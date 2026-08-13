import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
import { App } from "./app/App";
import { installDesktopNavigation } from "./app/lib/desktop-navigation";
import { router } from "./app/routes";

// Dev-only: mirrors the Tauri shell's window init script (desktop-shell.d.ts)
// so a plain `vite dev` preview can authenticate against a standalone API
// sidecar without a desktop build. Never set outside local development.
if (import.meta.env.DEV && import.meta.env.VITE_BRIDGE_SIDECAR_TOKEN) {
  window.__BRIDGE_SIDECAR_TOKEN__ = import.meta.env.VITE_BRIDGE_SIDECAR_TOKEN;
}

void installDesktopNavigation((route) => router.navigate(route)).catch((error: unknown) => {
  console.error("[desktop-navigation] listener failed", error);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
