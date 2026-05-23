/**
 * Per-element disposition editor — three-comparator, tired-human shape.
 *
 * One block per disagreement. Each block shows up to three
 * comparators with identity-first labels ("cyan said", "amanda
 * has", "Gemma has") + one button per available party + "edit…".
 * Matched elements collapse to a single agreement-summary line.
 * The 2-axis structure/details vocabulary stays on the wire (the
 * scorer needs it) but is hidden from the curator — the button
 * the curator clicks is the verdict.
 *
 * Identity strings come from the audit's ``report.model`` field.
 * For inter-curator-audit packages (e.g. "inter-curator audit ·
 * amanda's curation applied · cyan reviews") this parses to
 * goldCurator="amanda" / proposer="cyan" / reference="Gemma".
 * For regular agent audits the labels default to "Agent" /
 * "current curation" / "Gemma".
 *
 * Wire details:
 *   - Agreement-everywhere card → Keep/Dismiss/Park.
 *   - keep <gold>'s → status=dismissed, structure_ok=false,
 *     applied_fix.kind="structural".
 *   - adopt <proposer>'s → status=accepted, structure_ok=true,
 *     details_ok=true, no edits.
 *   - match <reference> → currently records as "accept proposal"
 *     too (since reference == upstream which is what proposal
 *     usually aims at). Stored as applied_fix entries with the
 *     reference values so the scorer can disambiguate later.
 *   - per-block edit → status=accepted, structure_ok=true,
 *     details_ok=false, applied_fix.edits carries the typed value.
 *
 * Reference data (Gemma snapshot) flows in via FvPair.gold_statement
 * + the FactorRenamePayload's gold side. When neither carries
 * reference values for a row the Reference column populates as
 * null and the "match Gemma" button is suppressed.
 */

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { shortenUri } from "@/lib/curie";
import { useToast } from "@/components/ui/Toast";
import { Term } from "@/components/ui/Term";
import type {
  AppliedEdit,
  AppliedFix,
  AuditFinding,
  AuditReport,
  DispositionStatus,
  StatementParts,
} from "@/api/auditTypes";
import type {
  Design,
  Factor,
  Statement,
} from "@/features/experiment/types";
import type { FactorValueProposal } from "@/api/types";
import {
  isCloseFactorMatch,
  isExactFactorMatch,
  isNearMatchFinding,
  resolveAgentFactor,
  resolveGoldFactor,
} from "./factorMatch";
import { pickJudgeRowText } from "./auditorDetails";
import { verdictToStructureDetails } from "./dispositionSave";
import { consequentHint, type ConsequentHintState } from "./consequentHint";
import { firstBacktick, trimRationaleBoilerplate } from "./rationaleText";
import { findingLean, type DefenderLean } from "./defenderLean";
import { actionLabels, findingActionShape } from "./actionLabels";
import { useAudit } from "./AuditContext";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { applyProposalToDesign } from "@/features/design/mutations";
import { requestAuditFocus } from "@/lib/scrollToAuditTarget";
import { OntologyTermPicker } from "@/features/design/OntologyTermPicker";
import {
  isSideEmpty,
  lc,
  rowAgreement,
  sidesAgree,
  type SideValue,
} from "./rowComparison";

// ---------------------------------------------------------------------------
// Identity strings
// ---------------------------------------------------------------------------

interface AuditIdentities {
  /** Party whose values appear in the "proposal" column. */
  proposer: string;
  /** Party whose curation is baked into design.json. */
  goldCurator: string;
  /** Label for the third comparator slot. */
  reference: string;
}

const DEFAULT_IDENTITIES: AuditIdentities = {
  proposer: "Auditor",
  // For a regular audit, the gold side IS the curator's own design
  // draft — so the label is just "Current" (no curator name). For
  // inter-curator-audit packages parsed below, the gold curator's
  // actual name overrides this default ("amanda has X" etc.).
  goldCurator: "Current",
  reference: "Gemma",
};

/** Verb for the comparator line's "currently" side. The default
 *  identity "Current" is a noun, not a person — it reads as a
 *  label, no verb. Named curators ("amanda") get "has"; the
 *  legacy "you" identity gets "have" so older audits stay
 *  readable. */
function currentlyVerb(id: string): string {
  if (id === "Current") return "";
  if (id === "you") return "have";
  return "has";
}

/** Pull party identities from the audit's ``model`` field. Matches
 *  the inter-curator-audit pattern ("inter-curator audit · X's
 *  curation applied · Y reviews") and otherwise falls back to
 *  generic role names. */
export function extractAuditIdentities(
  model: string | null | undefined,
): AuditIdentities {
  if (!model) return DEFAULT_IDENTITIES;
  const m = model.match(
    /inter-curator audit\s*·\s*(\S+?)'s curation applied\s*·\s*(\S+?)\s*reviews/i,
  );
  if (m) {
    return {
      proposer: m[2],
      goldCurator: m[1],
      reference: "Gemma",
    };
  }
  return DEFAULT_IDENTITIES;
}

// ---------------------------------------------------------------------------
// Row helpers (preserved from the previous shape)
// ---------------------------------------------------------------------------

function statementPart(
  st: Statement,
  part: "subject" | "predicate" | "object",
): SideValue {
  if (part === "subject") {
    return {
      label: st.subject?.label || "",
      uri: st.subject?.uri ?? null,
    };
  }
  if (part === "predicate") {
    return {
      label: st.predicate?.label || "",
      uri: st.predicate?.uri ?? null,
    };
  }
  return {
    label: st.object?.label || "",
    uri: st.object?.uri ?? null,
  };
}

function fvProposalStatementPart(
  fv: FactorValueProposal,
  part: "subject" | "predicate" | "object",
): SideValue {
  const st = fv.statements?.[0];
  if (st) {
    const s = st as unknown as Statement;
    const v = statementPart(s, part);
    // For subject specifically: if the statement has an empty
    // subject slot (common when the agent shaped the statement
    // as "[implicit] has role X" — the FV's identity is the
    // implicit subject), fall back to the FV's free_text_label
    // so the comparator line still renders an S in the canonical
    // S - P - O shape.
    if (part === "subject" && !v.label && !v.uri) {
      const fallback = fv.free_text_label?.trim() ?? "";
      if (fallback) return { label: fallback, uri: null };
    }
    return v;
  }
  // No statement attached — only the subject can fall back to the
  // FV identity; predicate / object stay empty.
  if (part === "subject") {
    const fallback = fv.free_text_label?.trim() ?? "";
    return { label: fallback, uri: null };
  }
  return { label: "", uri: null };
}

function pairAgentStatementToGold(
  agentFv: FactorValueProposal,
  gold: Factor | null,
  part: "subject" | "predicate" | "object",
): SideValue | null {
  if (!gold) return null;
  const agentBms = new Set(agentFv.biomaterial_short_names ?? []);
  for (const goldFv of gold.factor_values) {
    const gBms = new Set(goldFv.biomaterial_short_names ?? []);
    if (gBms.size !== agentBms.size) continue;
    let allIn = true;
    for (const bm of agentBms) {
      if (!gBms.has(bm)) {
        allIn = false;
        break;
      }
    }
    if (allIn) {
      const st = goldFv.statements?.[0];
      if (st) return statementPart(st, part);
      // Gold's matching FV has no structured statement — common
      // for free-text-only curations (e.g. timepoint FVs labeled
      // "2 h" with no role-of-baseline statement). Fall back to
      // ``free_text_label`` as the subject so the curator sees
      // gold's FV identity instead of a bare "no entry", and
      // emit explicit-empty for predicate / object so a divergent
      // agent statement (e.g. "has role · initial time point")
      // reads as a near-match — same subject, agent layered on
      // extra structure — not as gold-has-nothing.
      if (part === "subject") {
        const label = goldFv.free_text_label?.trim() ?? "";
        return { label, uri: null };
      }
      return { label: "", uri: null };
    }
  }
  return null;
}


// ---------------------------------------------------------------------------
// Row model
// ---------------------------------------------------------------------------

interface Row {
  path: string;
  rowLabel: string;
  /** Always present — the change being proposed. */
  proposal: SideValue;
  /** What's in the local draft (gold curator's design). ``null``
   *  when no counterpart exists (true new-factor adds). */
  currently: SideValue | null;
  /** Upstream (Gemma) reference. ``null`` until §1 ships a
   *  separately-stored Gemma snapshot. */
  reference: SideValue | null;
  fvIndex: number | null;
  statementIndex: number | null;
  /** True iff every present non-empty comparator agrees. Drives the
   *  agreement-summary collapse. */
  allAgree: boolean;
}

interface FvMeta {
  agentSampleCount: number;
  goldSampleCount: number | null;
}

interface BuildResult {
  rows: Row[];
  fvMeta: Map<number, FvMeta>;
}

function pairAgentGoldFv(
  agentFactor: FactorValueProposal,
  gold: Factor | null,
): { biomaterial_short_names: string[] } | null {
  if (!gold) return null;
  const agentBms = new Set(agentFactor.biomaterial_short_names ?? []);
  for (const goldFv of gold.factor_values) {
    const gBms = new Set(goldFv.biomaterial_short_names ?? []);
    if (gBms.size !== agentBms.size) continue;
    let allIn = true;
    for (const bm of agentBms) {
      if (!gBms.has(bm)) {
        allIn = false;
        break;
      }
    }
    if (allIn) {
      return { biomaterial_short_names: goldFv.biomaterial_short_names ?? [] };
    }
  }
  return null;
}


