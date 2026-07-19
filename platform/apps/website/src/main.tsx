import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ZazooWebsite } from "./ZazooWebsite";
import "./website.css";

createRoot(document.querySelector("#root")!).render(
  <StrictMode>
    <ZazooWebsite />
  </StrictMode>,
);
