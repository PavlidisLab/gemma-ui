/**
 * Cross-link disposition suggestion logic for findings carrying
 * `consequent_of` or `consequents`.
 *
 * When the curator commits a verdict on the upstream
 * `_partition_mismatch` finding, the absorbed downstream
 * `_gold_only_miss` is logically implied:
 *
 *   - upstream accepted (adopt agent's finer split) →
 *     downstream should accept removal
 *   - upstream dismissed (keep gold's coarser view) →
 *     downstream should be kept
 *
 * And symmetrically the other way (downstream → upstream).
 *
 * Per design review's 2026-05-20 call: this is a CUE, not an auto-bind.
 * The curator sees the suggestion + one-click action; they can
 * also disposition the linked card independently if the logical
 * consistency doesn't hold for their case. The hint surface
 * makes both the suggestion and the divergence visible.
 *
 * The matching wire shape is the agents-side bidirectional linkage on
 * `AuditFinding` — `consequent_of` (target_id of upstream) or
 * `consequents` (target_ids of downstream).
 */

import type {
  AuditFinding,
  AuditFindingDisposition,
  AuditReport,
} from "@/api/auditTypes";
import type { Verdict } from "./dispositionSave";
import { firstBacktick } from "./rationaleText";

/** Cross-link cues only fire on the two structural verdicts
 *  (`proposal` = adopt agent's call, `currently` = keep gold's).
 *  The editor's third verdict — `reference` ("match Gemma") —
 *  doesn't apply to partition-mismatch / absorbed-miss pairs, so
 *  it's excluded from this scope rather than carried as a
 *  null-handling case downstream. */
type ConsequentVerdict = Exclude<Verdict, "reference">;
/** Linked-side state: `null` means "not decided yet" (pending /
 *  no disposition / pre-2026-05-19 audit without structure_ok). */
type LinkedVerdict = ConsequentVerdict | null;

export type ConsequentHintState =
  | {
      kind: "implied";
      /** The linked finding (upstream or downstream). */
      linked: AuditFinding;
      /** The linked finding's current verdict. */
      linkedVerdict: ConsequentVerdict;
      /** The verdict this card should take to stay consistent. */
      impliedVerdict: ConsequentVerdict;
      /** Curator-facing short label for the implied action,
       *  derived from the verdict and the local finding's role
       *  in the link. */
      impliedActionLabel: string;
      /** Short readable label for the linked finding (e.g.
       *  "treatment" / "timepoint" — first backtick from the
       *  rationale, or target_id as fallback). */
      linkedLabel: string;
      /** Whether the local finding is the upstream side
       *  (partition_mismatch) or downstream (absorbed miss).
       *  Used to phrase the banner. */
      side: "upstream" | "downstream";
    }
  | {
      kind: "consistent";
      linked: AuditFinding;
      linkedLabel: string;
      side: "upstream" | "downstream";
    }
  | {
      kind: "diverges";
      linked: AuditFinding;
      linkedLabel: string;
      linkedVerdict: ConsequentVerdict;
      side: "upstream" | "downstream";
    };

/** Pull a short curator-facing label from a finding — first
 *  backticked token in the rationale, falling back to the bare
 *  target_id when the rationale doesn't carry one. */
function shortLabel(f: AuditFinding): string {
  return firstBacktick(f.rationale) ?? f.target_id;
}

/** Map a disposition's `structure_ok` / `status` to the verdict
 *  vocabulary the editor uses. Returns null when the disposition
 *  is still pending (or there's no disposition yet). */