export function buildFactorRows(
  finding: AuditFinding,
  report: AuditReport | null,
  design: Design | null,
): BuildResult {
  const cp = report?.evidence?.comparison_proposal ?? null;
  const labelHint = firstBacktick(finding.rationale);
  const agent = resolveAgentFactor(finding, cp, labelHint);
  if (!agent) return { rows: [], fvMeta: new Map() };
  // ``_factor_extra`` is by definition agent-only — the builder
  // already decided there's no gold counterpart, so the UI must
  // not pair via slug or label and pretend agreement. Empty-but-
  // present gold side triggers the proper "agent proposed, gold
  // doesn't have it" disagreement render. See
  // HANDOFF_2026-05-20_DEMOTED_MATCH_SPLIT_FACTOR_UI.md §1.
  const isAgentOnly =
    finding.issue_code === "calibration_factor_extra";
  const gold = isAgentOnly
    ? null
    : resolveGoldFactor(finding, design?.factors ?? [], labelHint);
  // Reference data — the upstream (Gemma) snapshot. For
  // inter-curator-audit packages, the builder bakes this into
  // ``finding.rename`` (FactorRenamePayload): ``.gold.category``
  // carries the Gemma category, ``.fv_pairs[i].gold`` carries the
  // Gemma per-FV subject term. The local design.json is the gold
  // curator's mutated version, so it's "currently", NOT
  // "reference". Without ``finding.rename`` we have no separate
  // reference data; reference stays null per-row and the third
  // comparator suppresses.
  const rename = finding.rename ?? null;

  const rows: Row[] = [];
  const fvMeta = new Map<number, FvMeta>();

  // Category row.
  {
    const proposal: SideValue = {
      label: agent.category.label || "",
      uri: agent.category.uri ?? null,
    };
    // For agent-only findings (``_factor_extra``) the gold side is
    // explicitly empty (the builder confirmed no pair); for paired
    // findings we render gold's category, and for cases where gold
    // exists but doesn't have this specific factor we'd still want
    // empty rather than null. Use ``null`` only when we have no
    // gold lookup at all.
    const currently: SideValue | null = gold
      ? { label: gold.category.label || "", uri: gold.category.uri ?? null }
      : isAgentOnly
        ? { label: "", uri: null }
        : null;
    // ``rename.gold.category`` is the canonical Gemma-side reference;
    // ``gold`` is the resolved live design factor. Both refer to the
    // same concept on a regular agent audit (no inter-curator
    // divergence). The agent-side builder doesn't always populate
    // ``rename.gold.category.uri`` — when the label matches the
    // resolved gold factor, fall back to that factor's URI so the
    // "Gemma has" chip renders as an ontology term, not italic
    // free-text. Pure UI-side patch; bro-side fix can replace this
    // once the builder mirrors the URI consistently.
    const reference: SideValue | null = (() => {
      if (!rename?.gold?.category) return null;
      const rgc = rename.gold.category;
      const fallbackUri =
        gold && lc(rgc.label) === lc(gold.category.label)
          ? (gold.category.uri ?? null)
          : null;
      return {
        label: rgc.label || "",
        uri: rgc.uri || fallbackUri,
      };
    })();
    rows.push({
      path: "factor.category",
      rowLabel: "Category",
      proposal,
      currently,
      reference,
      fvIndex: null,
      statementIndex: null,
      allAgree: rowAgreement(proposal, currently, reference),
    });
  }

  agent.factor_values.forEach((fv, fvIdx) => {
    const pairedGoldFv = pairAgentGoldFv(fv, gold);
    fvMeta.set(fvIdx, {
      agentSampleCount: fv.biomaterial_short_names?.length ?? 0,
      goldSampleCount: pairedGoldFv
        ? pairedGoldFv.biomaterial_short_names.length
        : null,
    });

    // Reference statement parts — pair the agent FV to its
    // rename-payload partner. The builder's ``fv_pairs`` are
    // pre-paired but the key is the agent's free_text_label, not
    // the FV index. Once paired, prefer parsed
    // ``gold_statement`` (subject/predicate/object) and fall back
    // to the FV-level ``gold.label`` on the Subject row when the
    // parsed fields are absent on older rename payloads.
    const pairedGoldStatement: StatementParts | null = (() => {
      if (!rename?.fv_pairs?.length) return null;
      const myLabel = lc(fv.free_text_label);
      const byAgentLabel = rename.fv_pairs.find(
        (p) => lc(p.agent?.label) === myLabel,
      );
      const pick =
        byAgentLabel ??
        rename.fv_pairs.find(
          (p) =>
            lc(p.agent?.label) ===
            lc(fvProposalStatementPart(fv, "subject").label),
        );
      if (!pick) return null;
      // Prefer the parsed parts when present.
      if (pick.gold_statement) return pick.gold_statement;
      // Fallback: synthesise a subject-only StatementParts from the
      // pair's gold OntologyTerm. Predicate + object stay null.
      if (pick.gold) {
        return {
          subject: pick.gold,
          predicate: null,
          object: null,
        };
      }
      return null;
    })();

    const referencePart = (
      part: "subject" | "predicate" | "object",
    ): SideValue | null => {
      const term = pairedGoldStatement?.[part];
      if (!term) return null;
      return { label: term.label || "", uri: term.uri ?? null };
    };

    const partOrder: Array<"subject" | "predicate" | "object"> = [
      "subject",
      "predicate",
      "object",
    ];
    for (const part of partOrder) {
      const proposal = fvProposalStatementPart(fv, part);
      // For agent-only findings (``_factor_extra``) every part on
      // the gold side is explicit-empty (the builder confirmed no
      // pair). Otherwise pair via biomaterial-set as usual.
      const currently: SideValue | null = isAgentOnly
        ? { label: "", uri: null }
        : pairAgentStatementToGold(fv, gold, part);
      const reference: SideValue | null = referencePart(part);
      if (part !== "subject") {
        const proposalEmpty = isSideEmpty(proposal);
        const currentlyEmpty = isSideEmpty(currently);
        const referenceEmpty = isSideEmpty(reference);
        if (proposalEmpty && currentlyEmpty && referenceEmpty) continue;
      }
      rows.push({
        path: `fv[${fvIdx}].statements[0].${part}`,
        rowLabel: part[0].toUpperCase() + part.slice(1),
        proposal,
        currently,
        reference,
        fvIndex: fvIdx,
        statementIndex: 0,
        allAgree: rowAgreement(proposal, currently, reference),
      });
    }
  });

  return { rows, fvMeta };
}

function buildTagRows(finding: AuditFinding, design: Design | null): Row[] {
  if (!finding.target_id.startsWith("calibration:")) return [];
  const rest = finding.target_id.slice("calibration:".length);
  const colon = rest.indexOf(":");
  if (colon === -1) return [];
  const tail = rest.slice(colon + 1);
  const slash = tail.indexOf("/");
  if (slash === -1) return [];
  const agentCategory = tail.slice(0, slash);
  const agentValue = tail.slice(slash + 1);
  const term = finding.proposer_term ?? null;

  const categoryProposal: SideValue = { label: agentCategory, uri: null };
  const valueProposal: SideValue = {
    label: term?.label || agentValue,
    uri: term?.uri ?? null,
  };

  // Look up the gold side from the local design's tags by
  // (category, value) match — case-insensitive, plus URI match
  // when both sides carry one. For agent_extra findings the
  // expected outcome is no-match (gold doesn't have the proposed
  // tag) → explicit empty SideValue so the agreement check
  // registers the disagreement. For match findings the lookup
  // succeeds and rowAgreement collapses to true.
  // Reference (Gemma) lookup deferred — no separate Gemma
  // snapshot of tags is stored locally today (same constraint as
  // factor reference data).
  const matchedTag =
    design?.tags?.find((t) => {
      const sameCategory =
        lc(t.category?.label) === lc(agentCategory);
      if (!sameCategory) return false;
      const sameValueLabel =
        lc(t.value?.label) === lc(valueProposal.label);
      if (sameValueLabel) return true;
      if (valueProposal.uri && t.value?.uri) {
        return t.value.uri === valueProposal.uri;
      }
      return false;
    }) ?? null;

  const categoryCurrently: SideValue = matchedTag
    ? {
        label: matchedTag.category.label || "",
        uri: matchedTag.category.uri ?? null,
      }
    : { label: "", uri: null };
  const valueCurrently: SideValue = matchedTag
    ? {
        label: matchedTag.value.label || "",
        uri: matchedTag.value.uri ?? null,
      }
    : { label: "", uri: null };

  return [
    {
      path: "tag.category",
      rowLabel: "Category",
      proposal: categoryProposal,
      currently: categoryCurrently,
      reference: null,
      fvIndex: null,
      statementIndex: null,
      allAgree: rowAgreement(categoryProposal, categoryCurrently, null),
    },
    {
      path: "tag.value",
      rowLabel: "Value",
      proposal: valueProposal,
      currently: valueCurrently,
      reference: null,
      fvIndex: null,
      statementIndex: null,
      allAgree: rowAgreement(valueProposal, valueCurrently, null),
    },
  ];
}

function buildRows(
  finding: AuditFinding,
  report: AuditReport | null,
  design: Design | null,
): BuildResult {
  if (finding.target_kind === "factor") {
    return buildFactorRows(finding, report, design);
  }
  if (finding.target_kind === "tag") {
    return { rows: buildTagRows(finding, design), fvMeta: new Map() };
  }
  return { rows: [], fvMeta: new Map() };
}

// ---------------------------------------------------------------------------
// Public gating helper
// ---------------------------------------------------------------------------

export function findingHasStructuredContent(
  finding: AuditFinding,
  report: AuditReport | null,
  design: Design | null,
): boolean {
  // Partition-mismatch findings carry their own self-contained
  // payload (agent FactorRef + gold FactorRef + fv_pairs). The
  // editor renders directly from the payload without needing the
  // comparison_proposal / design lookups to succeed.
  if (finding.partition_mismatch) return true;
  if (finding.target_kind === "factor") {
    const cp = report?.evidence?.comparison_proposal ?? null;
    const labelHint = firstBacktick(finding.rationale);
    const agent = resolveAgentFactor(finding, cp, labelHint);
    if (agent) return true;
    const gold = resolveGoldFactor(finding, design?.factors ?? [], labelHint);
    return !!gold;
  }
  if (finding.target_kind === "tag") {
    // Three shapes the editor handles:
    //   - `calibration:extra:<cat>/<val>` — agent proposed adding
    //     a tag (calibration_agent_extra).
    //   - `calibration:miss:<cat>/<val>`  — agent proposed removing
    //     a gold tag (calibration_gold_only_miss, label form).
    //   - `tag:<id>`                      — same as above but in
    //     numeric-id form when the gold tag already lived in the
    //     design at audit-build time. Removal-only collapse.
    // ``proposer_term`` also signals structured content (any tag
    // proposal that's been resolved to an ontology term).
    if (finding.proposer_term) return true;
    return (
      finding.target_id.startsWith("calibration:") ||
      finding.target_id.startsWith("tag:")
    );
  }
  return false;
}

/** How many comparator rows currently disagree — used by the
 *  CompactFindingCard outer header to render the "N" yellow chip
 *  without having to wait for the editor body to mount. Returns
 *  ``null`` for finding shapes the editor doesn't decompose into
 *  rows (removals, partition_mismatch, etc.); the caller can skip
 *  the chip in that case. */
