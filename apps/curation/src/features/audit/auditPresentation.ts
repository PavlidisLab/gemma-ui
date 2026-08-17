/**
 * Shared presentation vocabulary for audit-side surfaces.
 *
 * Centralises the lookup tables, sort orders, and palette helpers
 * that the audit sidebar, the full audit-report view, and the audit
 * context all need. Before this module each consumer carried its
 * own copy of `TARGET_KIND_LABEL` / `SEVERITY_RANK` /
 * `severityTextCls` — three copies of the same enum-keyed table,
 * three drift opportunities. Owning them here means the chrome stays
 * coherent across surfaces and a palette tweak is a one-file change.
 *
 * No JSX in this file — pure data + functions only. The badge /
 * dot / pill *components* that consume these helpers live in
 * `findingBadges.tsx`.
 */

import type {
  AuditFinding,
  AuditTargetKind,
  Severity,
} from "@/api/auditTypes";
import type { Design } from "@/features/experiment/types";
import {
  isEvidencelessCrossCut,
  isSamePartitionTermDiff,
} from "./factorMatch";
import { slug } from "./targetIds";

// ---------------------------------------------------------------------------
// Feature gates
// ---------------------------------------------------------------------------

/** Park-affordance gate — Design review 2026-06-14: "I'm not sure we have park
 *  functionality; let's hide that, but don't remove it." The handlers,
 *  chip set, and server enum all stay wired; this just suppresses the
 *  "Park…" button on both the compact action row (findingCard) and the
 *  per-element editor (FindingDetailsEditor) until the flow that needs
 *  it (mid-curation handoffs, partial review) lands. Owned here so
 *  restoring the affordance is a single-file flip to `true` rather than
 *  two files drifting apart. */
export const SHOW_PARK_AFFORDANCE = false;

// ---------------------------------------------------------------------------
// FV-shaped tag findings — hidden, and therefore not counted
// ---------------------------------------------------------------------------

/** Target ids a tag-shaped finding would use for things that are
 *  actually FACTOR VALUES in the design.
 *
 *  Tags and factor values are separate entity types; the agent /
 *  upstream sometimes emits a tag-target finding whose (category,
 *  value) slug pair matches a real FV, which surfaces as a REMOVE TAG
 *  card for something that was never a tag. Those cards are hidden.
 *
 *  Read from the draft when available — the curator's edits are the
 *  current state — falling back to the saved design. */
export function fvShapedTagTargets(
  design: Design | null | undefined,
): Set<string> {
  const out = new Set<string>();
  if (!design) return out;
  for (const factor of design.factors ?? []) {
    const factorCatSlug = slug(factor.category?.label || "");
    if (!factorCatSlug) continue;
    for (const fv of factor.factor_values ?? []) {
      const fvLabelSlug = slug(fv.free_text_label || "");
      if (fvLabelSlug) out.add(`tag:${factorCatSlug}/${fvLabelSlug}`);
      // Sometimes the upstream "tag" is the FV's subject or object
      // term (the gene / drug behind the FV) rather than its
      // free-text label.
      for (const st of fv.statements ?? []) {
        const subjSlug = slug(st.subject?.label || "");
        if (subjSlug) out.add(`tag:${factorCatSlug}/${subjSlug}`);
        const objSlug = slug(st.object?.label || "");
        if (objSlug) out.add(`tag:${factorCatSlug}/${objSlug}`);
      }
    }
  }
  return out;
}

/** Split findings into what the panel SHOWS and what it hides.
 *
 *  Both halves matter, and they have to come from one call. The
 *  counts in the headers used to be taken off the raw list while the
 *  body rendered the filtered one, so a review with a single visible
 *  card announced "2 findings — 2 proposals" above it and the curator
 *  went looking for a card that was never going to render. The
 *  suppression caption explained the gap, but a caption arguing with a
 *  number loses. Count what you show. */
export function partitionFvShapedTagFindings(
  findings: readonly AuditFinding[],
  design: Design | null | undefined,
): { visible: AuditFinding[]; hidden: AuditFinding[] } {
  const targets = fvShapedTagTargets(design);
  if (targets.size === 0) return { visible: [...findings], hidden: [] };
  const visible: AuditFinding[] = [];
  const hidden: AuditFinding[] = [];
  for (const f of findings) {
    if (f.target_kind === "tag" && targets.has(f.target_id)) hidden.push(f);
    else visible.push(f);
  }
  return { visible, hidden };
}

