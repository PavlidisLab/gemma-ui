import type { FullConfig } from "@playwright/test";

/**
 * Probe the curation backend ONCE per run and stash the result in
 * ``process.env.CURATION_BACKEND_UP`` (inherited by every worker). A
 * ``@live`` spec's ``requiresBackend()`` reads it and skips when down —
 * so the backend-integration suite runs only when the backend is
 * available, never failing red just because the store is offline.
 *
 * "Up" = the server answered at all. A 200/400/401/403 all mean it's
 * reachable (auth/shape is the spec's business); only a connection
 * error or timeout counts as down.
 */
export default async function globalSetup(_config: FullConfig) {
  const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5175";
  let up: boolean;
  try {
    const res = await fetch(`${base}/rest/v2/datasets?limit=1`, {
      signal: AbortSignal.timeout(3000),
    });
    up = res.status > 0; // any HTTP response means the server is reachable
  } catch {
    up = false;
  }
  process.env.CURATION_BACKEND_UP = up ? "1" : "0";
  if (!up) {
    console.log(
      `[e2e] backend probe failed at ${base}/rest — @live specs will SKIP. ` +
        `Mocked specs (the pre-commit @critical gate) are unaffected.`,
    );
  }
}
