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
  | "notes"
  | "pipeline";

export type Route =
  | { kind: "landing" }
  | { kind: "inbox" }
  | { kind: "audits-inbox" }
  | { kind: "audit-detail"; auditId: string }
  | {
      kind: "experiment";
      id: number;
      tab?: ExperimentTab;
      /** Active workflow Group context. When present, the experiment
       *  banner renders an inline prev/next nav cluster anchored to
       *  this group; member-list clicks elsewhere preserve it so the
       *  curator stays in-set as they walk the queue. */
      groupContext?: string;
    }
  | { kind: "audit-preview" }
  | { kind: "proposal-preview" }
  | { kind: "workflow"; groupId?: string };

export function parseRoute(): Route {
  const h = (typeof window !== "undefined" && window.location.hash) || "";
  const m = h.match(/^#\/experiments\/(\d+)(?:\?(.*))?$/);
  if (m) {
    const params = m[2] ? new URLSearchParams(m[2]) : null;
    const tab = params?.get("tab") ?? null;
    const groupContext = params?.get("group") ?? null;
    return {
      kind: "experiment",
      id: Number(m[1]),
      tab: tab ? (tab as ExperimentTab) : undefined,
      groupContext: groupContext || undefined,
    };
  }
  if (/^#\/inbox\b/.test(h)) return { kind: "inbox" };
  // Standalone single-audit detail page; matched BEFORE the
  // ``#/audits`` inbox prefix because the inbox would otherwise
  // swallow the more-specific path. ``audit_id`` is opaque to the
  // router — server-assigned, free-form.
  const auditMatch = h.match(/^#\/audits\/([^/?#]+)/);
  if (auditMatch) {
    return { kind: "audit-detail", auditId: decodeURIComponent(auditMatch[1]) };
  }
  // Cross-experiment audit inbox (mirror of #/inbox for proposals).
  // Lists all `AuditReport`s in the mock; default-filters to
  // actionable verdicts (blockers + major_issues).
  if (/^#\/audits\b/.test(h)) return { kind: "audits-inbox" };
  // Fixture-driven preview surface for the audit feature in
  // development. Renders the bundled sample report so we can iterate
  // on the UI before /audit/* endpoints are live. Hidden from the
  // landing page navigation — paste the URL or follow a dev link.
  if (/^#\/audit-preview\b/.test(h)) return { kind: "audit-preview" };
  // Fixture-driven preview for the new per-element proposal review
  // surface. Paste #/proposal-preview into the URL bar. Removed once
  // the live ``CurationWorkspace`` entity lands.
  if (/^#\/proposal-preview\b/.test(h)) return { kind: "proposal-preview" };
  const workflowGroupMatch = h.match(/^#\/workflow\/([^/?#]+)/);
  if (workflowGroupMatch) {
    return { kind: "workflow", groupId: decodeURIComponent(workflowGroupMatch[1]) };
  }
  if (/^#\/workflow\b/.test(h)) return { kind: "workflow" };
  return { kind: "landing" };
}

export function navigate(target: string): void {
  window.location.hash = target;
}

export function experimentRoute(
  id: number,
  tab?: ExperimentTab,
  groupContext?: string,
): string {
  const params = new URLSearchParams();
  if (tab) params.set("tab", tab);
  if (groupContext) params.set("group", groupContext);
  const qs = params.toString();
  return `#/experiments/${id}${qs ? `?${qs}` : ""}`;
}

export function workflowRoute(groupId?: string): string {
  return groupId ? `#/workflow/${encodeURIComponent(groupId)}` : "#/workflow";
}
