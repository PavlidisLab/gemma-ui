/**
 * Adapter helpers for the dual-state pipeline-commentary fields shipped
 * 2026-06-13 per ``handoffs/PIPELINE_COMMENTARY_SURFACING_2026_06_13.md``.
 *
 * Five fields ride two places on the wire while the agents-side
 * migration completes:
 *   - canonical:   ``audit.evidence.comparison_proposal.<field>``
 *   - back-compat: ``audit.evidence.<field>``
 *
 * UI readers should prefer the canonical (Proposal-side) location and
 * fall through to the mirror only when the canonical is empty / null.
 * The mirror will be removed in a future agents-side patch; until then
 * these helpers handle the transition transparently — no PR-
 * coordination required (per bro's note).
 *
 * Stays small + pure so any caller can drop it in without dragging
 * audit-context state.
 */
import type {
  AuditEvidence,
  AuditReport,
  EscalationRequest,
} from "./auditTypes";
import type { Proposal } from "./types";

/** Resolve a string-valued commentary field, preferring the Proposal-
 *  canonical location and falling back to the AuditEvidence mirror.
 *  Returns ``null`` when both sides are empty / missing so the caller
 *  can suppress the surface entirely (vs. rendering an empty box). */
export function readCommentaryString(
  evidence: AuditEvidence | null | undefined,
  field: "experiment_summary" | "experiment_notes" | "overall_assessment" | "agent_version",
): string | null {
  if (!evidence) return null;
  const fromProposal = evidence.comparison_proposal
    ? (evidence.comparison_proposal as Proposal)[field]
    : null;
  if (typeof fromProposal === "string" && fromProposal.trim().length > 0) {
    return fromProposal;
  }
  const fromEvidence = evidence[field];
  if (typeof fromEvidence === "string" && fromEvidence.trim().length > 0) {
    return fromEvidence;
  }
  return null;
}

/** Resolve the escalation-request list, preferring the Proposal-
 *  canonical location and falling back to the AuditEvidence mirror.
 *  Returns ``[]`` (not null) so callers can render the surface
 *  conditionally on ``.length > 0`` without an extra null check. */
export function readEscalationRequests(
  evidence: AuditEvidence | null | undefined,
): EscalationRequest[] {
  if (!evidence) return [];
  const fromProposal = evidence.comparison_proposal?.escalation_requests;
  if (Array.isArray(fromProposal) && fromProposal.length > 0) {
    return fromProposal;
  }
  const fromEvidence = evidence.escalation_requests;
  if (Array.isArray(fromEvidence) && fromEvidence.length > 0) {
    return fromEvidence;
  }
  return [];
}

/** Convenience: pull the schema discriminator (``agents@<sha>/<tag>``)
 *  from wherever it lives on the report. Preference order: top-level
 *  ``agent_version`` → ``comparison_proposal.agent_version`` →
 *  ``evidence.agent_version`` mirror. Returns ``null`` when absent on
 *  every level. */
export function readAgentVersion(
  report: AuditReport | null | undefined,
): string | null {
  if (!report) return null;
  if (
    typeof report.agent_version === "string" &&
    report.agent_version.trim().length > 0
  ) {
    return report.agent_version;
  }
  return readCommentaryString(report.evidence, "agent_version");
}
