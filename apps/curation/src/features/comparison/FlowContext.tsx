import { createContext, useContext, type ReactNode } from "react";
import type { FlowKind } from "./sources";

/** App-level flow context — surfaces whether the curator is in
 *  ``edit`` or ``review`` mode (per the curation comparison view
 *  spec, ``docs/CURATION_COMPARISON_VIEW_2026_05_27.md``,
 *  "Edit vs review mode" section). Mounted by Shell; consumed by
 *  ``CommitBar``, ``AuditSidebarPanel``'s accept/reject buttons,
 *  and the design-tab editor.
 *
 *  Detection (today): ``edit`` when the URL carries a group or
 *  ticket context (the curator opened the experiment from a
 *  package); ``review`` otherwise (post-curation eval, audit,
 *  bare-URL navigation). Once ticket ``task_kind`` is available
 *  per spec Gotcha #5, that should override.
 *
 *  Review-mode lock: actions that would mutate state — commit,
 *  accept/reject proposals, edit factors / tags — are gated off
 *  this flow. ``Look, don't touch`` is the operative read. */
const FlowContext = createContext<FlowKind>("edit");

export function FlowProvider({
  flow,
  children,
}: {
  flow: FlowKind;
  children: ReactNode;
}) {
  return <FlowContext.Provider value={flow}>{children}</FlowContext.Provider>;
}

export function useFlow(): FlowKind {
  return useContext(FlowContext);
}

/** Convenience: returns ``true`` when the curator should be
 *  prevented from mutating server state. Callers wrap action
 *  affordances with this to short-circuit. */
export function useIsReadOnly(): boolean {
  return useFlow() === "review";
}