// ---------------------------------------------------------------------------
// Bulk-resolution disposition notes
// ---------------------------------------------------------------------------

/** Note written on findings resolved by the close dialog's "accept
 *  remaining" pick.
 *
 *  These strings leave the UI: the agents-side gold-apply pass reads
 *  them back to judge how much weight a disposition carries. They are
 *  therefore a wire contract, not decoration — hence one exported
 *  constant per side rather than a literal at the call site.
 *
 *  Wording matters here. The earlier "Implicit accept — curator closed
 *  the review without explicitly rejecting this proposal" read as
 *  passive, so the gold pass treated it as low-confidence and re-asked
 *  a question the curator had already answered. Accept is NOT the
 *  dialog's default; picking it is an act. What's worth flagging is
 *  only that the proposal wasn't looked at one by one (handoff
 *  ``CAB_TO_UI_2026_08_10_IMPLICIT_ACCEPT_WORDING_AND_SWALLOWED_ERRORS``). */
export const BULK_ACCEPT_NOTE =
  'Bulk accept — curator chose "accept remaining" when closing the ' +
  "review; this proposal was not individually reviewed.";

/** Note written on findings resolved by the close dialog's default.
 *  "Implicit" is accurate on this side and stays: reject is what a
 *  curator who touched nothing gets. */
export const IMPLICIT_REJECT_NOTE =
  "Implicit reject — curator closed the review without acting on this " +
  "proposal.";

/** Marker appended when the reason slug was DERIVED from the issue
 *  code rather than picked by the curator — the one-click paths that
 *  skip the chip dialog (`deriveDismissReason` / `deriveAcceptReason`,
 *  and the structural-only Agree's `well_evidenced`).
 *
 *  🛑 Without this the two are indistinguishable in the store, and a
 *  reason tally reads a default as a verdict. That cost something
 *  real: `well_evidenced` is the single most common value in the store
 *  (72 rows, 23% of curator rows) and every one is a fallback; a
 *  factor-side chip prune was argued from "zero uses" on a dialog the
 *  data can't show was ever opened (cab, 2026-08-17).
 *
 *  The control that proves the shape: on `calibration_gold_only_miss`
 *  accepts — where curators DO reach the dialog — the derived default
 *  `gold_was_wrong` has zero uses and 58 rows spread across five chips
 *  with 21 notes. Reached ⇒ spread. Bypassed ⇒ 100% default, no notes.
 *
 *  Appended, never substituted: the curator may have typed their own
 *  note on the same save, and theirs comes first. */
export const DERIVED_REASON_NOTE =
  "Reason not picked by the curator — derived from the issue code on a " +
  "one-click save that skipped the reason dialog.";

/** Compose {@link DERIVED_REASON_NOTE} onto whatever the curator
 *  typed. Use at every site that sends a derived reason slug. */
export function withDerivedReasonNote(notes?: string | null): string {
  const typed = (notes ?? "").trim();
  return typed ? `${typed}\n\n${DERIVED_REASON_NOTE}` : DERIVED_REASON_NOTE;
}

// ---------------------------------------------------------------------------
// Target kinds — ordering and human-facing labels
// ---------------------------------------------------------------------------

/** Canonical target-kind sort order. Findings group by this in the
 *  audit report view and (when severity ties) in the sidebar list,
 *  so a section labelled "Factor" always sits where the curator
 *  expects relative to "FV" / "Tag" / "Assignment". */
export const TARGET_KIND_ORDER: AuditTargetKind[] = [
  "experiment",
  "factor",
  "fv",
  "tag",
  "characteristic",
  "assignment",
  "statement",
];

/** Title-cased human label for a target kind. The wire enum is
 *  lowercase + snake-y; UI surfaces want presentation form. */
export const TARGET_KIND_LABEL: Record<AuditTargetKind, string> = {
  experiment: "Experiment",
  factor: "Factor",
  fv: "FV",
  tag: "Tag",
  characteristic: "Characteristic",
  assignment: "Assignment",
  statement: "Statement",
};

