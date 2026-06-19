/**
 * Translate a structured `AppliedFix` payload (per-row curator
 * verdicts + edits) into design-draft mutations.
 *
 * Called from the audit sidebar when the curator clicks `Save
 * edits` in `FindingDetailsEditor`. The audit-side `patch()` writes
 * the verdict + applied_fix to the server; this function applies
 * the same edits to the in-UI design draft so the curator's
 * corrections show up in the Design tab and ride to commit via
 * CommitBar. Same dual-write the legacy `Apply & Focus` did, just
 * driven by the per-row payload instead of a single canned
 * mutation.
 *
 * **Scope (v1):**
 * - Handles factor findings whose finding pairs to a gold factor
 *   in the current draft (the `match_*` / `rename` / partition-
 *   equal-`_extra` cases — i.e. the curator's edits land on the
 *   gold factor in place).
 * - Returns the draft unchanged for `_extra` findings without a
 *   gold counterpart (true new-factor add). Curator's verdict is
 *   still recorded on the audit; the structural add needs the
 *   legacy `Apply & Focus` path or a manual factor-add via the
 *   Design tab. Wire that case into a follow-up when curators
 *   start hitting it.
 * - Tag findings: not implemented yet — the per-element editor
 *   currently doesn't render the tag rows interactively. Add when
 *   it does.
 */
import type {
  AppliedFix,
  AuditFinding,
  AuditReport,
} from "@/api/auditTypes";
import type {
  Design,
  Factor,
  FactorValue,
  Statement,
} from "@/features/experiment/types";
import type { FactorProposal } from "@/api/types";
import {
  setFactorFields,
  setFvLabel,
  setStatement,
} from "@/features/design/mutations";
import { resolveAgentFactor, resolveGoldFactor } from "./factorMatch";
import { firstBacktick } from "./rationaleText";

interface CategoryPath {
  kind: "category";
}
interface FvLabelPath {
  kind: "fv_label";
  fvIndex: number;
}
interface FvStatementPath {
  kind: "fv_statement";
  fvIndex: number;
  statementIndex: number;
  part: "subject" | "predicate" | "object";
}
type ParsedPath = CategoryPath | FvLabelPath | FvStatementPath;

/** Parse a row path emitted by `FindingDetailsEditor.buildFactorRows`.
 *  Conventions documented in `auditTypes.ts` on `AppliedEdit.path`. */
function parsePath(path: string): ParsedPath | null {
  if (path === "factor.category") return { kind: "category" };
  const labelMatch = path.match(/^fv\[(\d+)\]\.label$/);
  if (labelMatch) {
    return { kind: "fv_label", fvIndex: parseInt(labelMatch[1], 10) };
  }
  const stmtMatch = path.match(
    /^fv\[(\d+)\]\.statements\[(\d+)\]\.(subject|predicate|object)$/,
  );
  if (stmtMatch) {
    return {
      kind: "fv_statement",
      fvIndex: parseInt(stmtMatch[1], 10),
      statementIndex: parseInt(stmtMatch[2], 10),
      part: stmtMatch[3] as "subject" | "predicate" | "object",
    };
  }
  return null;
}

/** Pair the agent's FV-by-index to its gold counterpart by biomaterial
 *  set. The path's ``fv[i]`` index is into agent.factor_values (that's
 *  what the editor's row builder iterates); we need the corresponding
 *  gold FV's `id` to feed into the mutation helpers. */
function goldFvForAgentIdx(
  agentFactor: FactorProposal | null,
  goldFactor: Factor,
  agentFvIdx: number,
): FactorValue | null {
  if (!agentFactor) return null;
  const agentFv = agentFactor.factor_values[agentFvIdx];
  if (!agentFv) return null;
  const agentBms = new Set(agentFv.biomaterial_short_names ?? []);
  const paired = goldFactor.factor_values.find((gfv) => {
    const gBms = new Set(gfv.biomaterial_short_names ?? []);
    if (gBms.size !== agentBms.size) return false;
    for (const bm of agentBms) if (!gBms.has(bm)) return false;
    return true;
  });
  return paired ?? null;
}

