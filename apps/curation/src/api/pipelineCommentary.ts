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
 * coordination required (per the agents-side note).
 *
 * Stays small + pure so any caller can drop it in without dragging
 * audit-context state.
 */
import type {
  ArbiterVerdict,
  AuditEvidence,
  AuditFinding,
  AuditReport,
  BossPassVerdict,
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

// ---------------------------------------------------------------------------
// Per-finding judge-chain lookup
// ---------------------------------------------------------------------------

/** Targeting tuple the agent-side build_calibration_batch uses to key
 *  arbiter / boss rows. Mirrors agents-side; UI extracts the same
 *  tuple from a finding's ``target_id`` to drive the per-finding
 *  judge-chain render. ``target_value`` is the empty string for
 *  factor-level rows (factor verdicts target the category only). */
export interface JudgeLookupKey {
  target_kind: string;
  target_category: string;
  target_value: string;
  side: string;
}

/** Permissive alphanumeric-only key — same convention as
 *  ``applyHandlers.ts``'s remove-tag fuzzy fallback, so a finding's
 *  slug-form ("developmental-stage") matches an arbiter row's raw
 *  label ("developmental stage") and vice versa regardless of
 *  whitespace / dash / underscore drift. */
function loosey(s: string | null | undefined): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Map a finding's issue_code to the side enum the arbiter / boss rows
 *  carry. Returns ``""`` when the code doesn't fit the binary
 *  extra / missed_gold partition — the lookup falls back to matching
 *  on target_kind + category + value alone in that case. */
function sideForFinding(finding: AuditFinding): string {
  const code = finding.issue_code;
  if (
    code === "calibration_agent_extra" ||
    code === "calibration_factor_extra" ||
    code === "augmentation_factor_extra"
  ) {
    return "agent_extra";
  }
  if (
    code === "calibration_gold_only_miss" ||
    code === "calibration_factor_gold_only_miss"
  ) {
    return "agent_missed_gold";
  }
  // Match / rename / partition-mismatch findings — defender's own
  // ``side`` is the closest thing to a producer hint; pull it through
  // when present.
  return (finding.defender_verdict?.side as string | undefined) ?? "";
}

/** Parse a finding's ``target_id`` into the lookup tuple. Handles:
 *
 *   - ``calibration:<status>:<cat>/<val>``  (tag-shaped calibration)
 *   - ``calibration:<status>:<cat>``        (factor-shaped calibration)
 *   - ``tag:<cat-slug>/<val-slug>``         (entity-frame proposer)
 *   - ``factor:<cat-slug>``                 (entity-frame proposer)
 *
 *  Returns null on shapes the parser doesn't recognise — caller
 *  treats that as "no arbiter / boss row could be looked up", which
 *  preserves the existing defender-only render. */
export function parseFindingTargetForJudgeLookup(
  finding: AuditFinding,
): JudgeLookupKey | null {
  const id = finding.target_id || "";
  const side = sideForFinding(finding);
  if (id.startsWith("calibration:")) {
    const rest = id.slice("calibration:".length);
    const colon = rest.indexOf(":");
    if (colon === -1) return null;
    const tail = rest.slice(colon + 1);
    const slash = tail.indexOf("/");
    if (slash !== -1) {
      return {
        target_kind: finding.target_kind || "tag",
        target_category: tail.slice(0, slash),
        target_value: tail.slice(slash + 1),
        side,
      };
    }
    return {
      target_kind: finding.target_kind || "factor",
      target_category: tail,
      target_value: "",
      side,
    };
  }
  const tagSlug = id.match(/^tag:([^/]+)\/(.+)$/);
  if (tagSlug) {
    return {
      target_kind: "tag",
      target_category: tagSlug[1],
      target_value: tagSlug[2],
      side,
    };
  }
  const factor = id.match(/^factor:(.+)$/);
  if (factor) {
    return {
      target_kind: "factor",
      target_category: factor[1],
      target_value: "",
      side,
    };
  }
  return null;
}

interface VerdictTargetingShape {
  target_kind: string;
  target_category: string;
  target_value: string;
  side: string;
}

/** Match a verdict row against the finding's lookup tuple. Targeting
 *  fields compare via the permissive ``loosey`` key (whitespace,
 *  dash, underscore drift all collapse). ``side`` is matched when
 *  both sides supply one; an empty side from either end means
 *  "don't disambiguate on side" (so legacy packages without a
 *  populated side still match). */
function verdictMatches(
  verdict: VerdictTargetingShape,
  key: JudgeLookupKey,
): boolean {
  if (loosey(verdict.target_kind) !== loosey(key.target_kind)) return false;
  if (loosey(verdict.target_category) !== loosey(key.target_category)) {
    return false;
  }
  if (loosey(verdict.target_value) !== loosey(key.target_value)) return false;
  const vSide = (verdict.side || "").trim();
  const kSide = (key.side || "").trim();
  if (vSide && kSide && loosey(vSide) !== loosey(kSide)) return false;
  return true;
}

/** Look up the arbiter row for a finding. Returns the first matching
 *  row or null when none match (or when the report carries no
 *  arbiter_verdicts). */
export function findArbiterForFinding(
  report: AuditReport | null | undefined,
  finding: AuditFinding,
): ArbiterVerdict | null {
  const rows = report?.evidence?.arbiter_verdicts ?? [];
  if (rows.length === 0) return null;
  const key = parseFindingTargetForJudgeLookup(finding);
  if (!key) return null;
  for (const row of rows) {
    if (verdictMatches(row, key)) return row;
  }
  return null;
}

/** Look up the boss row for a finding. Returns the first matching
 *  ``BossPassVerdict`` or null. */
export function findBossForFinding(
  report: AuditReport | null | undefined,
  finding: AuditFinding,
): BossPassVerdict | null {
  const rows = report?.evidence?.boss_verdicts ?? [];
  if (rows.length === 0) return null;
  const key = parseFindingTargetForJudgeLookup(finding);
  if (!key) return null;
  for (const row of rows) {
    if (verdictMatches(row, key)) return row;
  }
  return null;
}
