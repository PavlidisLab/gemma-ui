import { useEffect } from "react";
import { useAudit } from "@/features/audit/AuditContext";
import { useChipDesignPair } from "./useChipDiff";
import { useChipState } from "./useChipState";
import { diffDesignsToAuditReport } from "./diffToAuditReport";

/** Bridge between the chip strip and the existing
 *  ``AuditSidebarPanel``: when the comparator chip is a polished
 *  source (or preboard), we want the sidebar to show that diff as
 *  cards instead of the agent's proposal. The seam is the
 *  AuditProvider's ``setOverrideReport`` — call it with a synthetic
 *  ``AuditReport`` produced from the chip's Design pair, and the
 *  whole panel renders against it.
 *
 *  Must be mounted *inside* an ``AuditProvider``. Renders nothing —
 *  this component exists only for its effect.
 *
 *  When the comparator chip is ``agent_proposal`` (or any state
 *  where the override doesn't apply), we clear the override so the
 *  panel falls back to the live ``/curation-proposals`` data. */
export function ChipOverrideMount({
  experimentId,
  flow,
  tab,
  groupContext,
  ticketContext,
  experimentShortName,
}: {
  experimentId: number | string;
  flow: "edit" | "review";
  tab?: string;
  groupContext?: string;
  ticketContext?: string;
  experimentShortName: string;
}) {
  const { baseline, comparator } = useChipState({
    experimentId,
    flow,
    tab,
    groupContext,
    ticketContext,
  });
  const pair = useChipDesignPair(experimentId, baseline, comparator);
  const { setOverrideReport } = useAudit();

  // Override only applies when comparator is a *polished* source
  // (or preboard) — agent_proposal keeps the live proposal cards.
  // ``empty`` is a no-op (nothing to diff against).
  const shouldOverride =
    comparator === "cy_polished"
    || comparator === "am_polished"
    || comparator === "preboard";

  useEffect(() => {
    if (!shouldOverride) {
      setOverrideReport(null);
      return;
    }
    if (!pair.baseline || !pair.comparator) {
      // Either side missing — leave any existing override in place
      // while loading; clear once we know both resolve to null.
      if (!pair.isLoading) setOverrideReport(null);
      return;
    }
    const report = diffDesignsToAuditReport({
      baseline: pair.baseline,
      comparator: pair.comparator,
      baselineSource: baseline,
      comparatorSource: comparator,
      experimentId,
      experimentShortName,
    });
    setOverrideReport(report);
  }, [
    shouldOverride,
    pair.baseline,
    pair.comparator,
    pair.isLoading,
    baseline,
    comparator,
    experimentId,
    experimentShortName,
    setOverrideReport,
  ]);

  return null;
}
