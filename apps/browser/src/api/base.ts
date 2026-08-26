/**
 * Where the Gemma REST API lives, as seen from the browser.
 *
 * Resolution:
 *   1. ``VITE_GEMMA_API_URL`` — build-time override.
 *   2. ``/rest/v2`` — same-origin default. In dev that's the Vite
 *      proxy fronting ``GEMMA_BASE_URL``; on a host that serves both
 *      the app and the API it's the real thing.
 *
 * Why this is configurable at all: the app only ever works
 * same-origin, and this is the knob that keeps it that way when the
 * app and the API sit at different *paths* on that origin. A direct
 * cross-origin call is not an option — Gemma's Tomcat CORS filter
 * allow-lists exactly one origin (its own) and 403s the preflight for
 * anything else. Serving the app from Gemma's own origin sidesteps
 * that entirely and the default below is already right; serving it
 * anywhere else needs a reverse proxy that strips ``Origin``, and
 * then this points at the proxy's prefix instead. Either way the
 * browser sees one origin: no preflights, no third-party cookies, and
 * ``<a download>`` links still carry the session.
 *
 * Never point this at another origin's absolute URL. It will fail the
 * preflight, and it fails at runtime in a browser rather than at
 * build time here.
 *
 * Keep this distinct from ``gemmaConfig.baseUrl``, which is the
 * absolute origin for links a *human* follows or copies (legacy JSP
 * pages, the gemmapy/curl snippets). Those must never point at a
 * proxy prefix that only exists for this app.
 */

/** API root, no trailing slash. Paths passed to `restUrl` add their own. */
export const apiBase: string = (
  import.meta.env.VITE_GEMMA_API_URL || "/rest/v2"
).replace(/\/+$/, "");

/** Join a REST path (`/datasets`, `/genes/123`) onto {@link apiBase}. */
export function restUrl(path: string): string {
  return apiBase + (path.startsWith("/") ? path : `/${path}`);
}
