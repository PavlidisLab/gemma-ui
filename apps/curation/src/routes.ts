/**
 * Hash-based router primitives. Kept here (rather than in App.tsx)
 * so leaf components can call ``navigate`` without circular imports
 * back through App.
 */
import { parseSource, type Source } from "./features/comparison/sources";

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
  | { kind: "all-experiments" }
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
      /** Active Ticket context (mutually exclusive with
       *  ``groupContext``). When present, the banner renders a
       *  ticket breadcrumb + prev/next walking the ticket's
       *  targets — same pattern groups use. */
      ticketContext?: string;
      /** Baseline-slot occupant for the comparison chip strip.
       *  Persisted as ``?base=<source>`` so the URL is shareable.
       *  Spec: ``docs/CURATION_COMPARISON_VIEW_2026_05_27.md``. */
      baselineSource?: Source;
      /** Comparator-slot occupant; persisted as ``?cmp=<source>``. */
      comparatorSource?: Source;
    }
  | { kind: "audit-preview" }
  | { kind: "proposal-preview" }
  | { kind: "dev-statement-chip" }
  | { kind: "workflow"; groupId?: string }
  | { kind: "ticket"; ticketId: number };

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
    const ticketContext = params?.get("ticket") ?? null;
    const baselineSource = parseSource(params?.get("base"));
    const comparatorSource = parseSource(params?.get("cmp"));
    return {
      kind: "experiment",
      id: decodeURIComponent(m[1]),
      tab: tab ? (tab as ExperimentTab) : undefined,
      groupContext: groupContext || undefined,
      ticketContext: ticketContext || undefined,
      baselineSource: baselineSource ?? undefined,
      comparatorSource: comparatorSource ?? undefined,
    };
  }
  if (/^#\/all-experiments\b/.test(h)) return { kind: "all-experiments" };
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
  if (/^#\/dev\/statement-chip\b/.test(h)) return { kind: "dev-statement-chip" };
  // Fixture-driven preview for the new per-element proposal review
  // surface. Paste #/proposal-preview into the URL bar. Removed once
  // the live ``CurationWorkspace`` entity lands.
  if (/^#\/proposal-preview\b/.test(h)) return { kind: "proposal-preview" };
  const workflowGroupMatch = h.match(/^#\/workflow\/([^/?#]+)/);
  if (workflowGroupMatch) {
    return { kind: "workflow", groupId: decodeURIComponent(workflowGroupMatch[1]) };
  }
  if (/^#\/workflow\b/.test(h)) return { kind: "workflow" };
  // Tickets are the canonical work-item surface (sets retired 2026-05-26).
  // ``#/tickets/{id}`` lands on the per-ticket detail page; the bare
  // ``#/tickets`` list view is deferred.
  const ticketMatch = h.match(/^#\/tickets\/(\d+)/);
  if (ticketMatch) {
    return { kind: "ticket", ticketId: parseInt(ticketMatch[1], 10) };
  }
  return { kind: "landing" };
}

/** Navigation blocker contract. Each registered blocker is consulted
 *  before ``navigate`` actually mutates the hash. A blocker returns:
 *
 *   - ``true`` (or any non-Promise truthy value): proceed
 *   - ``false`` (or any non-Promise falsy value): cancel
 *   - ``Promise<boolean>``: defer until resolved; ``true`` proceeds,
 *     ``false`` cancels
 *
 *  Blockers run in registration order; the first one that cancels
 *  wins (subsequent blockers don't run). This matches what a curator
 *  expects when two surfaces both want to gate the same navigation —
 *  the inner one (modal currently visible) usually registered last
 *  and should preempt.
 *
 *  Used by ``LeaveJobGuard`` to ask the curator about pending
 *  proposal/audit work before they navigate away from an EE page. */
export type NavigationBlocker = (target: string) => boolean | Promise<boolean>;

const blockers: NavigationBlocker[] = [];

export function registerNavigationBlocker(b: NavigationBlocker): () => void {
  blockers.push(b);
  return () => {
    const i = blockers.indexOf(b);
    if (i >= 0) blockers.splice(i, 1);
  };
}

export function navigate(target: string): void {
  if (blockers.length === 0) {
    window.location.hash = target;
    return;
  }
  // Walk blockers in reverse so the most-recently-mounted modal (the
  // foreground UI the user is looking at) gets to ask first.
  const queue = [...blockers].reverse();
  void (async () => {
    for (const b of queue) {
      const result = b(target);
      const ok = result instanceof Promise ? await result : result;
      if (!ok) return;
    }
    window.location.hash = target;
  })();
}

export function experimentRoute(
  id: number | string,
  tab?: ExperimentTab,
  groupContext?: string,
  ticketContext?: string,
  /** Comparison chip-strip selection — preserved across tab switches
   *  so the curator's "what am I looking at" framing doesn't reset
   *  when they navigate tabs. Both fields omitted ⇒ no chip params
   *  in the URL (defaults take over). */
  chips?: { base?: Source; cmp?: Source },
): string {
  const params = new URLSearchParams();
  if (tab) params.set("tab", tab);
  if (groupContext) params.set("group", groupContext);
  if (ticketContext) params.set("ticket", ticketContext);
  if (chips?.base) params.set("base", chips.base);
  if (chips?.cmp) params.set("cmp", chips.cmp);
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
