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
    port: 5173,
    proxy: {
      "/rest": {
        target: GEMMA_TARGET,
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
