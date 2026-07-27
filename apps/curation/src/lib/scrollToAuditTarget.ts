/**
 * Cross-tab "focus the curation element this audit finding is about"
 * plumbing. Sister to `scrollToSample.ts`, but generalised across
 * every `target_kind`.
 *
 * A finding card click (or "Apply & focus" press) calls
 * `requestAuditFocus(experimentId, targetId)`. The Shell parses
 * `targetId` to decide which tab the element lives on
 * (factor/fv → design, tag/experiment → overview, assignment →
 * samples), switches the tab, and re-fires `gemma:audit-focus-target`
 * once render has flushed. Each panel that owns a target_kind
 * listens for the second event and runs the actual scroll +
 * ring-flash against `[data-audit-target="…"]`.
 *
 * Why two events instead of one: when the request fires from the
 * audit sidebar, the destination panel often isn't mounted yet —
 * switching tabs triggers a render. Waiting two RAFs after the tab
 * switch reliably gets us past the panel's first paint and its
 * useEffect listener attach. Same pattern as
 * `dispatchSamplesScrollRow` in scrollToSample.ts.
 *
 * Sample assignments are a special case: they go through the
 * existing `requestSampleScroll` so the samples panel only needs
 * one focus listener (data-bm-shortname) instead of two. The Shell
 * detects `assignment:` targets up front and routes accordingly.
 */
import type { ExperimentTab } from "@/routes";
import { parseTargetId } from "@/features/audit/targetIds";

const REQUEST_EVENT = "gemma:request-audit-focus";
const FOCUS_EVENT = "gemma:audit-focus-target";

export interface RequestAuditFocusDetail {
  experimentId: number | string;
  targetId: string;
  /** Optional CSS selector to prefer over the generic
   *  `[data-audit-target="<targetId>"]` lookup. Used by issue-code-
   *  specific apply actions where the audit's target_id points at
   *  a virtual anchor (e.g. `experiment:1234` for a `missing_tag`
   *  finding) and the *actual* element worth focusing is the
   *  affordance the curator needs to use (the tags section in this
   *  case). Tried first; falls back to data-audit-target if not
   *  found. */
  focusSelector?: string;
}

export interface AuditFocusTargetDetail {
  targetId: string;
  focusSelector?: string;
}

/** Caller-facing API: ask the app to focus the UI element this
 *  finding is anchored to. No-op when no Shell is mounted.
 *
 *  Pass `focusSelector` to override the default
 *  `[data-audit-target="<targetId>"]` resolution — useful for
 *  experiment-kind findings whose target_id points at the
 *  experiment shell but whose curator-meaningful affordance lives
 *  in a specific section (tags / factors / etc). */
export function requestAuditFocus(
  experimentId: number | string,
  targetId: string,
  focusSelector?: string,
): void {
  window.dispatchEvent(
    new CustomEvent<RequestAuditFocusDetail>(REQUEST_EVENT, {
      detail: { experimentId, targetId, focusSelector },
    }),
  );
}

export function onRequestAuditFocus(
  handler: (detail: RequestAuditFocusDetail) => void,
): () => void {
  function listener(e: Event) {
    handler((e as CustomEvent<RequestAuditFocusDetail>).detail);
  }
  window.addEventListener(REQUEST_EVENT, listener);
  return () => window.removeEventListener(REQUEST_EVENT, listener);
}

/** Shell-facing: re-dispatch as a focus event once the destination
 *  panel is mounted. Two RAFs mirror dispatchSamplesScrollRow. */
export function dispatchAuditFocusTarget(targetId: string): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent<AuditFocusTargetDetail>(FOCUS_EVENT, {
          detail: { targetId },
        }),
      );
    });
  });
}

export function onAuditFocusTarget(
  handler: (detail: AuditFocusTargetDetail) => void,
): () => void {
  function listener(e: Event) {
    handler((e as CustomEvent<AuditFocusTargetDetail>).detail);
  }
  window.addEventListener(FOCUS_EVENT, listener);
  return () => window.removeEventListener(FOCUS_EVENT, listener);
}

/** Pick the experiment tab a target_id lives on. Returns null for
 *  shapes the Shell doesn't know how to route — caller can fall
 *  back to "do nothing" or toast a no-route message. */
export function tabForTargetId(targetId: string): ExperimentTab | null {
  const parsed = parseTargetId(targetId);
  if (!parsed) return null;
  switch (parsed.kind) {
    case "factor":
    case "fv":
      return "design";
    case "tag":
    case "experiment":
      return "overview";
    case "assignment":
      return "samples";
    case "statement":
      // Phase 2 — opaque for now. Statements ride alongside the FV
      // they belong to, so design is the closest meaningful tab.
      return "design";
    default:
      return null;
  }
}

/** Human-readable label for the tab a target_id routes to. Used in
 *  tooltips on locate-in-tab affordances so the curator sees
 *  "show in Overview tab" for tags and "show in Design tab" for
 *  factors — not the misleading "Design" fallback that previous
 *  call sites hardcoded. Design review 2026-06-14: "it's the overview tab
 *  where tags are shown." */
export function locateTooltipFor(targetId: string): string {
  const tab = tabForTargetId(targetId);
  switch (tab) {
    case "design":
      return "show in Design tab";
    case "overview":
      return "show in Overview tab";
    case "samples":
      return "show in Samples tab";
    default:
      return "locate";
  }
}

/** Apply the scroll + ring-flash on a DOM element. Used by panels
 *  that listen to onAuditFocusTarget. Centralised so the highlight
 *  treatment stays consistent across factor cards, FV cards, tag
 *  chips, etc. */
export function flashFocus(el: HTMLElement, durationMs: number = 1800): void {
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("ring-2", "ring-blue-400", "ring-inset");
  window.setTimeout(() => {
    el.classList.remove("ring-2", "ring-blue-400", "ring-inset");
  }, durationMs);
}

/** Convenience: in a panel listener, find the matching element
 *  via `[data-audit-target="…"]` and flash-focus it. Returns true
 *  if a match was found (so the caller can fall through to other
 *  selectors when needed — e.g. samples panel uses
 *  data-bm-shortname instead). */
export function focusByAuditTarget(targetId: string): boolean {
  const safe =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(targetId)
      : targetId.replace(/"/g, '\\"');
  const el = document.querySelector<HTMLElement>(
    `[data-audit-target="${safe}"]`,
  );
  if (!el) {
    // Diagnostic signal — silent no-op was the reason the design review's
    // "magnifying glasses don't do anything" report 2026-06-14 had
    // no console trace. Common cause: the target's owning chip
    // group is collapsed (Multi-tag groups in OverviewPanel are
    // collapsed by default), so the data-audit-target element isn't
    // in the DOM yet. Surface the miss so the next time it
    // happens we have a smoking gun.
    console.warn(
      "focusByAuditTarget: no element with data-audit-target=%s — chip group may be collapsed, or the target_id slug doesn't match the stamped attribute",
      targetId,
    );
    return false;
  }
  flashFocus(el);
  return true;
}
