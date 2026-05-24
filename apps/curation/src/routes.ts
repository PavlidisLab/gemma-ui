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
  | "qc"
  | "diagnostics"
  | "notes"
  | "pipeline"
  | "single-cell";

export type Route =
  | { kind: "landing" }
  | { kind: "inbox" }
  | { kind: "audits-inbox" }
  | { kind: "audit-detail"; auditId: string }
  | {
      kind: "experiment";
      /** Opaque dataset identifier. Bare numeric form (e.g. ``"91654"``)
       *  resolves to the `designs` table on local_api / a real Gemma
       *  EE; the ``preboarding:N`` prefixed form resolves to the
       *  per-preboarding row in local_api's preboarding table. Both
       *  forms are accepted by the server's `/rest/v2/datasets/{id}`
       *  endpoints; the UI keeps the identifier opaque end-to-end so
       *  the round-trip is lossless. */
      id: string;
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
  // Accepts a bare numeric id OR a ``preboarding:N`` prefixed id —
  // also tolerates percent-encoded colon (``preboarding%3AN``) since
  // some encoders (incl. our older experimentRoute) escape it.
  // Downstream consumers treat the id as an opaque string after
  // decoding.
  const m = h.match(
    /^#\/experiments\/(preboarding(?::|%3A|%3a)\d+|\d+)(?:\?(.*))?$/,
  );
  if (m) {
    const params = m[2] ? new URLSearchParams(m[2]) : null;
    const tab = params?.get("tab") ?? null;
    const groupContext = params?.get("group") ?? null;
    return {
      kind: "experiment",
      id: decodeURIComponent(m[1]),
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
  id: number | string,
  tab?: ExperimentTab,
  groupContext?: string,
): string {
  const params = new URLSearchParams();
  if (tab) params.set("tab", tab);
  if (groupContext) params.set("group", groupContext);
  const qs = params.toString();
  // Don't ``encodeURIComponent`` the id — the only non-alphanumeric
  // char in the accepted forms is `:` from `preboarding:N`, which is
  // URL-path-safe per RFC 3986 (path segments allow `:`). Encoding it
  // to `%3A` works for the server but trips the hash-router into the
  // landing page on a browser back / direct URL paste. Leave it
  // literal; parseRoute also tolerates the escaped form for paste-in.
  return `#/experiments/${String(id)}${qs ? `?${qs}` : ""}`;
}

export function workflowRoute(groupId?: string): string {
  return groupId ? `#/workflow/${encodeURIComponent(groupId)}` : "#/workflow";
}