export function countFindingDisagreements(
  finding: AuditFinding,
  report: AuditReport | null,
  design: Design | null,
): number | null {
  // Removal + partition-mismatch + factor-extra findings render
  // bespoke single-decision layouts ("accept the whole thing or
  // not") — the per-row disagreement count is misleading on
  // those (it'd count every row as a disagreement since gold has
  // nothing to compare against). Skip the chip.
  if (
    finding.issue_code === "calibration_factor_gold_only_miss" ||
    finding.issue_code === "calibration_gold_only_miss" ||
    finding.issue_code === "calibration_factor_extra"
  ) {
    return null;
  }
  if (
    finding.issue_code === "calibration_factor_partition_mismatch" &&
    finding.partition_mismatch
  ) {
    return null;
  }
  // Tag findings are conceptually one decision (accept-or-dismiss
  // the tag); the old tag UI doesn't support per-statement
  // structure, so a category + value pair that's both empty on
  // one side reads as "2 disagreements" when it's really one. Skip
  // the count chip on tags until the tag UI grows statement
  // support. Factor findings still get the row-level count.
  if (finding.target_kind === "tag") return null;
  try {
    const { rows } = buildRows(finding, report, design);
    return rows.filter((r) => !r.allAgree).length;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-row state + applied_fix construction
// ---------------------------------------------------------------------------

/** Curator's verdict on one disagreeing element. ``null`` means
 *  the curator hasn't picked yet. */
type Pick = "proposal" | "currently" | "reference" | "edit" | null;

interface RowState {
  pick: Pick;
  /** Custom value when ``pick === "edit"``. */
  editLabel: string;
  editUri: string | null;
}

function freshRowState(): RowState {
  return { pick: null, editLabel: "", editUri: null };
}

/** Aggregate per-row picks into a structured ``AppliedFix``. The
 *  scorer uses the ``edits[]`` shape to disambiguate per-element
 *  verdicts after the headline status. */
function buildAppliedFix(
  rows: Row[],
  state: Map<string, RowState>,
): { fix: AppliedFix; allPicked: Pick | "mixed" | "none" } {
  const edits: AppliedEdit[] = [];
  const picksSeen = new Set<Pick>();
  for (const row of rows) {
    if (row.allAgree) continue;
    const s = state.get(row.path);
    if (!s || s.pick === null) {
      picksSeen.add(null);
      continue;
    }
    picksSeen.add(s.pick);
    const pickedSide: SideValue | null =
      s.pick === "proposal"
        ? row.proposal
        : s.pick === "currently"
          ? row.currently
          : s.pick === "reference"
            ? row.reference
            : { label: s.editLabel, uri: s.editUri };
    edits.push({
      path: row.path,
      ok: s.pick === "proposal",
      to_label: pickedSide?.label ?? null,
      to_uri: pickedSide?.uri ?? null,
      from_label: row.proposal.label,
      from_uri: row.proposal.uri,
      note: `pick=${s.pick}`,
    });
  }
  // Decide aggregate verdict shape:
  //   - ``proposal`` everywhere → accept proposal
  //   - ``currently`` everywhere → keep gold
  //   - ``reference`` everywhere → conceptually "match upstream"
  //   - any mixture (or ``edit``) → mixed
  const nonNull = Array.from(picksSeen).filter((p) => p !== null) as Pick[];
  const allPicked: Pick | "mixed" | "none" =
    nonNull.length === 0
      ? "none"
      : nonNull.length === 1
        ? nonNull[0]
        : "mixed";
  return {
    fix: {
      kind: allPicked === "currently" ? "structural" : "details_edit",
      note:
        allPicked === "currently"
          ? "Curator kept existing curation across the board."
          : null,
      edits,
    },
    allPicked,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FindingDetailsEditor({
  finding,
  report,
  design,
  currentDisposition,
  onSave,
  onDismiss,
  onPark,
  onUndo,
}: {
  finding: AuditFinding;
  report: AuditReport | null;
  design: Design | null;
  currentDisposition: DispositionStatus;
  onSave: (
    appliedFix: AppliedFix,
    structureOk: boolean | null,
    detailsOk: boolean | null,
  ) => Promise<void>;
  onDismiss: () => void;
  onPark: () => void;
  /** Revert the disposition to ``pending``. Rendered as an "undo"
   *  link in the action row when the finding is already
   *  dispositioned. The sidebar wires this to the same draft-
   *  snapshot restore + ``patch("pending")`` path the legacy
   *  action row used. */
  onUndo?: () => void;
}) {
  const toast = useToast();
  const { experimentId } = useAudit();
  const { apply: applyDraft } = useDesignDraft();
  // Click-to-locate: jump to the matching factor / FV in the Design
  // tab. Fires the same focus event the "Apply & focus" buttons use
  // — Shell switches tabs + scrolls + ring-flashes the row.
  const onLocateCurrent = (): void => {
    requestAuditFocus(experimentId, finding.target_id);
  };
  const identities = useMemo(
    () => extractAuditIdentities(report?.model),
    [report?.model],
  );
  const { rows, fvMeta } = useMemo(
    () => buildRows(finding, report, design),
    [finding, report, design],
  );
  const [rowState, setRowState] = useState<Map<string, RowState>>(new Map());
  const [saving, setSaving] = useState(false);

  const disagreementRows = rows.filter((r) => !r.allAgree);
  const agreementRows = rows.filter((r) => r.allAgree);

  // Cross-link cue for bidirectional consequent_of / consequents
  // pairs. Computed once per render; the banner below in the
  // partition-mismatch and removal branches consumes it.
  const hint: ConsequentHintState | null = useMemo(
    () => consequentHint(finding, report),
    [finding, report],
  );

  // Group disagreement rows by (fvIndex, statementIndex). Rows
  // within the same statement render together inside one decision
  // block; Category rows are their own group. Preserves the
  // builder's ordering — first occurrence of a (fv,stmt) key
  // determines block order.
  //
  // For each block we ALSO carry the agreement rows that share the
  // same (fv, statement) key — the ComparatorLine renders the full
  // S - P - O context (so a block where only Predicate + Object
  // disagree still shows the agreed-on Subject as the load-bearing
  // anchor). Pick state still applies only to the disagreement
  // rows; the context rows are render-only.
  const groupedDisagreements: {
    disagreement: Row[];
    contextAll: Row[];
    key: string;
  }[] = (() => {
    const groups = new Map<
      string,
      { disagreement: Row[]; contextAll: Row[] }
    >();
    for (const r of disagreementRows) {
      const k = `${r.fvIndex ?? "f"}.${r.statementIndex ?? "0"}`;
      const g = groups.get(k) ?? { disagreement: [], contextAll: [] };
      g.disagreement.push(r);
      g.contextAll.push(r);
      groups.set(k, g);
    }
    for (const r of agreementRows) {
      const k = `${r.fvIndex ?? "f"}.${r.statementIndex ?? "0"}`;
      const g = groups.get(k);
      if (g) g.contextAll.push(r);
    }
    return Array.from(groups.entries()).map(([key, g]) => ({ ...g, key }));
  })();

  const isRemovalFinding =
    finding.issue_code === "calibration_factor_gold_only_miss" ||
    finding.issue_code === "calibration_gold_only_miss";

  const isFactorExtraFinding =
    finding.issue_code === "calibration_factor_extra";

  const isPartitionMismatch =
    finding.issue_code === "calibration_factor_partition_mismatch" &&
    finding.partition_mismatch != null;

  // Lean direction (judge agrees with agent / curator / neither) —
  // drives which of the (keep, accept) buttons reads as the primary
  // recommended action. See ./defenderLean.ts. Computed once per
  // render and threaded into every ActionRow below.
  const lean = findingLean(finding);
  const leanKinds = leanButtonKinds(lean);
  // Action shape (add / remove / change / match) drives the TEXT on
  // the (keep, accept) buttons. The lean-aware kind decides which
  // side is the primary highlight; the action shape decides the
  // label. See ./actionLabels.ts. Paul 2026-05-21 — an "Add tag"
  // finding's keep button shouldn't read "keep current" when there
  // IS no current; it should read "don't add".
  const actionShape = findingActionShape(finding);
  const actionLbls = actionLabels(actionShape);

  function setPick(path: string, patch: Partial<RowState>): void {
    setRowState((prev) => {
      const next = new Map(prev);
      const base = next.get(path) ?? freshRowState();
      next.set(path, { ...base, ...patch });
      return next;
    });
  }

  async function dispatchSave(verdict: "proposal" | "currently" | "reference") {
    setSaving(true);
    try {
      // Default-fill any un-picked disagreement rows with the
      // header-level verdict. Curator pressed the same button at
      // the top; they implicitly mean "do this for all rows that
      // disagree".
      const filledState = new Map(rowState);
      for (const row of disagreementRows) {
        const cur = filledState.get(row.path) ?? freshRowState();
        if (cur.pick === null) {
          filledState.set(row.path, { ...cur, pick: verdict });
        }
      }
      const { fix } = buildAppliedFix(rows, filledState);
      const { structureOk, detailsOk } = verdictToStructureDetails(
        verdict,
        finding.issue_code,
      );
      // The sidebar's onSave handler derives ``status`` from
      // structure_ok / details_ok per the conventional mapping
      // (see AuditSidebarPanel.onSave); editor stays pure.
      await onSave(fix, structureOk, detailsOk);
    } catch (err) {
      toast.show(
        `Save failed: ${(err as Error).message}`,
        "danger",
        6000,
      );
    } finally {
      setSaving(false);
    }
  }

  async function dispatchPerRowSave() {
    setSaving(true);
    try {
      const { fix, allPicked } = buildAppliedFix(rows, rowState);
      if (allPicked === "none") {
        toast.show(
          "Nothing to save — pick a verdict on each disagreement first.",
          "info",
          4000,
        );
        return;
      }
      let structureOk: boolean | null = true;
      let detailsOk: boolean | null = true;
      if (allPicked === "currently") {
        structureOk = false;
        detailsOk = null;
      } else if (allPicked === "mixed" || allPicked === "edit") {
        structureOk = true;
        detailsOk = false;
      }
      await onSave(fix, structureOk, detailsOk);
    } catch (err) {
      toast.show(
        `Save failed: ${(err as Error).message}`,
        "danger",
        6000,
      );
    } finally {
      setSaving(false);
    }
  }

  // True only when the reference (Gemma) comparator carries
  // information that ISN'T already on the Current side. In a
  // regular calibration audit the agent populates ``reference``
  // with the same values as ``currently`` (Gemma == the gold
  // curator's saved state), which collapses the third comparator
  // to redundant duplication: "Current has X / Gemma has X".
  // Only in INTER-CURATOR audits does Gemma diverge from Current
  // (because Current is a second curator's overlay over Gemma's
  // baseline). Showing the reference row + "match Gemma" button
  // makes sense only in that case. Per Paul 2026-05-21.
  const hasReferenceData = rows.some(
    (r) => r.reference !== null && !sidesAgree(r.reference, r.currently),
  );

  // True when the auditor's proposal is effectively identical to
  // the current design — nothing for the curator to accept or
  // reject. Three triggers:
  //   1. ``allAgreeAtCard`` — rows exist and none disagree.
  //   2. Tag finding with the explicit ``calibration_match``
  //      issue_code — the agent's own classification asserts
  //      proposal == current, even when the local ``buildTagRows``
  //      can't resolve the row pair (target_id without the
  //      ``calibration:`` prefix). Trust the agent's classification
  //      here; otherwise the editor shows misleading keep/adopt
  //      buttons that would no-op.
  //   3. Factor finding with an exact / near match code AND no
  //      row-level disagreement — same idea, mirrored to the
  //      factor side via ``isCloseFactorMatch``.
  // Per Paul 2026-05-21: "if the proposal is exactly the same as
  // the current, there's no reason to show buttons to accept; all
  // the curator could do is delete it if it was wrong." Cuts
  // cognitive load by removing buttons that would no-op on the
  // common case.
  const noActionableDelta =
    (rows.length > 0 && disagreementRows.length === 0) ||
    (finding.target_kind === "tag" &&
      finding.issue_code === "calibration_match") ||
    (isCloseFactorMatch(finding) && disagreementRows.length === 0) ||
    (finding.issue_code === "calibration_factor_match_exact" &&
      disagreementRows.length === 0);
  const allAgreeAtCard = rows.length > 0 && disagreementRows.length === 0;

  // Partition-mismatch findings — agent and gold disagree on the
  // partition shape of a same-label factor along a clean
  // finer/coarser axis. One card, two primary buttons (adopt
  // agent's view / keep gold's view). No per-row disagreement
  // model — the payload carries an FV-level nesting map that
  // renders as a parent→children table.
  if (isPartitionMismatch) {
    const pm = finding.partition_mismatch!;
    const isAgentFiner = pm.direction === "agent_finer";
    // Direction-aware label fragment for the title + button.
    // Avoids the older "split / combine" verbs that read as
    // "split/merge two factors" — partition_mismatch is a
    // within-factor FV reorg. Per Paul 2026-05-21.
    const directionPhrase = isAgentFiner ? "finer levels" : "fewer levels";
    const agentVerb = "says";
    const goldVerb = currentlyVerb(identities.goldCurator);
    // partition_mismatch is a `change` shape (FV reorg within an
    // existing factor). The "keep" reads "don't change"; the
    // "accept" reads "adopt <proposer>'s <directionPhrase>" so the
    // curator still sees WHICH direction they're adopting.
    const keepLabel = actionLbls.keep;
    const acceptLabel = `${actionLbls.adopt} ${identities.proposer}'s ${directionPhrase}`;
    const acceptTitle = isAgentFiner
      ? `Use the finer factor-value partition ${identities.proposer} proposed.`
      : `Use the simpler factor-value partition ${identities.proposer} proposed.`;
    // Group fv_pairs by the PARENT side. For agent_finer the
    // parent is gold; for agent_coarser the parent is agent.
    // Repeated entries with the same parent collapse into a
    // single row with multiple children.
    const groups = (() => {
      const map = new Map<
        string,
        { parent: { label: string; uri: string | null }; children: Array<{ label: string; uri: string | null }> }
      >();
      for (const pair of pm.fv_pairs) {
        const parent = isAgentFiner ? pair.gold : pair.agent;
        const child = isAgentFiner ? pair.agent : pair.gold;
        const key = `${parent.label}|${parent.uri ?? ""}`;
        const entry = map.get(key) ?? { parent, children: [] };
        entry.children.push(child);
        map.set(key, entry);
      }
      return Array.from(map.values());
    })();
    return (
      <div className="space-y-3 rounded border border-slate-300 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800">
        {/* Title row — matches the factor-card title shape. */}
        <div className="flex items-baseline flex-wrap gap-2 text-[12px]">
          <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
            Factor
          </span>
          <span className="font-mono text-slate-800 dark:text-slate-100">
            {pm.gold.category.label || pm.agent.category.label || finding.target_id}
          </span>
          <span className="text-slate-400 dark:text-slate-500">·</span>
          <span className="text-amber-700 dark:text-amber-300">
            <strong>partition mismatch — {identities.proposer} proposes {directionPhrase}</strong>
          </span>
        </div>

        {/* FV-count comparison — the headline numbers a curator
            needs to grok the partition mismatch at a glance. Big
            digit + "levels" with each comparator's identity on
            the left. Both sides' levels live in ONE factor (the
            partition_mismatch is a within-factor FV reorg, not a
            cross-factor split/merge), so we just say "levels"
            without an "across N factors" suffix. Per Paul
            2026-05-21: the older "(combined into 1)" /
            "across N factors" copy was misleading — the current
            disease factor in the GSE28300 example has 3 levels in
            one factor, not "across 2 factors". */}
        <div className="space-y-1">
          <div className="grid grid-cols-[8rem_1fr] gap-x-2 items-baseline text-[12px]">
            <span className="text-slate-600 dark:text-slate-300">
              <strong>{identities.proposer}</strong> {agentVerb}
            </span>
            <span className="flex items-baseline gap-x-1.5">
              <span className="text-xl font-bold text-amber-700 dark:text-amber-300 leading-none">
                {isAgentFiner ? pm.fv_pairs.length : groups.length}
              </span>
              <span className="text-slate-600 dark:text-slate-300">
                levels
              </span>
            </span>
          </div>
          <div className="grid grid-cols-[8rem_1fr] gap-x-2 items-baseline text-[12px]">
            <span className="text-slate-600 dark:text-slate-300">
              <strong>{identities.goldCurator}</strong>
              {goldVerb ? ` ${goldVerb}` : null}
              <button
                type="button"
                onClick={onLocateCurrent}
                title="show in Design tab"
                aria-label="locate in design"
                className="ml-1 align-baseline text-[11px] text-slate-400 hover:text-sky-700 dark:text-slate-500 dark:hover:text-sky-300"
              >
                🔍
              </button>
            </span>
            <span className="flex items-baseline gap-x-1.5">
              <span className="text-xl font-bold text-slate-700 dark:text-slate-200 leading-none">
                {isAgentFiner ? groups.length : pm.fv_pairs.length}
              </span>
              <span className="text-slate-600 dark:text-slate-300">
                levels
              </span>
            </span>
          </div>
        </div>

        {/* Mapping — grouped by parent (umbrella) so when multiple
            child levels collapse onto a single parent the parent
            is shown ONCE on the right with a merged arrow. Avoids
            visual duplication (the curator was reading "ICU-
            acquired weakness MONDO:0001957" twice in a row and
            having to compare the URIs to confirm they were the
            same target — Paul 2026-05-21). For 1→1 groups this
            renders identical to the old row-per-pair shape. */}
        {groups.length > 0 ? (
          <div className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-900/40">
            <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
              {isAgentFiner
                ? `Mapping (${identities.proposer}'s level → ${identities.goldCurator}'s umbrella)`
                : `Mapping (${identities.goldCurator}'s level → ${identities.proposer}'s umbrella)`}
            </div>
            <div className="space-y-1.5 text-[11px]">
              {groups.map((g, gi) => (
                <div
                  key={gi}
                  className="grid grid-cols-[1fr_auto_1fr] gap-x-2 items-center"
                >
                  <div className="flex flex-col gap-1 min-w-0">
                    {g.children.map((c, ci) => (
                      <MappingChip key={ci} term={c} />
                    ))}
                  </div>
                  <span
                    className="text-slate-400 dark:text-slate-500"
                    aria-hidden
                    title={
                      g.children.length > 1
                        ? `${g.children.length} levels collapse to one`
                        : undefined
                    }
                  >
                    {g.children.length > 1 ? "⇒" : "→"}
                  </span>
                  <div className="min-w-0">
                    <MappingChip term={g.parent} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {hint ? (
          <ConsequentHintBanner
            state={hint}
            onApply={dispatchSave}
            saving={saving}
          />
        ) : null}

        <ActionRow
          saving={saving}
          disabled={currentDisposition !== "pending"}
          buttons={[
            {
              key: "keep",
              kind: leanKinds.keep,
              label: keepLabel,
              onClick: () => dispatchSave("currently"),
              title: isAgentFiner
                ? `Keep the existing single factor; reject ${identities.proposer}'s proposal to split.`
                : `Keep the existing separate factors; reject ${identities.proposer}'s proposal to combine.`,
            },
            {
              key: "accept",
              kind: leanKinds.accept,
              label: acceptLabel,
              onClick: () => dispatchSave("proposal"),
              title: acceptTitle,
            },
          ]}
          onDismiss={onDismiss}
          onPark={onPark}
          onUndo={
            currentDisposition !== "pending" ? onUndo : undefined
          }
        />
      </div>
    );
  }

  // Factor-extra findings — agent proposes a NEW factor that
  // gold doesn't have. The whole card is one decision (accept
  // the proposed factor or not), so the per-row "Current: no
  // entry / keep / adopt / edit" repetition is just noise. Show
  // the proposed factor's FVs as a structured read-only list,
  // then one set of accept / keep / dismiss / park buttons at
  // the bottom. Per Paul 2026-05-21.
  if (isFactorExtraFinding) {
    const cp = report?.evidence?.comparison_proposal ?? null;
    const labelHint = firstBacktick(finding.rationale);
    const agentFactor = resolveAgentFactor(finding, cp, labelHint);
    const categoryLabel =
      agentFactor?.category?.label || labelHint || "";
    const categoryUri = agentFactor?.category?.uri ?? null;
    const fvs = agentFactor?.factor_values ?? [];
    return (
      <div className="space-y-3 rounded border border-slate-300 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800">
        {/* FACTOR <category> · proposed */}
        <div className="flex items-baseline flex-wrap gap-2 text-[12px]">
          <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
            Factor
          </span>
          {categoryLabel ? (
            <Term
              uri={categoryUri}
              asLink={false}
              className="!whitespace-normal break-words"
            >
              {categoryLabel}
            </Term>
          ) : (
            <span className="font-mono text-slate-800 dark:text-slate-100">
              {finding.target_id}
            </span>
          )}
          <span className="text-slate-400 dark:text-slate-500">·</span>
          <span className="text-amber-700 dark:text-amber-300">
            <strong>proposed (not in current design)</strong>
          </span>
        </div>

        {fvs.length > 0 ? (
          <div className="space-y-1">
            {fvs.map((fv, i) => {
              const st = fv.statements?.[0];
              const subj = st?.subject;
              const pred = st?.predicate;
              const obj = st?.object;
              const subjLabel = subj?.label?.trim() || fv.free_text_label?.trim() || "";
              const subjUri = subj?.uri ?? null;
              const predLabel = pred?.label?.trim() ?? "";
              const objLabel = obj?.label?.trim() ?? "";
              const objUri = obj?.uri ?? null;
              return (
                <div
                  key={i}
                  className="flex flex-wrap items-baseline gap-x-1.5 text-[12px]"
                >
                  <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400 w-20 shrink-0">
                    FV {i + 1}
                  </span>
                  {subjLabel ? (
                    <Term
                      uri={subjUri}
                      asLink={false}
                      className="!whitespace-normal break-words"
                    >
                      {subjLabel}
                    </Term>
                  ) : (
                    <span className="italic text-slate-400">(blank)</span>
                  )}
                  {predLabel ? (
                    <>
                      <span className="text-slate-400 dark:text-slate-500">{" - "}</span>
                      <span
                        className="text-[10px] text-slate-500 dark:text-slate-200 font-mono"
                        title={pred?.uri || undefined}
                      >
                        {predLabel}
                      </span>
                    </>
                  ) : null}
                  {objLabel ? (
                    <>
                      <span className="text-slate-400 dark:text-slate-500">{" - "}</span>
                      <Term
                        uri={objUri}
                        asLink={false}
                        className="!whitespace-normal break-words"
                      >
                        {objLabel}
                      </Term>
                    </>
                  ) : null}
                  {fv.is_baseline ? (
                    <span className="text-[9px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400 ml-0.5">
                      ★ baseline
                    </span>
                  ) : null}
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 ml-0.5">
                    ({fv.biomaterial_short_names?.length ?? 0})
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}

        <ActionRow
          saving={saving}
          disabled={currentDisposition !== "pending"}
          buttons={[
            {
              key: "keep",
              kind: leanKinds.keep,
              label: actionLbls.keep,
              onClick: () => dispatchSave("currently"),
              title: `Don't add this factor — keep the design as-is.`,
            },
            {
              key: "accept",
              kind: leanKinds.accept,
              label: `${actionLbls.adopt} ${identities.proposer}'s factor`,
              onClick: () => {
                // Dual-write: mutate the design draft to ADD the
                // agent's proposed factor (so it shows up in the
                // Design tab + rides commit), then PATCH the
                // disposition. Uses applyProposalToDesign — the
                // same path the proposal-accept flow uses, called
                // with a single-factor proposal here.
                if (agentFactor) {
                  applyDraft((current) =>
                    applyProposalToDesign(current, [], [
                      {
                        category: agentFactor.category,
                        name_in_design:
                          agentFactor.name_in_design ||
                          agentFactor.category?.label ||
                          "new factor",
                        factor_type:
                          (agentFactor.factor_type as
                            | "categorical"
                            | "continuous"
                            | undefined) ?? "categorical",
                        baseline_relevance:
                          agentFactor.baseline_relevance ?? undefined,
                        baseline_relevance_reason:
                          agentFactor.baseline_relevance_reason ?? undefined,
                        factor_values: (agentFactor.factor_values ?? []).map(
                          (fv) => ({
                            free_text_label: fv.free_text_label ?? "",
                            is_baseline: !!fv.is_baseline,
                            numeric_value: fv.numeric_value ?? null,
                            statements: (fv.statements ?? []).map((s) => ({
                              category: s.category ?? null,
                              subject: s.subject ?? { label: "" },
                              predicate: s.predicate ?? null,
                              object: s.object ?? null,
                            })),
                            biomaterial_short_names: [
                              ...(fv.biomaterial_short_names ?? []),
                            ],
                          }),
                        ),
                      },
                    ]),
                  );
                }
                dispatchSave("proposal");
              },
              title: `Accept ${identities.proposer}'s proposed factor and add it to the design.`,
            },
          ]}
          onDismiss={onDismiss}
          onPark={onPark}
          onUndo={
            currentDisposition !== "pending" ? onUndo : undefined
          }
        />
      </div>
    );
  }

  // Removal-only findings collapse to keep-vs-remove. No row
  // disagreement model applies.
  if (isRemovalFinding) {
    // `remove` action shape — keep reads "don't remove", accept
    // reads "remove" (or "remove <proposer>'s"). See ./actionLabels.ts.
    const keepLabel = actionLbls.keep;
    // What is being removed — extract from the target_id when
    // structured ("calibration:miss:<cat>/<val>"), or fall back to
    // the rationale's first backticked token.
    const removeTargetLabel = (() => {
      if (finding.target_id.startsWith("calibration:")) {
        const tail = finding.target_id.split(":").slice(2).join(":");
        const slash = tail.indexOf("/");
        if (slash !== -1) {
          return `${tail.slice(0, slash)}: ${tail.slice(slash + 1)}`;
        }
      }
      return firstBacktick(finding.rationale);
    })();
    const kindWord = finding.target_kind === "tag" ? "Tag" : "Factor";
    // For factor removals, pull the gold factor + its FV labels +
    // their URIs so the "you have" line renders the category and
    // FV subjects as proper ontology chips (green) when they
    // resolve, and the curator can tell WHICH treatment factor is
    // being removed when the design has more than one. Without
    // the URIs the chips fell through to free-text styling
    // (italic grey) even for terms like ``biological sex``
    // (EFO:0000695).
    const goldFactor = (() => {
      if (finding.target_kind !== "factor") return null;
      const labelHint = firstBacktick(finding.rationale);
      return resolveGoldFactor(
        finding,
        design?.factors ?? [],
        labelHint,
      );
    })();
    // For tag removals, decompose the "category: value" label and
    // look up the gold tag in design.tags so we can resolve URIs
    // for each side. Without this, both halves render as italic
    // free-text (the same problem we fix for factor removals
    // above). In inter-curator audits the gold side is the other
    // curator's design draft, which still carries URIs on resolved
    // tags — the lookup works the same way.
    const goldTagParts = (() => {
      if (finding.target_kind !== "tag") return null;
      if (!removeTargetLabel) return null;
      const colon = removeTargetLabel.indexOf(":");
      if (colon === -1) return null;
      const cat = removeTargetLabel.slice(0, colon).trim();
      const val = removeTargetLabel.slice(colon + 1).trim();
      const tag = design?.tags?.find(
        (t) =>
          lc(t.category?.label) === lc(cat) &&
          lc(t.value?.label) === lc(val),
      );
      return {
        category: {
          label: tag?.category?.label || cat,
          uri: tag?.category?.uri ?? null,
        },
        value: {
          label: tag?.value?.label || val,
          uri: tag?.value?.uri ?? null,
        },
      };
    })();
    const categoryUri = goldFactor?.category?.uri ?? null;
    // Per-FV row data for the removal card's gold side. Each FV
    // gets its own row (S - P - O shape, predicate + object
    // omitted when empty) below the "you have" line so multi-FV
    // factors like cell-line don't crush into an unreadable
    // wrap of long labels. The subject falls back to the FV's
    // free_text_label when there's no structured statement
    // attached (the curation-style "label-only" FV shape).
    const removalFvRows =
      goldFactor && goldFactor.factor_values.length > 0
        ? goldFactor.factor_values.map((fv) => {
            const st = fv.statements?.[0] as unknown as Statement | undefined;
            const subjLabel =
              st?.subject?.label?.trim() ||
              fv.free_text_label?.trim() ||
              `FV ${fv.id}`;
            const subjUri = st?.subject?.uri ?? null;
            const predLabel = st?.predicate?.label?.trim() ?? "";
            const predUri = st?.predicate?.uri ?? null;
            const objLabel = st?.object?.label?.trim() ?? "";
            const objUri = st?.object?.uri ?? null;
            return {
              key: fv.id,
              subject: { label: subjLabel, uri: subjUri },
              predicate: predLabel ? { label: predLabel, uri: predUri } : null,
              object: objLabel ? { label: objLabel, uri: objUri } : null,
              count: fv.biomaterial_short_names?.length ?? 0,
              isBaseline: !!fv.is_baseline,
            };
          })
        : null;
    // The tag/factor being voted on. For tags it's a single
    // category:value chip; for factor removals it's the category
    // name (the per-FV detail isn't surfaced — the decision is
    // binary). The proposer's row shows nothing (their proposal
    // IS removal); the gold curator's row shows what's there.
    const currentTermLabel = removeTargetLabel ?? "";
    const proposerVerb = "says";
    const goldVerb = currentlyVerb(identities.goldCurator);
    return (
      <div className="space-y-3 rounded border border-slate-300 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800">
        {/* Title row — matches the factor-card title shape so the
            two surfaces read consistently. */}
        <div className="flex items-baseline flex-wrap gap-2 text-[12px]">
          <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
            {kindWord}
          </span>
          <span className="font-mono text-slate-800 dark:text-slate-100">
            {currentTermLabel || finding.target_id}
          </span>
          <span className="text-slate-400 dark:text-slate-500">·</span>
          <span className="text-amber-700 dark:text-amber-300">
            <strong>removal proposed</strong>
          </span>
        </div>

        {/* Comparator-row lines — same labeled-identity shape the
            disagreement blocks use, so curators read both surfaces
            with the same convention. */}
        <div className="space-y-1.5">
          <div className="grid grid-cols-[8rem_1fr] gap-x-2 items-baseline text-[12px]">
            <span className="text-slate-600 dark:text-slate-300">
              <strong>{identities.proposer}</strong> {proposerVerb}
            </span>
            <span className="italic text-slate-400">
              (proposes removing — no entry)
            </span>
          </div>
          <div className="grid grid-cols-[8rem_1fr] gap-x-2 items-baseline text-[12px]">
            <span className="text-slate-600 dark:text-slate-300">
              <strong>{identities.goldCurator}</strong>
              {goldVerb ? ` ${goldVerb}` : null}
              <button
                type="button"
                onClick={onLocateCurrent}
                title="show in Design tab"
                aria-label="locate in design"
                className="ml-1 align-baseline text-[11px] text-slate-400 hover:text-sky-700 dark:text-slate-500 dark:hover:text-sky-300"
              >
                🔍
              </button>
            </span>
            <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
              {goldTagParts ? (
                // Tag removal — render category + value as two
                // separate ontology chips so each can resolve to
                // its own term.
                <>
                  <Term
                    uri={goldTagParts.category.uri}
                    asLink={false}
                    className="!whitespace-normal break-words"
                  >
                    {goldTagParts.category.label}
                  </Term>
                  <span className="text-slate-400 dark:text-slate-500">
                    :
                  </span>
                  <Term
                    uri={goldTagParts.value.uri}
                    asLink={false}
                    className="!whitespace-normal break-words"
                  >
                    {goldTagParts.value.label}
                  </Term>
                </>
              ) : currentTermLabel ? (
                <Term
                  uri={categoryUri}
                  asLink={false}
                  className="!whitespace-normal break-words"
                >
                  {currentTermLabel}
                </Term>
              ) : (
                <span className="italic text-slate-400">
                  (in the design)
                </span>
              )}
            </span>
          </div>

          {/* Per-FV rows for the gold side — each FV on its own line
              in S - P - O shape so the curator can read a multi-FV
              factor (e.g. cell line with 4 cell-line subtypes)
              without the labels colliding into an inline wrap. */}
          {removalFvRows && removalFvRows.length > 0 ? (
            <div className="grid grid-cols-[8rem_1fr] gap-x-2 gap-y-1 items-baseline text-[12px]">
              <span aria-hidden />
              <div className="space-y-1">
                {removalFvRows.map((fv) => (
                  <div
                    key={fv.key}
                    className="flex flex-wrap items-baseline gap-x-1.5"
                  >
                    <Term
                      uri={fv.subject.uri}
                      asLink={false}
                      className="!whitespace-normal break-words"
                    >
                      {fv.subject.label}
                    </Term>
                    {fv.predicate ? (
                      <>
                        <span className="text-slate-400 dark:text-slate-500">
                          {" - "}
                        </span>
                        <span
                          className="text-[10px] text-slate-500 dark:text-slate-200 font-mono"
                          title={fv.predicate.uri || undefined}
                        >
                          {fv.predicate.label}
                        </span>
                      </>
                    ) : null}
                    {fv.object ? (
                      <>
                        <span className="text-slate-400 dark:text-slate-500">
                          {" - "}
                        </span>
                        <Term
                          uri={fv.object.uri}
                          asLink={false}
                          className="!whitespace-normal break-words"
                        >
                          {fv.object.label}
                        </Term>
                      </>
                    ) : null}
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">
                      ({fv.count})
                    </span>
                    {fv.isBaseline ? (
                      <span className="text-[9px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400 ml-0.5">
                        ★ baseline
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {hint ? (
          <ConsequentHintBanner
            state={hint}
            onApply={dispatchSave}
            saving={saving}
          />
        ) : null}

        <ActionRow
          saving={saving}
          disabled={currentDisposition !== "pending"}
          buttons={[
            {
              key: "keep",
              kind: leanKinds.keep,
              label: keepLabel,
              onClick: () => dispatchSave("currently"),
            },
            {
              key: "remove",
              kind: leanKinds.accept,
              label: `${actionLbls.adopt} ${identities.proposer}'s`,
              onClick: () => dispatchSave("proposal"),
            },
          ]}
          onDismiss={onDismiss}
          onPark={onPark}
          onUndo={
            currentDisposition !== "pending" ? onUndo : undefined
          }
        />
      </div>
    );
  }

  // Pull the factor category out of the rows (the Category row's
  // proposal label) — used by the small "FACTOR <category>" title
  // chip below. The category was previously rendered alongside
  // subject/predicate/object in every comparator line, which gave
  // it equal prominence with the actual statement subject and
  // confused the eye. Moving it to a card-level label (per Paul
  // 2026-05-21) frees the comparator rows to focus on S - P - O.
  const factorCategoryRow =
    finding.target_kind === "factor"
      ? rows.find((r) => r.rowLabel === "Category")
      : undefined;
  const factorCategoryLabel = factorCategoryRow?.proposal.label;
  return (
    <div className="space-y-3 rounded border border-slate-300 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800">
      {/* Card-level FACTOR <category> label — replaces the dropped
          inner title row for factor findings. Shows the load-
          bearing category name without competing with the
          statement-level subject chip in the comparator rows. */}
      {factorCategoryLabel ? (
        <div className="flex items-baseline gap-2 text-[12px]">
          <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
            Factor
          </span>
          <span className="font-mono text-slate-800 dark:text-slate-100">
            {factorCategoryLabel}
          </span>
        </div>
      ) : null}

      {/* Tag-detail block — for tag findings, render the
          category + value chips for both Auditor and Current so
          the curator sees the full tag identity (including URIs)
          on OK matches and near-matches.
          Skipped for ``calibration_agent_extra`` (Add tag): the
          outer collapsed header already shows the same chips for
          the Auditor side, and the Current side would just read
          "no entry". Rendering both was pure duplication per
          Paul 2026-05-21. Removal-tag findings already take a
          dedicated branch above (``isRemovalFinding``), so this
          single-line gate covers the add-tag case. */}
      {finding.target_kind === "tag" &&
      finding.issue_code !== "calibration_agent_extra" ? (
        <TagDetailBlock
          rows={rows}
          identities={identities}
          onLocateCurrent={onLocateCurrent}
        />
      ) : null}

      {/* Agreement summary + disagreement blocks render only for
          factor findings — tag findings show their full chip
          detail in TagDetailBlock above and don't need the
          row-level breakdown (one decision, not multiple). */}
      {finding.target_kind !== "tag" && agreementRows.length > 0 ? (
        <AgreementSummary
          rows={agreementRows}
          // Pass the set of FVs that have ANY disagreement so the
          // summary can suppress those FVs' "everyone agrees"
          // chips — otherwise an FV whose category-row agrees but
          // whose subject-row disagrees ends up listed BOTH in
          // "Everyone agrees: … FV 1" AND as a disagreement block
          // below, which reads as self-contradicting.
          fvIndicesWithDisagreement={
            new Set(
              disagreementRows
                .map((r) => r.fvIndex)
                .filter((i): i is number => i !== null),
            )
          }
          fvMeta={fvMeta}
        />
      ) : null}

      {/* Near-match explainer — the agent flagged this as
          ``_match_near`` but the client's per-row diff finds
          nothing to disagree on. That means the near signal
          lives in something rows don't compare (FV count,
          gene-symbol vs common-name on URIs we don't surface,
          one-of-N gold instances, baseline picks, sample-count
          mismatch, etc.). Without this block the curator sees
          a contradiction: the header says "≈ near" but the body
          says "✓ Everyone agrees". Surface the agent's
          rationale inline so the curator can decide whether the
          delta matters. Per Paul 2026-05-21 (GSE93824 genotype
          case). */}
      {isCloseFactorMatch(finding) && allAgreeAtCard ? (
        <NearMatchExplainer finding={finding} />
      ) : null}

      {/* One block per *statement* — Subject/Predicate/Object rows
          that share an FV+statement collapse into a single decision
          block with shared buttons. Skipped for tag findings (one
          decision, handled by TagDetailBlock above).

          On near-match findings (calibration_factor_match_near OR
          rename payloads — the GSE93824 genotype gene-URI case) the
          Judge rationale text from ``defender_verdict.rationale`` /
          ``proposer_defense`` is threaded into the FIRST
          DisagreementBlock — the WHY binds to the exact FV being
          corrected, not to the entire card. The factor-card-level
          AgentSuggestionPanel suppresses its own Judge row in this
          case (see AuditSidebarPanel.tsx). Sentinel
          ``[agent emitted no details]`` preserved end-to-end so a
          missing rationale still reads as "no details", not
          "missing UI". Per Paul 2026-05-21. */}
      {finding.target_kind !== "tag" && groupedDisagreements.map((g, idx) => {
        // Only the FIRST disagreement block carries the rationale —
        // ``concept_diff_kind`` lives at the rename-payload level
        // (one diff kind per finding, not per FV-pair), so binding
        // it to the first non-trivial block matches the data shape.
        // Suppress entirely on findings where the strength label
        // and Judge row still live at the factor-card level
        // (whole-factor extras / misses / partition_mismatch).
        const judgeForBlock =
          idx === 0 && isNearMatchFinding(finding)
            ? pickJudgeRowText(
                finding.defender_verdict?.rationale,
                finding.proposer_defense,
              )
            : null;
        const judgeCitationForBlock =
          idx === 0 && isNearMatchFinding(finding)
            ? finding.defender_verdict?.citation ?? null
            : null;
        return (
          <DisagreementBlock
            key={`${g.key}.${g.disagreement[0].path}`}
            rows={g.disagreement}
            contextRows={g.contextAll}
            fvMeta={fvMeta}
            identities={identities}
            rowState={rowState}
            onLocateCurrent={onLocateCurrent}
            editCategory={firstBacktick(finding.rationale) ?? null}
            leanKinds={leanKinds}
            actionLbls={actionLbls}
            judgeText={judgeForBlock}
            judgeCitation={judgeCitationForBlock}
            onPick={(pick) => {
              for (const row of g.disagreement) setPick(row.path, { pick });
            }}
            onEditCommit={(label, uri) => {
              // For statement-level edits, the curator's typed value
              // lands on the SUBJECT row when there's a disagreement
              // on subject, otherwise on the first disagreeing row.
              // Predicate / object stay at their current values.
              const target =
                g.disagreement.find((r) => r.rowLabel === "Subject") ??
                g.disagreement[0];
              setPick(target.path, {
                pick: "edit",
                editLabel: label,
                editUri: uri,
              });
            }}
          />
        );
      })}

      {/* Action row — when proposal == current there's nothing to
          accept or reject, so the only available actions are
          Dismiss (delete if wrong) and Park (defer). Otherwise
          the three header-level verdict buttons + per-row-save +
          Dismiss/Park. Per Paul 2026-05-21. */}
      <ActionRow
        saving={saving}
        disabled={currentDisposition !== "pending"}
        buttons={
          noActionableDelta
            ? []
            : [
                {
                  key: "keep",
                  kind: leanKinds.keep,
                  label: actionLbls.keep,
                  onClick: () => dispatchSave("currently"),
                  title: `Take ${
                    identities.goldCurator === "Current"
                      ? "the current"
                      : identities.goldCurator === "you"
                        ? "your"
                        : `${identities.goldCurator}'s`
                  } value on every disagreement.`,
                },
                {
                  key: "accept",
                  kind: leanKinds.accept,
                  label: `${actionLbls.adopt} ${identities.proposer}'s`,
                  onClick: () => dispatchSave("proposal"),
                  title: `Take ${identities.proposer}'s value on every disagreement.`,
                },
                ...(hasReferenceData
                  ? [
                      {
                        key: "ref",
                        kind: "primary-ref" as const,
                        label: `match ${identities.reference}`,
                        onClick: () => dispatchSave("reference"),
                        title: `Take ${identities.reference}'s value on every disagreement.`,
                      },
                    ]
                  : []),
                // Per-row save only makes sense when there are
                // multiple rows the curator picks independently —
                // tags are a single decision (category + value
                // travel together), so hide the secondary "save
                // per-row picks" button for tag findings.
                ...(finding.target_kind === "tag"
                  ? []
                  : [
                      {
                        key: "save",
                        kind: "secondary" as const,
                        label: "save per-row picks",
                        onClick: dispatchPerRowSave,
                        title:
                          "Save what's been picked per-row (mix of proposal / kept / edited).",
                      },
                    ]),
              ]
        }
        onDismiss={onDismiss}
        onPark={onPark}
        onUndo={currentDisposition !== "pending" ? onUndo : undefined}
        // Hide Dismiss / Park for exact matches with no actionable
        // delta — the proposal is identical to current, so there's
        // literally nothing to dismiss or park. Other no-actionable
        // cases (close match where the agent flagged something
        // subtle, calibration_match tags) keep the escape hatches
        // so the curator can flag the finding as wrong. Per Paul
        // 2026-05-21.
        showEscapeHatches={
          !(
            noActionableDelta &&
            (finding.issue_code === "calibration_factor_match_exact" ||
              isExactFactorMatch(finding))
          )
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AgreementSummary({
  rows,
  fvIndicesWithDisagreement,
  fvMeta,
}: {
  rows: Row[];
  /** FVs that have at least one disagreement row. Those FVs are
   *  filtered OUT of the per-FV agreement chips — they belong
   *  in the disagreement block below, not here. */
  fvIndicesWithDisagreement: Set<number>;
  fvMeta: Map<number, FvMeta>;
}) {
  // Group agreed-rows by fvIndex for compact rendering.
  const factorRows = rows.filter((r) => r.fvIndex === null);
  const byFv = new Map<number, Row[]>();
  for (const r of rows) {
    if (r.fvIndex !== null && !fvIndicesWithDisagreement.has(r.fvIndex)) {
      const list = byFv.get(r.fvIndex) ?? [];
      list.push(r);
      byFv.set(r.fvIndex, list);
    }
  }
  const fvIndices = Array.from(byFv.keys()).sort((a, b) => a - b);
  const items: string[] = [];
  for (const r of factorRows) {
    items.push(`${r.rowLabel.toLowerCase()} · ${r.proposal.label}`);
  }
  for (const idx of fvIndices) {
    const meta = fvMeta.get(idx);
    const sampleHint = meta ? ` (${meta.agentSampleCount})` : "";
    items.push(`FV ${idx + 1}${sampleHint}`);
  }
  if (items.length === 0) return null;
  return (
    <div className="text-[11px] text-slate-600 dark:text-slate-400 italic">
      <span className="text-emerald-600 dark:text-emerald-400 font-bold not-italic mr-1">
        ✓
      </span>
      Everyone agrees: {items.join(" · ")}
    </div>
  );
}

/** Surface what the auditor's "near match" classification is
 *  actually keying on, when our per-row diff finds nothing to
 *  contrast. Renders the trimmed rationale + a one-line frame
 *  that explicitly names the contradiction ("rows agree but
 *  auditor flagged it as near") so the curator doesn't read
 *  "Everyone agrees" and assume the auditor was wrong. */
function NearMatchExplainer({ finding }: { finding: AuditFinding }) {
  const rationale = trimRationaleBoilerplate(finding.rationale ?? "").trim();
  const defense = trimRationaleBoilerplate(
    finding.proposer_defense ?? "",
  ).trim();
  const body = rationale || defense;
  return (
    <div className="rounded border border-amber-200 bg-amber-50/60 px-2.5 py-2 dark:border-amber-700/60 dark:bg-amber-900/15 text-[11px] text-amber-900 dark:text-amber-200">
      <div className="flex items-baseline gap-1.5 mb-1">
        <span className="font-bold text-amber-700 dark:text-amber-300">
          ≈
        </span>
        <span className="font-semibold">
          Auditor sees a small difference
        </span>
        <span className="text-[10px] text-amber-700/80 dark:text-amber-300/80">
          — visible rows agree; the delta is in something the comparator
          rows don't surface (FV count, URI variant, sample-count,
          baseline pick, etc.)
        </span>
      </div>
      {body ? (
        <div className="italic text-amber-900/90 dark:text-amber-100/90 leading-snug">
          {body}
        </div>
      ) : (
        <div className="italic text-amber-700/70 dark:text-amber-300/70">
          (no rationale on the wire — see Auditor details below for the
          judge's reasoning)
        </div>
      )}
    </div>
  );
}

/** One block per *statement*. Takes one or more rows that share an
 *  FV+statement (or the single Category row). Renders:
 *   - Header: "FV N · X samples" (or "Category")
 *   - One line per comparator (proposer / gold-curator / reference)
 *     showing what THAT party has across the statement parts
 *     (subject + predicate + object joined by `·`)
 *   - One shared set of decision buttons — the verdict applies to
 *     the whole statement, not individually per part. */
function DisagreementBlock({
  rows,
  contextRows,
  fvMeta,
  identities,
  rowState,
  onPick,
  onEditCommit,
  onLocateCurrent,
  editCategory,
  leanKinds,
  actionLbls,
  judgeText,
  judgeCitation,
}: {
  /** Rows the curator must pick on. Pick / edit state applies to
   *  these. */
  rows: Row[];
  /** All rows (disagreement + agreement) for the same
   *  (fv, statement) group. ComparatorLine renders parts from
   *  these so the full S - P - O context shows even when only
   *  predicate / object disagree. Falls back to ``rows`` when
   *  not supplied. */
  contextRows?: Row[];
  fvMeta: Map<number, FvMeta>;
  identities: AuditIdentities;
  rowState: Map<string, RowState>;
  onPick: (pick: Pick) => void;
  onEditCommit: (label: string, uri: string | null) => void;
  /** Forwarded to the "currently" ComparatorLine's locate button. */
  onLocateCurrent?: () => void;
  /** Category label used to filter the ontology-term picker's
   *  typeahead when the curator opens the "edit…" affordance. */
  editCategory?: string | null;
  /** Lean-driven primary/secondary kinds shared with the outer
   *  ActionRow. Drives which of the (keep, adopt) per-FV
   *  PickButtons reads as recommended. Same value the parent passes
   *  to its bottom-of-card ActionRow — this is the regression-prevent
   *  for the GSE93824 split-bug (Paul 2026-05-21) where the outer
   *  row correctly highlighted `keep current` (green-primary) on
   *  `concept_gold_right` but the per-FV row inside the same block
   *  still highlighted `adopt Auditor's` (blue-primary). */
  leanKinds: { keep: ActionButton["kind"]; accept: ActionButton["kind"] };
  /** Action-aware button labels (keep, adopt). Threaded from the
   *  parent so the per-FV PickButton text matches the OUTER button
   *  row exactly — both rows derive from the same finding-level
   *  action shape (see ./actionLabels.ts). Per Paul 2026-05-21. */
  actionLbls: { keep: string; adopt: string };
  /** Optional "Judge:" rationale to render INSIDE this FV block.
   *  Threaded from the parent on near-match findings (Paul 2026-05-21
   *  redesign — GSE93824 case): the factor-card-level
   *  ``AgentSuggestionPanel`` suppresses its Judge row on these
   *  findings and we render it here so the WHY binds to the exact FV
   *  being corrected. Sentinel text (``[agent emitted no details]``)
   *  comes through ``pickJudgeRowText`` so a missing rationale still
   *  reads as "no details" not "missing UI". ``null`` on non-first
   *  blocks and on extra / gold-only-miss / partition-mismatch
   *  findings — those keep the Judge row at the factor-card level. */
  judgeText?: { text: string; isSentinel: boolean } | null;
  /** Citation URL accompanying the threaded Judge row (mirrors the
   *  ``title=`` on the factor-card-level Judge row). ``null`` when
   *  no citation or no judge text. */
  judgeCitation?: string | null;
}) {
  if (rows.length === 0) return null;
  const first = rows[0];
  const meta = first.fvIndex !== null ? fvMeta.get(first.fvIndex) : undefined;
  const goldLabelForCount =
    identities.goldCurator === "you"
      ? "yours"
      : identities.goldCurator === "Current"
        ? "current"
        : identities.goldCurator;
  const sampleNote =
    meta && meta.agentSampleCount
      ? meta.goldSampleCount !== null &&
        meta.goldSampleCount !== meta.agentSampleCount
        ? `${meta.agentSampleCount} samples · ${goldLabelForCount}: ${meta.goldSampleCount}`
        : `${meta.agentSampleCount} samples`
      : null;
  const elementLabel =
    first.fvIndex !== null
      ? `FV ${first.fvIndex + 1}`
      : first.rowLabel;
  // Display rows = disagreement + agreement (for the same fv +
  // statement). The ComparatorLine renders parts from these so a
  // block where only predicate / object disagree still shows the
  // agreed-on subject — the curator sees the full S - P - O
  // context, not just the disagreeing fragments.
  const displayRows = contextRows ?? rows;
  // ANY row in the (display) group having reference data → show
  // the reference line + button. Each row's reference can be null
  // even when the statement has one (subject has Gemma, predicate
  // doesn't).
  // Same "meaningfully different" gate as the card-level
  // ``hasReferenceData`` check — hide the per-block "Gemma has"
  // line + "match Gemma" pick button when the reference is just
  // restating the Current side (regular calibration mode, where
  // Gemma == Current). Per Paul 2026-05-21.
  const hasReferenceCtx = displayRows.some(
    (r) => r.reference !== null && !sidesAgree(r.reference, r.currently),
  );

  // The block's pick state — consensus of its rows. If every row
  // shares the same pick, the block reads as that. Mixed picks
  // collapse to "edit" (curator is mid-decision).
  const groupPicks = new Set<Pick>();
  for (const r of rows) {
    const s = rowState.get(r.path);
    groupPicks.add(s?.pick ?? null);
  }
  const blockPick: Pick | "mixed" =
    groupPicks.size === 1
      ? (Array.from(groupPicks)[0] as Pick)
      : "mixed";

  // Pre-existing edit value — pull from the subject row when
  // it has one (most common edit anchor).
  const subjectRow = rows.find((r) => r.rowLabel === "Subject") ?? rows[0];
  const subjectState = rowState.get(subjectRow.path);
  const [editOpen, setEditOpen] = useState(subjectState?.pick === "edit");

  // Action-aware button labels — `don't add` / `don't remove` /
  // `don't change` / `confirm` per the finding's action shape (Paul
  // 2026-05-21). The OUTER ActionRow uses the same `actionLbls`
  // object so the per-FV row reads consistently with the bottom-of-
  // card buttons. Replaces the older identity-bearing
  // `keepLabelFor(identities.goldCurator)` ("keep current" /
  // "keep amanda's") — those didn't carry the action verb.
  const keepLabel = actionLbls.keep;
  const adoptLabel = actionLbls.adopt;

  return (
    <div
      className="rounded border border-amber-200 bg-amber-50/30 dark:border-amber-800/60 dark:bg-amber-900/15 p-2 space-y-1.5"
      data-testid="disagreement-block"
    >
      <div className="text-[11px] uppercase tracking-wide font-semibold text-amber-800 dark:text-amber-300 flex items-baseline gap-2">
        <span>{elementLabel}</span>
        {sampleNote ? (
          <span className="font-normal normal-case tracking-normal text-slate-500 dark:text-slate-400">
            ({sampleNote})
          </span>
        ) : null}
      </div>

      {/* Threaded Judge: row — only present on the first block of a
          near-match finding (Paul 2026-05-21 redesign — GSE93824
          gene-URI case). The factor-card-level AgentSuggestionPanel
          drops its Judge row on these findings; we render it here
          so the WHY binds to the exact FV being corrected. Sentinel
          text shows in muted slate italic so "agent emitted no
          details" stays distinct from "renderer dropped the
          field". Matches the styling convention from
          AgentSuggestionPanel's Judge row exactly. */}
      {judgeText ? (
        <div
          data-testid="block-judge-row"
          className={cn(
            judgeText.isSentinel
              ? "text-slate-400 dark:text-slate-500 italic text-[10px] leading-snug"
              : "text-slate-500 dark:text-slate-400 italic text-[10px] leading-snug",
          )}
          title={judgeCitation || undefined}
        >
          <span className="not-italic font-semibold text-slate-600 dark:text-slate-300">
            Judge:
          </span>{" "}
          {judgeText.text}
        </div>
      ) : null}

      <ComparatorLine
        who={identities.proposer}
        verb="said"
        rows={displayRows}
        side="proposal"
        picked={blockPick === "proposal"}
      />
      <ComparatorLine
        who={identities.goldCurator}
        verb={currentlyVerb(identities.goldCurator)}
        rows={displayRows}
        side="currently"
        picked={blockPick === "currently"}
        onLocate={onLocateCurrent}
      />
      {hasReferenceCtx ? (
        <ComparatorLine
          who={identities.reference}
          verb="has"
          rows={displayRows}
          side="reference"
          picked={blockPick === "reference"}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
        <PickButton
          active={blockPick === "currently"}
          recommended={leanKinds.keep === "primary-keep"}
          onClick={() => onPick("currently")}
          tone="keep"
        >
          {keepLabel}
        </PickButton>
        <PickButton
          active={blockPick === "proposal"}
          recommended={leanKinds.accept === "primary-accept"}
          onClick={() => onPick("proposal")}
          tone="accept"
        >
          {adoptLabel} {identities.proposer}'s
        </PickButton>
        {hasReferenceCtx ? (
          <PickButton
            active={blockPick === "reference"}
            onClick={() => onPick("reference")}
            tone="ref"
          >
            match {identities.reference}
          </PickButton>
        ) : null}
        <button
          type="button"
          onClick={() => setEditOpen((v) => !v)}
          className={cn(
            "px-2 py-0.5 rounded border text-[11px]",
            subjectState?.pick === "edit"
              ? "bg-violet-100 border-violet-400 text-violet-900 dark:bg-violet-900/40 dark:border-violet-600 dark:text-violet-100 font-semibold"
              : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700",
          )}
          title="None of the choices is right — pick or type the correct value (lands on subject)."
        >
          edit…
        </button>
      </div>

      {editOpen ? (
        <div className="pt-1 space-y-1">
          {/* Ontology-term picker replaces the bare text input.
              Typeahead pulls from Gemma's annotation catalog
              (filtered by the finding's factor category when
              available); committing a candidate stamps both
              label + URI onto the edit pick. Free-text commit
              (Enter on a non-matching draft) lands with URI=null,
              matching the previous label-only behaviour. */}
          <OntologyTermPicker
            value={
              subjectState?.editLabel
                ? {
                    label: subjectState.editLabel,
                    uri: subjectState.editUri ?? null,
                  }
                : null
            }
            category={editCategory ?? null}
            searchCategory={editCategory ?? null}
            placeholder="type the correct value…"
            autoOpen
            onCommit={(next) => {
              if (next && next.label) {
                onEditCommit(next.label, next.uri ?? null);
              }
            }}
          />
          <button
            type="button"
            onClick={() => setEditOpen(false)}
            className="text-[11px] text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline dark:text-slate-400 dark:hover:text-slate-100"
          >
            close
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Render a single comparator's contribution to a statement-level
 *  block. Reads the appropriate side off each row in the group and
 *  joins them with " · " into one inline statement. Missing parts
 *  are skipped — degenerate statements (subject-only) just show
 *  the subject. */
/** Tag-finding detail block — renders the category + value chips
 *  for Auditor and Current sides. Always visible on tag findings
 *  so the curator sees the full chip detail (label + URI) even
 *  on OK matches, where the existing disagreement-block flow
 *  would render nothing. Per Paul 2026-05-21. */
function TagDetailBlock({
  rows,
  identities,
  onLocateCurrent,
}: {
  rows: Row[];
  identities: AuditIdentities;
  onLocateCurrent?: () => void;
}) {
  const catRow = rows.find((r) => r.rowLabel === "Category");
  const valRow = rows.find((r) => r.rowLabel === "Value");
  if (!catRow && !valRow) return null;
  function renderSide(side: "proposal" | "currently"): JSX.Element {
    const pick = (r: Row | undefined): SideValue | null =>
      r ? (side === "proposal" ? r.proposal : r.currently) : null;
    const cat = pick(catRow);
    const val = pick(valRow);
    const catEmpty = !cat || !cat.label;
    const valEmpty = !val || !val.label;
    if (catEmpty && valEmpty) {
      return <span className="italic text-slate-400">no entry</span>;
    }
    return (
      <span className="flex flex-wrap items-baseline gap-x-1.5">
        {!catEmpty ? (
          <Term
            uri={cat!.uri ?? null}
            asLink={false}
            className="!whitespace-normal break-words"
          >
            {cat!.label}
          </Term>
        ) : (
          <span className="italic text-slate-400">(missing category)</span>
        )}
        <span className="text-slate-400 dark:text-slate-500">:</span>
        {!valEmpty ? (
          <Term
            uri={val!.uri ?? null}
            asLink={false}
            className="!whitespace-normal break-words"
          >
            {val!.label}
          </Term>
        ) : (
          <span className="italic text-slate-400">(missing value)</span>
        )}
      </span>
    );
  }
  const goldVerb = currentlyVerb(identities.goldCurator);
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[6rem_1fr] gap-x-2 items-baseline text-[12px]">
        <span className="text-slate-600 dark:text-slate-300">
          <strong>{identities.proposer}</strong> says
        </span>
        {renderSide("proposal")}
      </div>
      <div className="grid grid-cols-[6rem_1fr] gap-x-2 items-baseline text-[12px]">
        <span className="text-slate-600 dark:text-slate-300">
          <strong>{identities.goldCurator}</strong>
          {goldVerb ? ` ${goldVerb}` : null}
          {onLocateCurrent ? (
            <button
              type="button"
              onClick={onLocateCurrent}
              title="show in Design tab"
              aria-label="locate in design"
              className="ml-1 align-baseline text-[11px] text-slate-400 hover:text-sky-700 dark:text-slate-500 dark:hover:text-sky-300"
            >
              🔍
            </button>
          ) : null}
        </span>
        {renderSide("currently")}
      </div>
    </div>
  );
}

function ComparatorLine({
  who,
  verb,
  rows,
  side,
  picked,
  onLocate,
}: {
  who: string;
  /** Optional verb after the identity label ("says" / "have" /
   *  "has"). Empty string suppresses — the default "Current"
   *  identity reads as a label alone, no trailing verb. */
  verb: string;
  rows: Row[];
  side: "proposal" | "currently" | "reference";
  picked: boolean;
  /** When provided, renders a small 🔍 button next to the identity
   *  label. Clicking it triggers a cross-pane jump to the
   *  matching factor / FV in the Design tab. Only meaningful on
   *  the ``currently`` side (the gold curator's design data is
   *  what the Design tab shows). */
  onLocate?: () => void;
}) {
  // Sort within the group by part order. Category is filtered
  // out when the group has OTHER rows (subject/predicate/object)
  // — the card-level "FACTOR <category>" label carries the
  // category in that case, so showing it again here would be
  // redundant. When the group is Category-only (e.g. an agent
  // proposed a category rename and the only disagreement is on
  // the category itself), keep Category visible so the curator
  // can actually see what's diverging instead of an empty
  // "no entry / no entry" block.
  const ORDER = ["Category", "Subject", "Predicate", "Object", "Value"];
  const hasNonCategory = rows.some((r) => r.rowLabel !== "Category");
  const sorted = [...rows]
    .filter((r) => !hasNonCategory || r.rowLabel !== "Category")
    .sort((a, b) => ORDER.indexOf(a.rowLabel) - ORDER.indexOf(b.rowLabel));
  // For each row, include it in the rendered parts whenever ANY
  // comparator side has a value for that part. Empty side gets a
  // faded "(missing)" placeholder so the curator sees the gap.
  //
  // BUT: when the Subject AGREES across all comparators (same
  // entity), don't flag missing predicate / object on the sides
  // that lack them. A subject-agreeing, structure-divergent shape
  // (agent layered S+P+O over gold's S-only) reads as "extra
  // structure" rather than "gold is missing P+O" — the (missing)
  // marker overstates the divergence. The placeholder feature is
  // kept for the case when Subject diverges (different entities
  // being talked about, where seeing each side's full slot
  // inventory matters). Per Paul 2026-05-21.
  const subjectRow = sorted.find((r) => r.rowLabel === "Subject");
  const suppressMissingPlaceholders = !!subjectRow && subjectRow.allAgree;
  // If THIS side has no data on any row, the comparator is wholly
  // absent (e.g. agent_extra / factor_extra findings where gold
  // doesn't have the proposed factor at all). Skip per-part
  // "(missing X)" placeholders — they'd repeat "missing" for
  // every row when the card type already conveys the absence.
  // Falls through to the existing "no entry" render.
  const thisSideHasAny = sorted.some((r) => {
    const v =
      side === "proposal"
        ? r.proposal
        : side === "currently"
          ? r.currently
          : r.reference;
    return !!(v && v.label);
  });
  const parts: {
    value: SideValue;
    partLabel: string;
    missing: boolean;
  }[] = [];
  for (const r of sorted) {
    const anyHas =
      !!(r.proposal && r.proposal.label) ||
      !!(r.currently && r.currently.label) ||
      !!(r.reference && r.reference.label);
    if (!anyHas) continue;
    const v =
      side === "proposal"
        ? r.proposal
        : side === "currently"
          ? r.currently
          : r.reference;
    const missing = !v || !v.label;
    if (missing && !thisSideHasAny) continue;
    if (missing && suppressMissingPlaceholders && r.rowLabel !== "Subject") {
      continue;
    }
    parts.push({
      value: v ?? { label: "", uri: null },
      partLabel: r.rowLabel,
      missing,
    });
  }
  return (
    <div
      className={cn(
        "grid grid-cols-[6rem_1fr] gap-x-2 items-baseline text-[12px]",
        picked && "rounded bg-blue-50 dark:bg-blue-900/30 px-1 py-0.5",
      )}
    >
      <span className="text-slate-600 dark:text-slate-300">
        <strong>{who}</strong>{verb ? ` ${verb}` : null}
        {onLocate ? (
          <button
            type="button"
            onClick={onLocate}
            title="show in Design tab"
            aria-label="locate in design"
            className="ml-1 align-baseline text-[11px] text-slate-400 hover:text-sky-700 dark:text-slate-500 dark:hover:text-sky-300"
          >
            🔍
          </button>
        ) : null}
      </span>
      <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
        {parts.length === 0 ? (
          <span className="italic text-slate-400">no entry</span>
        ) : (
          // Render S - P - O with explicit " - " separators between
          // the present parts. Missing P or O collapse out, so a
          // bare subject reads as "X", S+P as "X - p", full triple
          // as "X - p - Y". Same shape across comparator lines so
          // "what's there vs what's missing" reads at a glance —
          // e.g. agent has S+P, gold has just S → curator can see
          // they share the subject and gold is missing the role
          // statement around it. Per Paul 2026-05-21: "all the
          // cards should show statements like S - P - O, though
          // - P - O can be omitted".
          parts.map((p, i) => {
            const sep =
              i === 0 ? null : (
                <span
                  key={`sep-${p.partLabel}`}
                  className="text-slate-400 dark:text-slate-500"
                  aria-hidden
                >
                  {" - "}
                </span>
              );
            // Missing slot — this side lacks a part another side
            // has. Render a faded "(missing <part>)" placeholder
            // so the curator sees the gap explicitly.
            if (p.missing) {
              const partWord = p.partLabel.toLowerCase();
              return (
                <span key={p.partLabel} className="inline-flex items-baseline">
                  {sep}
                  <span
                    className="text-[11px] italic text-slate-400 dark:text-slate-500"
                    title={`${who} has no ${partWord} for this statement`}
                  >
                    (missing {partWord})
                  </span>
                </span>
              );
            }
            // Predicates render small + muted, no chip styling —
            // they're structural plumbing (e.g. "has_genotype"
            // between subject and object). Gemma's own per-FV
            // display uses the same teeny-predicate convention.
            if (p.partLabel === "Predicate") {
              return (
                <span key={p.partLabel} className="inline-flex items-baseline">
                  {sep}
                  <span
                    className="text-[10px] text-slate-500 dark:text-slate-200 font-mono"
                    title={p.value.uri || undefined}
                  >
                    {p.value.label}
                  </span>
                </span>
              );
            }
            // Subject / Object / Category render as Term chips.
            // Full label always — the species bracket (e.g.
            // "Rpl22 [mouse] ribosomal protein L22" vs
            // "RPL22 [human] ..." ) is load-bearing for the
            // curator's species check. The URI suffix carries
            // the canonical NCBI gene ID so the comparison
            // "are these the same gene" stays unambiguous.
            return (
              <span key={p.partLabel} className="inline-flex items-baseline">
                {sep}
                <Term
                  uri={p.value.uri ?? null}
                  asLink={false}
                  className="!whitespace-normal break-words"
                >
                  {p.value.label}
                </Term>
              </span>
            );
          })
        )}
        {/* No "← in current design" caption — the "Current" left-
            column label already conveys that. Future follow-up:
            click-to-highlight (magnifying glass icon) cross-pane
            jump to the corresponding factor in the Design tab. */}
      </span>
    </div>
  );
}


interface ActionButton {
  key: string;
  kind: "primary-keep" | "primary-accept" | "primary-ref" | "secondary";
  label: string;
  onClick: () => void;
  title?: string;
}

/** Pick button kinds for the (keep, accept) pair based on the
 *  judge's lean. Lets the curator see which action the judge
 *  recommends without changing the underlying wire shape.
 *
 *  Defaults (lean=neutral) preserve today's behaviour: both buttons
 *  styled as primary (filled, prominent). When the judge leans
 *  pro_gold the accept button demotes to ``secondary`` (outline) so
 *  the keep button reads as the recommended action — fixes the
 *  GSE93824 Arctic-APP case (Paul 2026-05-21) where the judge said
 *  agent is wrong but the UI still highlighted `adopt Auditor's`.
 *  Mirror case for pro_agent: keep demotes, accept stays primary
 *  (also matches today's de-facto behaviour where most defender-
 *  verdict findings lean pro-agent). */
export function leanButtonKinds(lean: DefenderLean): {
  keep: ActionButton["kind"];
  accept: ActionButton["kind"];
} {
  if (lean === "pro_gold") {
    return { keep: "primary-keep", accept: "secondary" };
  }
  if (lean === "pro_agent") {
    return { keep: "secondary", accept: "primary-accept" };
  }
  // Neutral / no defender → today's behaviour: both filled. The
  // curator gets no visual nudge in either direction.
  return { keep: "primary-keep", accept: "primary-accept" };
}

/** Compact chip for the partition_mismatch mapping block. Drops
 *  the URI annotation that `Term` renders inline (full URI still
 *  surfaces on hover via the title attribute) and uses tighter
 *  padding + text so a parent + several children fit on one
 *  line. Ontology-resolved terms use the emerald palette;
 *  free-text falls through to grey italic — same convention as
 *  Term. */
function MappingChip({ term }: { term: { label: string; uri: string | null } }) {
  const hasUri = !!term.uri;
  return (
    <span
      title={term.uri ? `${term.label} — ${term.uri}` : term.label}
      className={cn(
        "inline-flex items-baseline gap-1 px-1 py-0 rounded text-[11px] leading-[1.3rem] border",
        hasUri
          ? "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-700"
          : "bg-stone-50 text-stone-600 border-stone-200 italic dark:bg-stone-800 dark:text-stone-300 dark:border-stone-600",
      )}
    >
      <span>{term.label}</span>
      {hasUri ? (
        <span className="text-slate-400 font-mono text-[10px] whitespace-nowrap">
          {shortenUri(term.uri!)}
        </span>
      ) : null}
    </span>
  );
}

/** Inline suggestion banner for findings linked through
 *  `consequent_of` / `consequents`. Renders one of three states:
 *
 *  - "implied": the linked side decided + this side hasn't.
 *    Suggests the verdict that would keep the pair consistent +
 *    a one-click action button. Curator can ignore and pick
 *    differently using the normal buttons.
 *  - "consistent": both sides decided, same direction. Tiny ✓
 *    stamp acknowledging the consistency.
 *  - "diverges": both sides decided, opposite directions. Small
 *    ⚠ stamp surfacing the divergence — no forced action, just
 *    visible so the curator can revisit if it was unintentional.
 *
 *  Per Paul (2026-05-20): "accepting one should somehow mark the
 *  other... the curators should be cued to do the logically
 *  consistent thing... there has to be an override, so it's more
 *  a suggestion that I'm looking for the curators to see". */
function ConsequentHintBanner({
  state,
  onApply,
  saving,
}: {
  state: ConsequentHintState;
  onApply: (verdict: "proposal" | "currently") => void;
  saving: boolean;
}) {
  if (state.kind === "implied") {
    const headline =
      state.linkedVerdict === "proposal"
        ? `\`${state.linkedLabel}\` was accepted`
        : `\`${state.linkedLabel}\` was kept`;
    const tail =
      state.side === "downstream"
        ? state.linkedVerdict === "proposal"
          ? "accepting removal here keeps them consistent"
          : "keeping this also keeps them consistent"
        : state.linkedVerdict === "proposal"
          ? "adopting the split here keeps them consistent"
          : "keeping the existing factor here keeps them consistent";
    return (
      <div className="flex items-baseline flex-wrap gap-2 rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900 dark:border-amber-700/70 dark:bg-amber-900/20 dark:text-amber-100">
        <span className="text-[10px] uppercase tracking-wide font-semibold opacity-70">
          Linked
        </span>
        <span className="flex-1 min-w-0">
          {headline} — {tail}.
        </span>
        <button
          type="button"
          onClick={() => onApply(state.impliedVerdict)}
          disabled={saving}
          className="px-2 py-0.5 rounded text-[11px] font-semibold bg-sky-700 text-white hover:bg-sky-800 disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
          title="Apply the suggested verdict; you can still pick differently using the buttons below."
        >
          {state.impliedActionLabel}
        </button>
      </div>
    );
  }
  if (state.kind === "consistent") {
    return (
      <div className="text-[10px] uppercase tracking-wide font-semibold text-emerald-700 dark:text-emerald-300">
        ✓ consistent with `{state.linkedLabel}`
      </div>
    );
  }
  // diverges
  const divergePhrase =
    state.linkedVerdict === "proposal"
      ? `\`${state.linkedLabel}\` was accepted, this was dismissed`
      : `\`${state.linkedLabel}\` was kept, this was accepted`;
  return (
    <div className="text-[10px] uppercase tracking-wide font-semibold text-amber-700 dark:text-amber-300">
      ⚠ diverges from linked decision — {divergePhrase}
    </div>
  );
}

function ActionRow({
  saving,
  disabled,
  buttons,
  onDismiss,
  onPark,
  onUndo,
  showEscapeHatches = true,
}: {
  saving: boolean;
  disabled: boolean;
  buttons: ActionButton[];
  onDismiss: () => void;
  onPark: () => void;
  /** When provided, renders an "undo" text link on the far right
   *  that reverts the disposition to ``pending``. The caller (the
   *  editor body) decides whether to pass this based on
   *  ``currentDisposition !== "pending"``. */
  onUndo?: () => void;
  /** When false, suppress the Dismiss / Park buttons entirely.
   *  Used for exact-match findings where the proposal is identical
   *  to current — there's nothing to dismiss or park because there
   *  was no proposed change in the first place. Per Paul
   *  2026-05-21: "if it's exactly the same factor, and it's
   *  pre-resolved, we don't need to show the dismiss and park
   *  buttons." Defaults to true so every existing call site keeps
   *  showing the escape hatches. */
  showEscapeHatches?: boolean;
}) {
  // If there's nothing for the curator to act on AND we've hidden
  // the escape hatches, the whole row collapses to either the undo
  // affordance (if dispositioned) or nothing at all.
  const hasNothingToRender =
    buttons.length === 0 && !showEscapeHatches && !onUndo;
  if (hasNothingToRender) return null;

  return (
    <div className="flex items-center gap-2 pt-1 text-xs flex-wrap">
      {buttons.map((b) => (
        <button
          key={b.key}
          type="button"
          onClick={b.onClick}
          disabled={saving || disabled}
          title={b.title}
          className={cn(
            "px-2.5 py-1 rounded text-xs font-semibold disabled:cursor-not-allowed",
            b.kind === "primary-keep" &&
              "bg-emerald-700 text-white hover:bg-emerald-800 disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400",
            b.kind === "primary-accept" &&
              "bg-blue-700 text-white hover:bg-blue-800 disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400",
            b.kind === "primary-ref" &&
              "bg-sky-700 text-white hover:bg-sky-800 disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400",
            b.kind === "secondary" &&
              "border border-slate-400 text-slate-700 hover:bg-slate-100 dark:border-slate-500 dark:text-slate-200 dark:hover:bg-slate-700 disabled:text-slate-400 dark:disabled:text-slate-500",
          )}
        >
          {saving ? "Saving…" : b.label}
        </button>
      ))}
      {buttons.length > 0 && showEscapeHatches ? (
        <span className="text-slate-300 dark:text-slate-600">·</span>
      ) : null}
      {showEscapeHatches ? (
        <>
          <button
            type="button"
            onClick={onDismiss}
            disabled={saving}
            className="px-2.5 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Dismiss…
          </button>
          <button
            type="button"
            onClick={onPark}
            disabled={saving}
            className="px-2.5 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Park…
          </button>
        </>
      ) : null}
      {onUndo ? (
        <button
          type="button"
          onClick={onUndo}
          disabled={saving}
          title="undo — reverts disposition and any draft change"
          className="ml-auto text-[10px] text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline dark:text-slate-400 dark:hover:text-slate-100"
        >
          undo
        </button>
      ) : null}
    </div>
  );
}

/** Per-FV pick button inside `DisagreementBlock`. Two visual axes:
 *
 *  - ``active`` — the curator clicked this side; renders filled in
 *    the tone colour regardless of lean (their pick always wins
 *    visually).
 *  - ``recommended`` — the judge's lean points at this side;
 *    renders filled in the tone colour by default so the curator
 *    sees which action is suggested without first clicking
 *    anything. Mirrors the outer ActionRow's primary-keep /
 *    primary-accept kinds (Paul 2026-05-21: the outer row was
 *    lean-aware after 21f7f17 but this per-FV row was still
 *    highlighting "adopt Auditor's" on `concept_gold_right`
 *    findings like GSE93824 genotype FV2).
 *
 *  Unset on both axes → outlined in tone colour, same as the
 *  original inactive style. */
function PickButton({
  active,
  recommended = false,
  onClick,
  tone,
  children,
}: {
  active: boolean;
  recommended?: boolean;
  onClick: () => void;
  tone: "keep" | "accept" | "ref";
  children: React.ReactNode;
}) {
  const filledCls = {
    keep: "bg-emerald-700 text-white border-emerald-700",
    accept: "bg-blue-700 text-white border-blue-700",
    ref: "bg-sky-700 text-white border-sky-700",
  }[tone];
  const outlinedCls = {
    keep:
      "border-emerald-400 text-emerald-800 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/30",
    accept:
      "border-blue-400 text-blue-800 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-900/30",
    ref: "border-sky-400 text-sky-800 hover:bg-sky-50 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-900/30",
  }[tone];
  const filled = active || recommended;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2 py-0.5 rounded border text-[11px] font-semibold",
        filled ? filledCls : outlinedCls,
      )}
    >
      {children}
    </button>
  );
}
