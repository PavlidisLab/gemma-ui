import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Default: staging Gemma (1.x, always up).
// For Gemma 2.0 local dev: GEMMA_BASE_URL=http://localhost:9080
// Use port 9080 (not 8080) — the curation mock runs on 8080 and
// the two must not collide. See GEMMA_WEB_2_0.md for full setup.
const GEMMA_TARGET = process.env.GEMMA_BASE_URL || "https://staging-gemma.msl.ubc.ca";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    // 5183 to leave 5173 to the curation app (default Vite port) so
    // both can run in parallel without the auto-bump dance.
    port: 5183,
    proxy: {
      "/rest": {
        target: GEMMA_TARGET,
        changeOrigin: true,
        // secure: false when targeting a local http:// server
        secure: !GEMMA_TARGET.startsWith("http://"),
      },
    },
  },
});
