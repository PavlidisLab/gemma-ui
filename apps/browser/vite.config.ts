import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { execSync } from "node:child_process";

/** Resolve the current git commit SHA at build time. Stamped into
 *  the page via `__GEMMA_BUILD_SHA__` so a curator can tell at a
 *  glance which commit they're running. Falls back to "dev" on a
 *  non-git checkout. */
function buildSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500,
    })
      .toString()
      .trim();
  } catch {
    return "dev";
  }
}

/** Same source as buildSha, but the full 40-char form for deep
 *  links to GitHub commits. */
function buildShaFull(): string {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500,
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

// Resolution order for the upstream Gemma server:
//   1. ``GEMMA_BASE_URL`` env (set in `apps/browser/.env.local` or
//      exported in the shell) — required, no built-in default.
//   2. a local Gemma instance, e.g. ``http://localhost:8080``
export default defineConfig(({ mode }) => {
  // loadEnv: read .env / .env.local / .env.<mode> + .env.<mode>.local.
  // Third arg "" disables the default VITE_ prefix filter so we can
  // surface plain ``GEMMA_BASE_URL`` (the historical name).
  const env = loadEnv(mode, process.cwd(), "");
  const GEMMA_TARGET = env.GEMMA_BASE_URL || "";
  // Public base path. The dev server serves from the origin root, but a
  // deployed build may be mounted under a sub-path, and every emitted
  // asset URL has to carry that prefix or it resolves against the
  // origin root and 404s. Set `VITE_BASE_PATH` in `.env.production` (or
  // from the shell for a differently-mounted deploy); unset means "/",
  // i.e. served from an origin root.
  //
  // Normalised to leading + trailing slash — Vite requires both, and
  // `import.meta.env.BASE_URL` mirrors whatever lands here.
  const trimmedBase = (env.VITE_BASE_PATH || "").replace(/^\/+|\/+$/g, "");
  const BASE_PATH = trimmedBase ? `/${trimmedBase}/` : "/";
  if (!GEMMA_TARGET) {
    console.warn(
      "[browser] GEMMA_BASE_URL not set — set it in .env.local to your Gemma instance before starting the dev server",
    );
  }
  const proxy: Record<string, ProxyOptions> = {};
  if (GEMMA_TARGET) {
    proxy["/rest"] = {
      target: GEMMA_TARGET,
      changeOrigin: true,
      // secure: false when targeting a local http:// server
      secure: !GEMMA_TARGET.startsWith("http://"),
      configure: (proxy) => {
        // One-shot log so a curator can confirm which upstream the
        // dev server is fronting without grepping vite.config.

        console.log(`[browser] /rest → ${GEMMA_TARGET}`);
        // STRIP Origin + Referer entirely. Tomcat's CORS
        // filter (web.xml /rest/v2/* mapping) 403s every Origin
        // it sees — even the server's own host. Verified by
        // probing with curl: Origin: http://localhost:8080 →
        // "Invalid CORS request"; no Origin header → 401 clean.
        // So the allow-list is empty / not honored, and the
        // only way through is to make the request look
        // non-CORS by removing the header. The browser sends
        // Origin automatically on every cross-origin fetch;
        // we strip it before forwarding upstream.
        proxy.on("proxyReq", (proxyReq) => {
          proxyReq.removeHeader("origin");
          proxyReq.removeHeader("referer");
        });
        proxy.on("error", (err) => {

          console.error(`[browser] proxy error: ${err.message}`);
        });
      },
    };
  }
  return {
    base: BASE_PATH,
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
        "@gemma/assets": path.resolve(__dirname, "../../packages/assets/src"),
        "@gemma/diagnostics": path.resolve(__dirname, "../../packages/diagnostics/src"),
        "@gemma/heatmap": path.resolve(__dirname, "../../packages/heatmap/src"),
        "@gemma/ontology": path.resolve(__dirname, "../../packages/ontology/src"),
        "@gemma/ui": path.resolve(__dirname, "../../packages/ui/src"),
      },
    },
    // Expose the resolved upstream URL to the client so a footer
    // chip can surface "which Gemma am I talking to". The /rest
    // proxy hides this from the runtime client otherwise.
    define: {
      __GEMMA_TARGET__: JSON.stringify(GEMMA_TARGET),
      __GEMMA_BUILD_SHA__: JSON.stringify(buildSha()),
      __GEMMA_BUILD_SHA_FULL__: JSON.stringify(buildShaFull()),
      __GEMMA_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
    server: {
      // 5183 to leave 5173 to the curation app (default Vite port) so
      // both can run in parallel without the auto-bump dance.
      port: 5183,
      // Polling fallback for the watcher. Docker-on-macOS bind-mounts
      // don't deliver inotify events from host edits, so HMR misses
      // workspace-package source changes (the @gemma/* aliases point
      // outside the app root). Flip on with ``VITE_USE_POLLING=1`` in
      // the docker-compose env; left off by default so direct-on-host
      // dev doesn't pay the CPU cost.
      watch:
        env.VITE_USE_POLLING === "1"
          ? { usePolling: true, interval: 500 }
          : undefined,
      proxy,
    },
  };
});
