import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Gallery from "./components/dev/Gallery";
import "./index.css";
import "./gallery.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