// ---------------------------------------------------------------------------
// Severity — sort rank and palette helpers
// ---------------------------------------------------------------------------

/** Severity sort rank. Lower number = more urgent, so a plain
 *  ascending sort on this puts blockers at the top. */
export const SEVERITY_RANK: Record<Severity, number> = {
  blocker: 0,
  major: 1,
  minor: 2,
  ok: 3,
};

/** UI-side severity override. The agent sometimes ranks
 *  intrinsically-structural changes (removing or adding a whole
 *  factor, partition mismatch) as `minor`; the curator's mental
 *  model treats those as major. Bump them up here so the badge
 *  reads correctly even when the wire severity drifts. */
export function displaySeverity(finding: AuditFinding): Severity {
  const code = finding.issue_code;
  // Same-partition term diffs wear the partition_mismatch code but are
  // NOT structural — the sample grouping is identical and only the
  // near-synonym term differs. Don't bump them; keep the quiet minor
  // treatment so they read as a term choice, not an orange ⚠ defect.
  if (isSamePartitionTermDiff(finding)) return finding.severity;
  // A degenerate cross-cut with no per-FV overlap evidence can't
  // justify the structural bump either — there's nothing to show.
  // Keep the wire severity rather than escalating an evidence-free
  // flag to the orange ⚠.
  if (isEvidencelessCrossCut(finding)) return finding.severity;
  const structural =
    code === "calibration_factor_gold_only_miss" ||
    code === "calibration_factor_extra" ||
    code === "calibration_factor_partition_mismatch";
  if (structural && finding.severity === "minor") return "major";
  return finding.severity;
}

/** Text-colour utility class for a severity. Used by inline labels
 *  and stat readouts that don't need the full badge chrome. */
export function severityTextCls(s: Severity): string {
  switch (s) {
    case "blocker":
      return "text-rose-700";
    case "major":
      return "text-amber-700";
    case "minor":
      return "text-slate-600";
    case "ok":
      return "text-emerald-700";
  }
}

/** Border-colour utility class for a severity — used by the sidebar
 *  card frame, where the row is severity-tinted via its border (the
 *  card body keeps a kind-tint background). */
export function severityBorderCls(s: Severity): string {
  switch (s) {
    case "blocker":
      return "border-rose-200";
    case "major":
      return "border-amber-200";
    case "minor":
      return "";
    case "ok":
      return "border-emerald-200";
  }
}

/** Row-background utility class for a severity — used by the full
 *  audit-report view's per-finding table rows, where severity reads
 *  as a faint row tint instead of a border. */
export function severityRowBgCls(s: Severity): string {
  switch (s) {
    case "blocker":
      return "bg-rose-50/40";
    case "major":
      return "bg-amber-50/40";
    case "minor":
      return "";
    case "ok":
      return "bg-emerald-50/30";
  }
}

// ---------------------------------------------------------------------------
// Verdict strength — fallback when defender_verdict.strength is absent
// ---------------------------------------------------------------------------

/** Map a defender verdict string to its strength bucket. Mirrors the
 *  producer's mapping exactly; v10+ packages carry `strength` on
 *  the wire and skip this helper. `null` for unknown verdict
 *  strings — caller hides the strength label rather than guess. */
export function verdictStrength(
  v: string | undefined,
): "weak" | "moderate" | "strong" | null {
  switch (v) {
    // Tag side (original six).
    case "extra_genuine_new":
    case "agent_correct_inherited":
    case "agent_correct_overzealous_gold":
      return "strong";
    case "agent_miss_genuine":
    case "extra_inherited_redundant":
    case "extra_unsupported":
      return "weak";
    // Factor side (2026-05-14).
    // extra_genuine_new + extra_unsupported are shared with the tag
    // enum (same string, same strength) and handled above.
    case "miss_inherited_from_design":
    case "miss_overzealous_gold":
      return "strong";
    case "extra_confounded":
    case "miss_genuine":
      return "weak";
    case "extra_borderline":
    case "miss_borderline":
      return "moderate";
    default:
      return null;
  }
}
