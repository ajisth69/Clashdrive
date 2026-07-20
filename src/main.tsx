import { Buffer } from "buffer";

// Expose Buffer globally across all environments
if (typeof window !== "undefined") {
  (window as any).Buffer = Buffer;
}
if (typeof global !== "undefined") {
  (global as any).Buffer = Buffer;
}
if (typeof globalThis !== "undefined") {
  (globalThis as any).Buffer = Buffer;
}

// Override Symbol.hasInstance on Buffer to handle reference mismatches in different bundler contexts
try {
  Object.defineProperty(Buffer, Symbol.hasInstance, {
    value: function (instance: any) {
      return (
        instance &&
        (instance.constructor?.name === "Buffer" ||
          Buffer.isBuffer(instance))
      );
    },
    configurable: true,
  });
} catch (e) {
  console.warn("Failed to define custom Symbol.hasInstance on Buffer:", e);
}

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("ServiceWorker registration failed: ", err);
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
