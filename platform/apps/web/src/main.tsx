import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
import { App } from "./app/App";
import { installDesktopNavigation } from "./app/lib/desktop-navigation";
import { router } from "./app/routes";

void installDesktopNavigation((route) => router.navigate(route)).catch((error: unknown) => {
  console.error("[desktop-navigation] listener failed", error);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
