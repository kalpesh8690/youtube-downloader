import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import AppErrorBoundary from "./ErrorBoundary";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Downly root element is missing");

createRoot(rootElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
