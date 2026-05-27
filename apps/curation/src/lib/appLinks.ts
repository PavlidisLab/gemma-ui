/**
 * Cross-app link helpers — the browser site and the curation site
 * are two separate vite builds served on different origins (in
 * local-mode docker: browser :5183, curation :5175). To put one
 * top bar across both, we need stable URLs back to the other app.
 *
 * Resolution:
 *   1. Build-time env override (``VITE_BROWSER_URL``) — set by the
 *      deployer when both apps live behind a reverse proxy (e.g.
 *      `https://gemma.msl.ubc.ca/` for browser, `/curation/` for
 *      curation).
 *   2. Local-mode dev default (``http://localhost:5183``) so the
 *      bar's "Browse" link works out of the box when both apps are
 *      brought up via ``docker/local-mode/up.sh``.
 *
 * Standalone vite dev (no docker, both apps on the same machine)
 * usually means each app is on its own ad-hoc port — set
 * ``VITE_BROWSER_URL`` in ``apps/curation/.env.local`` to override.
 */

const BROWSER_URL: string =
  (import.meta.env.VITE_BROWSER_URL as string | undefined)?.replace(/\/$/, "") ||
  "http://localhost:5183";

/** Absolute URL into the browser app for the given path. */
export function browserUrl(path: string = "/"): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${BROWSER_URL}${p}`;
}

/** Admin lives in the browser app under ``/admin/system``. */
export function adminUrl(): string {
  return browserUrl("/admin/system");
}
