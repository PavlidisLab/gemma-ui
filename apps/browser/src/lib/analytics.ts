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

/** How long a titled route waits for its page to name the tab before
 *  the view goes out anyway, under whatever title it has. A dataset
 *  that fails to load never names itself; past this, waiting longer
 *  only risks losing the view to a tab that gets closed. */
export const TITLE_WAIT_MS = 3000;

/** Minimal shape of the router this needs — narrower than the real
 *  type so a test can pass a stub. */
type Navigable = {
  subscribe: (
    event: "onResolved",
    fn: (e: { toLocation: { href: string } }) => void,
  ) => () => void;
  state: { matches: ReadonlyArray<{ staticData?: { titled?: boolean } }> };
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

/** Report one page_view per route, after its page has named the tab.
 *
 *  GA files `page_title` from `document.title` at the moment the event
 *  is sent. A dataset page names the tab ("GSE2872 · Gemma Browser")
 *  only once its fetch lands, hundreds of ms after the route resolves,
 *  so sending on resolve filed every page under the bare app name. A
 *  route marked `staticData: { titled: true }` therefore holds its view
 *  until the title moves off `appTitle`, or `TITLE_WAIT_MS` passes.
 *
 *  Comparing against the app name is enough because by the time
 *  `onResolved` fires the new page has rendered once: a page still
 *  loading has already put the bare app name back, so a stale title
 *  from the page before cannot be mistaken for this one's.
 *
 *  Exported for tests; `initAnalytics` is the entry point. */
export function trackPageViews(
  router: Navigable,
  appTitle: string,
  send: (href: string) => void,
): () => void {
  let lastHref: string | undefined;
  let pending: { href: string; stop: () => void } | null = null;

  const flush = () => {
    if (!pending) return;
    const { href, stop } = pending;
    pending = null;
    stop();
    send(href);
  };

  const onRoute = (href: string) => {
    // onResolved fires whenever the router's pending work settles, not
    // only on a navigation. Same href, same view.
    if (href === lastHref) return;
    lastHref = href;
    // A page left before it named itself was still seen.
    flush();

    const titled = router.state.matches.some((m) => m.staticData?.titled);
    if (!titled || document.title !== appTitle) {
      send(href);
      return;
    }
    const observer = new MutationObserver(() => {
      if (document.title !== appTitle) flush();
    });
    observer.observe(document.head, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    const timer = setTimeout(flush, TITLE_WAIT_MS);
    pending = {
      href,
      stop: () => {
        observer.disconnect();
        clearTimeout(timer);
      },
    };
  };

  // Closing the tab while a view is held must not drop it; gtag sends
  // over sendBeacon, which survives pagehide.
  window.addEventListener("pagehide", flush);
  // No send for the initial location here: the router has not matched
  // it yet, so whether it is titled is unknown. The first load's own
  // onResolved reports it.
  const unsubscribe = router.subscribe("onResolved", (e) =>
    onRoute(e.toLocation.href),
  );
  return () => {
    unsubscribe();
    window.removeEventListener("pagehide", flush);
    pending?.stop();
    pending = null;
  };
}

/** Load GA and report a page_view per route. A no-op off a public
 *  origin or without a measurement ID; returns an unsubscribe so it is
 *  not a one-way door. Call before the first render, so `document.title`
 *  is still index.html's — that is the app name titled pages replace. */
export function initAnalytics(router: Navigable): () => void {
  if (!MEASUREMENT_ID) return () => {};
  if (typeof window === "undefined") return () => {};
  if (!isPublicOrigin(window.location.origin)) return () => {};

  loadGtag(MEASUREMENT_ID);
  return trackPageViews(router, document.title, sendPageView);
}
