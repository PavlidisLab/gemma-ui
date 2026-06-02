import { createContext, useContext, type ReactNode } from "react";
import type { FlowKind } from "./sources";

/** App-level flow context — surfaces whether the ticket the
 *  curator is working under was provisioned as a curation batch
 *  (``edit``, fresh preboarded GSEs) or an audit batch (``review``,
 *  already-curated GSEs). Mounted by Shell.
 *
 *  Flow is *advisory*: it picks the default chip-strip baseline.
 *  It does NOT gate disposition / design-edit affordances —
 *  ``useIsReadOnly`` keys off the live chip-strip baseline instead.
 *  See the rule below. */
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

/** Returns ``true`` when the curator should be prevented from
 *  mutating server state.
 *
 *  Rule (Paul 2026-06-02): in our offline method-evaluation work,
 *  the point is to converge on polished gold — whatever sits on
 *  the left chip is editable. The curator can pick any baseline and
 *  refine it; the gate is implicit in what writes the chosen
 *  baseline supports server-side. We don't lock the UI in offline
 *  mode.
 *
 *  Kept as a hook for forward-compat: when this code lands behind
 *  a real Gemma session that distinguishes viewer permissions
 *  (e.g. anonymous read-only access to a public ticket), the gate
 *  can be reintroduced here without changing the call sites.
 */
export function useIsReadOnly(): boolean {
  return false;
}
