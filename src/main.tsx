import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import { CapacitorUpdater } from '@capgo/capacitor-updater';

// Confirm this bundle started successfully so Capgo can keep it instead of rolling back to the previous bundle.
CapacitorUpdater.notifyAppReady();
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>
);
