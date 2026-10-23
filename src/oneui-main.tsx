import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import OneUIDemo from "./components/dev/OneUIDemo";
import "./index.css";
import "./oneui.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <OneUIDemo />
  </StrictMode>,
);
