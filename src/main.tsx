import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { BUILD_COMMIT, BUILD_TIME } from "@/lib/buildInfo";

// Confirm this bundle started successfully so Capgo can keep it instead of rolling back to the previous bundle.
CapacitorUpdater.notifyAppReady();

// First thing in the console on every launch, so attaching Safari Web
// Inspector to the device answers "which build is this?" immediately -
// including when the answer is "not the one you just installed".
console.info(`[Afiyeat] build ${BUILD_COMMIT} (${BUILD_TIME})`);

import "./index.css";

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>
);
