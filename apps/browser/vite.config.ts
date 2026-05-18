import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

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
        secure: true,
      },
    },
  },
});
