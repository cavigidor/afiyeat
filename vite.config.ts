import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "node:child_process";
import { componentTagger } from "lovable-tagger";

// Stamped into the bundle at build time so the running app can say exactly
// which build it is (see src/lib/buildInfo.ts, shown at the bottom of the
// Profile screen and logged to the console on boot).
//
// Without this, "is the device actually running the latest code?" is
// unanswerable from the outside - which is exactly the question that turned
// a one-line config problem into days of debugging: the source, the native
// build and the synced assets were all correct, while the app on the phone
// was quietly running something else entirely. A visible stamp turns that
// from an argument into a one-glance fact.
function gitShortHash(): string {
  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    // Lovable's build container (or a tarball checkout) may have no git -
    // the timestamp alone is still enough to tell two builds apart.
    return "nogit";
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    __BUILD_COMMIT__: JSON.stringify(gitShortHash()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
}));
