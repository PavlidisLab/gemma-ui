import { useEffect } from "react";
import { useAudit } from "@/features/audit/AuditContext";
import type { AuditReport } from "@/api/auditTypes";
import {
  useChipDesignPair,
  useCalibrationAuditReport,
} from "./useChipDiff";
import { useChipState } from "./useChipState";
import { diffDesignsToAuditReport } from "./diffToAuditReport";
import { isPolishedSource } from "./sources";

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
  // The ``polished-vs-agent`` pair (curator auditing the agent's
  // proposal) gets first-class treatment: the calibration package's
  // own ``curation_review`` row already carries the agent's
  // findings + the curator's dispositions + defender verdicts +
  // debate badges. Re-use it directly so all provenance survives
  // (design review 2026-05-27: "we want all provenance and documentation we
  // pick up along the way"). For every other pair we still
  // synthesise from the structural diff.
  const isCuratorAuditingAgent =
    isPolishedSource(baseline) && comparator === "agent_proposal";
  const calibrationReport = useCalibrationAuditReport(
    isCuratorAuditingAgent ? experimentId : "",
  );
  const { setOverrideReport } = useAudit();

  // Override fires whenever both slots resolve to a Design — the
  // sidebar then renders the DELTA between baseline and comparator
  // as cards, not the live agent-proposal feed. Includes
  // ``cmp = agent_proposal`` when a real polished baseline is set:
  // baseline = polished:curator-b, cmp = agent original proposal ⇒ show
  // the curator's audit of the agent's proposal, with dispositions.
  //
  // Skipped when:
  //  * comparator is empty (no diff possible)
  //  * baseline=empty + comparator=agent_proposal (the "raw proposal"
  //    framing — let the live feed pass through so the legacy
  //    calibration-review UX is untouched)
  //  * baseline=preboard + comparator=agent_proposal (the default
  //    review/edit state — the live calibration-package report is
  //    the canonical "what to disposition" surface and carries full
  //    finding provenance, issue codes, severity, and dispositions
  //    that the chip-diff synthetic discards. Per 2026-06-02 review
  //    on GSE1024 / GSE161828: the synthetic was shadowing real
  //    factor findings + the calibration_match framing on tag
  //    findings, leaving curators with a structurally-thin view).
  const shouldOverride =
    comparator !== "empty"
    && !(baseline === "empty" && comparator === "agent_proposal")
    && !(baseline === "preboard" && comparator === "agent_proposal");

  useEffect(() => {
    if (!shouldOverride) {
      setOverrideReport(null);
      return;
    }
    // Polished-vs-agent: use the real calibration AuditReport with
    // full provenance baked in.
    if (isCuratorAuditingAgent) {
      if (calibrationReport.data) {
        setOverrideReport(calibrationReport.data as unknown as AuditReport);
      } else if (!calibrationReport.isLoading) {
        setOverrideReport(null);
      }
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
    isCuratorAuditingAgent,
    calibrationReport.data,
    calibrationReport.isLoading,
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
