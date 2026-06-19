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
 *  History — Paul installed a chip-strip-baseline read-only gate on
 *  2026-06-08 to prevent silent overwrites when viewing a non-
 *  editable baseline (Live Gemma / preboard / agent_proposal). On
 *  2026-06-12 Paul reversed that rule: "and make it not read only
 *  for gottsake". The gate now returns ``false`` unconditionally;
 *  the only callers that still see ``true`` are the ones that opt
 *  in via an explicit prop on a per-card basis (e.g. synthetic
 *  drift cards passing ``readOnly``).
 *
 *  If the silent-overwrite concern resurfaces, the right fix is on
 *  the WRITE path — refuse to PATCH when the visible baseline isn't
 *  the writable store — not blanket-gating the UI. */
export function useIsReadOnly(): boolean {
  return false;
}