function dispositionToVerdict(
  d: AuditFindingDisposition | undefined,
): LinkedVerdict {
  if (!d) return null;
  if (d.status === "pending") return null;
  // structure_ok=true → curator endorsed the agent's structural
  // call (accept proposal). structure_ok=false → curator rejected
  // the structural call (keep gold). Null structure_ok on
  // dispositions from pre-2026-05-19 builders that didn't carry
  // the 2-axis fields — treat needs_more_info as not-yet-decided.
  if (d.structure_ok === true) return "proposal";
  if (d.structure_ok === false) return "currently";
  // Fallback when structure_ok wasn't recorded: infer from
  // status alone. accepted ≈ proposal, dismissed ≈ currently.
  if (d.status === "accepted") return "proposal";
  if (d.status === "dismissed") return "currently";
  return null;
}

/** Find the disposition on this report for a given target_id, or
 *  undefined if the curator hasn't acted on that finding yet. */
function findDisposition(
  report: AuditReport | null,
  target_id: string,
): AuditFindingDisposition | undefined {
  return report?.dispositions?.find((d) => d.target_id === target_id);
}

/** Compute the cross-link hint state for a finding. Returns null
 *  when the finding has no linked counterpart, or the link can't
 *  be resolved against the current report. The local finding's
 *  current verdict is derived from its disposition on the
 *  report (same path the linked side uses). */
export function consequentHint(
  finding: AuditFinding,
  report: AuditReport | null,
): ConsequentHintState | null {
  const localVerdict = dispositionToVerdict(
    findDisposition(report, finding.target_id),
  );
  if (!report) return null;
  const findings = report.findings ?? [];

  // Resolve the linked finding + its verdict. Prefer the
  // upstream (consequent_of) direction when present, since the
  // partition_mismatch is the primary decision; if this card IS
  // the upstream and has consequents, take the first that's
  // been dispositioned (most common case is a single consequent
  // anyway).
  let linked: AuditFinding | undefined;
  let side: "upstream" | "downstream" = "downstream";
  if (finding.consequent_of) {
    linked = findings.find((f) => f.target_id === finding.consequent_of);
    side = "downstream";
  } else if (finding.consequents && finding.consequents.length > 0) {
    for (const id of finding.consequents) {
      const cand = findings.find((f) => f.target_id === id);
      if (!cand) continue;
      // Prefer a dispositioned consequent; if none are
      // dispositioned, take the first as the linked anchor.
      const d = findDisposition(report, id);
      if (dispositionToVerdict(d) !== null) {
        linked = cand;
        break;
      }
      if (!linked) linked = cand;
    }
    side = "upstream";
  }
  if (!linked) return null;

  const linkedVerdict = dispositionToVerdict(
    findDisposition(report, linked.target_id),
  );
  const linkedLabel = shortLabel(linked);

  // Local finding undecided yet — surface the suggestion when
  // the linked side IS decided (otherwise there's nothing to
  // suggest from).
  if (localVerdict === null) {
    if (linkedVerdict === null) return null;
    const impliedVerdict: ConsequentVerdict = linkedVerdict;
    return {
      kind: "implied",
      linked,
      linkedVerdict,
      impliedVerdict,
      impliedActionLabel: impliedActionLabelFor(impliedVerdict, side),
      linkedLabel,
      side,
    };
  }

  // Local finding decided + linked is decided — stamp consistent
  // or diverges. When linked is still pending we have nothing
  // to compare against; render nothing rather than implying.
  if (linkedVerdict === null) return null;
  if (localVerdict === linkedVerdict) {
    return { kind: "consistent", linked, linkedLabel, side };
  }
  return {
    kind: "diverges",
    linked,
    linkedLabel,
    linkedVerdict,
    side,
  };
}

/** Curator-facing label for the one-click implied-action button.
 *  The local side governs the phrasing — partition_mismatch
 *  cards use "adopt agent's split" / "keep yours"; removal cards
 *  use "accept removal" / "keep yours". */
function impliedActionLabelFor(
  verdict: ConsequentVerdict,
  side: "upstream" | "downstream",
): string {
  if (verdict === "proposal") {
    return side === "upstream" ? "adopt agent's split" : "accept removal";
  }
  return "keep yours";
}
