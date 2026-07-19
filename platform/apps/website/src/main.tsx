import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ZazooWebsite } from "./ZazooWebsite";
import "./website.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ZazooWebsite />
  </StrictMode>,
);
