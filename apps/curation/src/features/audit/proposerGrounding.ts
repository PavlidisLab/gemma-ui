/**
 * The term the COMPARISON PROPOSER offers for a factor value, when the
 * current design has none.
 *
 * A curator looking at an `ungrounded_fv` card sees the proposer's
 * grounded term in the comparison column — `wild type genotype
 * EFO:0005168` on sandbox 9001 — and, until now, no way to take it.
 * Paul: *"there's no 'accept proposal' that applies it."*
 *
 * 🛑 This is NOT the finding's fix, and the distinction matters.
 * The finding's `applyAction` is `needs_curator_decision` with every
 * payload field null, and its `blockedReason` is the AUDITOR speaking
 * about a different value (`Utrn -/-` resolves to no term). Two agents:
 * the auditor found nothing for one value, the proposer found a term
 * for another. Both true, not in conflict — so offering the proposer's
 * term contradicts nothing the auditor said.
 *
 * The term lives at
 * `evidence.comparison_proposal.factors[].factor_values[].statements[].subject`
 * — data the agent already supplies and this app already renders in
 * the comparison column. Reading it here is not completing a payload
 * the agent failed to send.
 */
import type { AuditReport } from "@/api/auditTypes";

export interface ProposerTerm {
  label: string;
  uri: string;
}

const norm = (s: string | null | undefined): string =>
  (s ?? "").trim().toLowerCase();

/**
 * Proposer-offered subject terms for one factor, keyed by normalized
 * factor-value label.
 *
 * Only entries with a real URI are returned: a proposer row carrying a
 * label and no URI grounds nothing, and offering it would move free
 * text around while implying it had been resolved.
 */
export function proposerTermsForFactor(
  report: AuditReport | null | undefined,
  factorCategoryLabel: string | null | undefined,
): Map<string, ProposerTerm> {
  const out = new Map<string, ProposerTerm>();
  const cp = report?.evidence?.comparison_proposal;
  const want = norm(factorCategoryLabel);
  if (!cp || !want) return out;

  for (const f of cp.factors ?? []) {
    if (norm(f?.category?.label) !== want) continue;
    for (const fv of f?.factor_values ?? []) {
      const fvLabel = norm(fv?.free_text_label);
      if (!fvLabel) continue;
      for (const st of fv?.statements ?? []) {
        const uri = (st?.subject?.uri ?? "").trim();
        const label = (st?.subject?.label ?? "").trim();
        if (!uri) continue;
        // First grounded statement wins; a value carrying two is a
        // separate disagreement and not something to pick between here.
        if (!out.has(fvLabel)) out.set(fvLabel, { label: label || fvLabel, uri });
        break;
      }
    }
  }
  return out;
}

/**
 * The proposer's term for one factor value, or null when there is
 * none — or when the value is ALREADY grounded.
 *
 * `currentUris` is what the draft's value carries today. An offer to
 * adopt a term the value already has is noise at best; when the two
 * differ it is a disagreement, which is a different card and not
 * something to resolve behind a one-click adopt.
 */
export function proposerTermFor(
  report: AuditReport | null | undefined,
  factorCategoryLabel: string | null | undefined,
  fvLabel: string | null | undefined,
  currentUris: Array<string | null | undefined> = [],
): ProposerTerm | null {
  const key = norm(fvLabel);
  if (!key) return null;
  const grounded = currentUris.some((u) => (u ?? "").trim());
  if (grounded) return null;
  return proposerTermsForFactor(report, factorCategoryLabel).get(key) ?? null;
}
