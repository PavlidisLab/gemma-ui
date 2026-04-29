/**
 * Hash-based router primitives. Kept here (rather than in App.tsx)
 * so leaf components can call ``navigate`` without circular imports
 * back through App.
 */

/**
 * Tabs that the experiment surface supports. Kept loose at the route
 * level — the consumer (Shell) decides whether the requested tab is
 * actually rendered. Includes "notes" as a virtual tab that opens the
 * NotesDrawer rather than switching the main panel.
 */
export type ExperimentTab =
  | "overview"
  | "design"
  | "samples"
  | "tags"
  | "proposals"
  | "history"
  | "quantitation"
  | "diagnostics"
  | "notes";

export type Route =
  | { kind: "landing" }
  | { kind: "inbox" }
  | { kind: "experiment"; id: number; tab?: ExperimentTab };

export function parseRoute(): Route {
  const h = (typeof window !== "undefined" && window.location.hash) || "";
  const m = h.match(/^#\/experiments\/(\d+)(?:\?(.*))?$/);
  if (m) {
    const tab = m[2] ? new URLSearchParams(m[2]).get("tab") : null;
    return {
      kind: "experiment",
      id: Number(m[1]),
      tab: tab ? (tab as ExperimentTab) : undefined,
    };
  }
  if (/^#\/inbox\b/.test(h)) return { kind: "inbox" };
  return { kind: "landing" };
}

export function navigate(target: string): void {
  window.location.hash = target;
}

export function experimentRoute(
  id: number,
  tab?: ExperimentTab,
): string {
  return `#/experiments/${id}${tab ? `?tab=${tab}` : ""}`;
}
