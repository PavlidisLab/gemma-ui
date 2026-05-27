/**
 * Cross-app link helpers — mirror of the curation app's
 * ``lib/appLinks.ts``. Browser and curation are separate vite
 * builds on different origins; the shared top bar needs a stable
 * URL into the curation app.
 *
 * Resolution:
 *   1. ``VITE_CURATION_URL`` build-time override.
 *   2. Local-mode dev default (``http://localhost:5175``).
 */

const CURATION_URL: string =
  (import.meta.env.VITE_CURATION_URL as string | undefined)?.replace(/\/$/, "") ||
  "http://localhost:5175";

/** Absolute URL into the curation app. ``path`` defaults to the
 *  curator dashboard (the hash-router landing). */
export function curationUrl(path: string = "/#/"): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${CURATION_URL}${p}`;
}