export function applyDetailsEditsToDesign(
  draft: Design,
  finding: AuditFinding,
  report: AuditReport | null,
  appliedFix: AppliedFix,
): Design {
  if (
    appliedFix.kind !== "details_edit" ||
    !appliedFix.edits ||
    appliedFix.edits.length === 0
  ) {
    return draft;
  }
  if (finding.target_kind !== "factor") return draft;

  // Resolve the gold factor the curator's edits apply to. Without
  // one, this is a true new-factor-add case which v1 doesn't
  // handle — see file header.
  const cp = report?.evidence?.comparison_proposal ?? null;
  const labelHint = firstBacktick(finding.rationale);
  const goldFactor = resolveGoldFactor(finding, draft.factors, labelHint);
  if (!goldFactor) return draft;

  // Agent factor used only for FV pairing (agentFv biomaterial set
  // → goldFv id).
  const agentFactor = resolveAgentFactor(finding, cp, labelHint);

  let mutated = draft;
  for (const edit of appliedFix.edits) {
    // Skip rows the curator confirmed without changing — verdict is
    // recorded on the audit, no design mutation needed.
    const hasEdit =
      (edit.to_label !== undefined && edit.to_label !== null) ||
      (edit.to_uri !== undefined && edit.to_uri !== null);
    if (!hasEdit) continue;

    const parsed = parsePath(edit.path);
    if (!parsed) continue;

    if (parsed.kind === "category") {
      // Category rename. Preserve the URI when the curator didn't
      // type one (label-only edit); same for label.
      const nextLabel = edit.to_label ?? goldFactor.category.label;
      const nextUri = edit.to_uri ?? goldFactor.category.uri ?? null;
      mutated = setFactorFields(mutated, goldFactor.id, {
        category: { label: nextLabel, uri: nextUri },
        // ``name`` mirrors category.label by convention; the
        // factorTemplate apply path does this so keep parity.
        name: nextLabel,
      });
      continue;
    }

    // Re-resolve the gold FV against ``mutated`` (not the original
    // ``goldFactor``) so prior edits in this same apply pass are
    // visible. Without this, a curator confirming both predicate and
    // object on a near-match had the second edit silently overwrite
    // the first — each iteration read the stale ``current`` from
    // ``goldFactor.statements[idx]`` and ``next = {...current,
    // <part>: nextTerm}`` clobbered the other slot back to its
    // pre-edit value. Per Paul 2026-06-12: "clicking 'agree' leads
    // to a 'modified' flag on the factor value but no change."
    const mutatedFactor = mutated.factors.find(
      (f) => f.id === goldFactor.id,
    );
    const goldFv = mutatedFactor
      ? goldFvForAgentIdx(agentFactor, mutatedFactor, parsed.fvIndex)
      : null;
    if (!goldFv) continue;

    if (parsed.kind === "fv_label") {
      if (edit.to_label !== undefined && edit.to_label !== null) {
        mutated = setFvLabel(mutated, goldFactor.id, goldFv.id, edit.to_label);
      }
      continue;
    }

    // fv_statement — update one part (subject/predicate/object) of
    // an existing statement, leaving the others intact. `setStatement`
    // takes a full Statement, so read current and patch the one
    // part.
    const idx = parsed.statementIndex;
    const current = goldFv.statements[idx];
    if (!current) continue;
    const nextTerm = {
      label: edit.to_label ?? "",
      uri: edit.to_uri ?? null,
    };
    const next: Statement = {
      ...current,
      ...(parsed.part === "subject" ? { subject: nextTerm } : null),
      ...(parsed.part === "predicate" ? { predicate: nextTerm } : null),
      ...(parsed.part === "object" ? { object: nextTerm } : null),
    };
    mutated = setStatement(mutated, goldFactor.id, goldFv.id, idx, next);
  }

  return mutated;
}
