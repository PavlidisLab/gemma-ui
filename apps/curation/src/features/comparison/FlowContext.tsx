import { createContext, useContext, type ReactNode } from "react";
import type { FlowKind } from "./sources";
import { useDesignDraft } from "@/features/design/DesignDraftContext";

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
 *  Rule (Paul 2026-06-08, after the chip-baseline rewire): edits
 *  always write to ``/datasets/{id}/design`` — the local store
 *  the calibration pack POSTed its consensus design into. If the
 *  chip strip is showing a DIFFERENT curation (Live Gemma, a
 *  preboard snapshot, the agent's proposal) and we let the curator
 *  edit, they'd silently overwrite the local pack content with the
 *  baseline's content + their edits. Lock editing in that case.
 *
 *  Editable baselines: ``consensus`` (rooted in /design), the
 *  curator's own polished row (``curator_polish``, content matches
 *  what's writable), and the legacy fallback (no chip baseline
 *  resolved — page is using ``useDesign(experimentId)`` directly,
 *  i.e. the local /design store). All other source_kinds are
 *  read-only.
 *
 *  Returns ``false`` when the DesignDraftProvider isn't mounted —
 *  callers outside the experiment shell (login page, inboxes)
 *  shouldn't need the gate, and a missing provider is the legacy
 *  no-op behaviour.
 */
const _EDITABLE_BASELINE_KINDS = new Set([
  "consensus",
  "curator_polish",
]);

export function useIsReadOnly(): boolean {
  // Defensive: the hook may be called outside the experiment shell
  // where DesignDraftProvider isn't mounted (e.g. login page tests).
  // useContext on a null context returns null, so check explicitly
  // rather than throwing.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  let draft: ReturnType<typeof useDesignDraft> | null;
  try {
    draft = useDesignDraft();
  } catch {
    return false;
  }
  if (!draft.usingBaseline) return false;
  const kind = draft.baselineSourceKind;
  if (kind && _EDITABLE_BASELINE_KINDS.has(kind)) return false;
  return true;
}
