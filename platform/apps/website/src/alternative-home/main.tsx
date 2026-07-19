import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AlternativeHome } from "./AlternativeHome";
import "./alt.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AlternativeHome />
  </StrictMode>,
);
