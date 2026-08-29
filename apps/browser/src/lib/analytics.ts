// Google Analytics 4.
//
// Gemma 1.0 (gemma.msl.ubc.ca) loads GA4 property G-41V8D9335C from a
// snippet in its pages. That host is being pointed at this app, so the
// measurement has to come with it or the property goes dark at the
// cutover.
//
// Two things about this app make the 1.0 arrangement not portable:
//
//  1. **The snippet cannot live in index.html.** The same bundle is
//     served from a developer's laptop and from the public host, so an
//     unconditional snippet reports dev browsing as real traffic. The
//     loader below runs behind `isPublicOrigin`, which is the rule the
//     app already uses to tell a real deployment from a dev server.
//
//  2. **Automatic page_view would count one view per visit.** 1.0 was
//     server-rendered pages, so every navigation was a document load
//     and GA saw it for free. Here a navigation only changes the URL
//     fragment, and GA4's enhanced measurement watches the History API
//     — so every route after the first would have been invisible.
//     `send_page_view: false` turns the automatic one off and the
//     router drives them instead, first load included.

import { isPublicOrigin } from "./gemmaConfig";

/** The GA4 property. Same one Gemma 1.0 reports to, so the history is
 *  continuous across the cutover rather than restarting on a new
 *  property. Overridable for a staging property. */
const MEASUREMENT_ID: string =
  import.meta.env.VITE_GA_MEASUREMENT_ID || "G-41V8D9335C";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/** Where the app is mounted, as a path prefix — `""` at a host root,
 *  `/browser` when served from a sub-path.
 *
 *  Routes live in the fragment (see `main.tsx`), so `location.pathname`
 *  is the mount point and nothing else. Without it a sub-path install
 *  reports `/dataset/123` for a page that is really at
 *  `/browser/#/dataset/123`, silently merging two deployments' rows. */
export function mountPrefix(pathname: string): string {
  return pathname.replace(/\/(index\.html)?$/, "");
}

/** The URL to report for a route, with the fragment folded back into
 *  the path.
 *
 *  GA4 derives the "Page path" dimension from `page_location` with the
 *  fragment stripped, so reporting the address bar verbatim files every
 *  route in this app under a single `/` row. `href` is the route's own
 *  path+search, so joining it to origin and mount yields the path the
 *  reports would have shown if this app used real URLs. */
export function pageLocation(
  origin: string,
  pathname: string,
  href: string,
): string {
  return origin + mountPrefix(pathname) + href;
}

/** Minimal shape of the router this needs — narrower than the real
 *  type so a test can pass a stub. */
type Navigable = {
  subscribe: (
    event: "onResolved",
    fn: (e: { toLocation: { href: string } }) => void,
  ) => () => void;
  state: { location: { href: string } };
};

function loadGtag(id: string): void {
  const tag = document.createElement("script");
  tag.async = true;
  tag.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(tag);

  window.dataLayer = window.dataLayer || [];
  // gtag pushes the `arguments` object itself, not an array built from
  // it. The tag reads the queue expecting that shape, so a rest-args
  // spread here would not be an equivalent rewrite.
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", id, { send_page_view: false });
}

function sendPageView(href: string): void {
  window.gtag?.("event", "page_view", {
    page_location: pageLocation(
      window.location.origin,
      window.location.pathname,
      href,
    ),
    page_title: document.title,
  });
}

/** Load GA and report a page_view per route. A no-op off a public
 *  origin; returns an unsubscribe so it is not a one-way door. */
export function initAnalytics(router: Navigable): () => void {
  if (!MEASUREMENT_ID) return () => {};
  if (typeof window === "undefined") return () => {};
  if (!isPublicOrigin(window.location.origin)) return () => {};

  loadGtag(MEASUREMENT_ID);
  sendPageView(router.state.location.href);
  return router.subscribe("onResolved", (e) => sendPageView(e.toLocation.href));
}
