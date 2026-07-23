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

import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { shortenUri } from "@/lib/curie";
import { sameOntologyTerm, capitalizeCategory } from "@/lib/ontologyTerm";
import { useToast } from "@/components/ui/Toast";
import { Term, termRenderer } from "@/components/ui/Term";
import { StatementSequence } from "@/components/ui/StatementSequence";
import { useIsReadOnly } from "@/features/comparison/FlowContext";
import {
  FactorComparisonGrid,
  type FactorComparisonPair,
} from "./factorComparison/FactorComparisonGrid";
import { buildPartitionMismatchPairs } from "./factorComparison/partitionRowBuilder";
import { FvDisplayRow } from "@gemma/ontology";
import {
  ContinuousStrip,
  continuousValuesFrom,
} from "./factorComparison/FactorComparisonGrid";

// The editor-scoped term renderer lives inside FindingDetailsEditor
// — it closes over local state so "find ▸" lookups can mount an
// inline OntologyTermPicker. The module-level constant was retired
// when free-text lookup landed (2026-05-25).
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
  FactorValue,
  Statement,
  Tag,
} from "@/features/experiment/types";
import type { FactorValueProposal } from "@/api/types";
import {
  factorProposalFromApplyAction,
  isCloseFactorMatch,
  isExactFactorMatch,
  isNearMatchFinding,
  isSamePartitionTermDiff,
  resolveAgentFactor,
  resolveGoldFactor,
} from "./factorMatch";
import { pickJudgeRowText } from "./auditorDetails";
import { SHOW_PARK_AFFORDANCE } from "./auditPresentation";
import { verdictToStructureDetails } from "./dispositionSave";
import { consequentHint, type ConsequentHintState } from "./consequentHint";
import { firstBacktick, trimRationaleBoilerplate } from "./rationaleText";
import { findingLean, type DefenderLean } from "./defenderLean";
import {
  acceptLabel,
  actionLabels,
  findingActionShape,
  type ActionShape,
} from "./actionLabels";
import { findingDisplayedGoldEmpty } from "./findingHelpers";
import { parseTargetId, slug } from "./targetIds";
import type { FactorProposal } from "@/api/types";
import { useAudit } from "./AuditContext";
import {
  locateTooltipFor,
  requestAuditFocus,
} from "@/lib/scrollToAuditTarget";
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

/** Read the ``part`` (subject / predicate / object) off a gold FV's
 *  first statement, with the same free-text-label fallback the
 *  biomaterial path uses. Split out so the id-join and the
 *  biomaterial-overlap paths share one rendering rule. */
function goldFvStatementPart(
  goldFv: FactorValue,
  part: "subject" | "predicate" | "object",
): SideValue {
  const st = goldFv.statements?.[0];
  if (st) return statementPart(st, part);
  if (part === "subject") {
    const label = goldFv.free_text_label?.trim() ?? "";
    return { label, uri: null };
  }
  return { label: "", uri: null };
}

function pairAgentStatementToGold(
  agentFv: FactorValueProposal,
  gold: Factor | null,
  part: "subject" | "predicate" | "object",
  goldId?: number | null,
): SideValue | null {
  if (!gold) return null;
  // ID-first: resolve the paired gold FV by its stable Gemma id
  // (``rename.fv_pairs[].gold_id``) when the wire carries one.
  if (goldId != null && Number.isInteger(goldId)) {
    const byId = gold.factor_values.find((g) => g.id === goldId);
    if (byId) return goldFvStatementPart(byId, part);
  }
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
      // Gold's matching FV may have no structured statement — common
      // for free-text-only curations (e.g. timepoint FVs labeled
      // "2 h" with no role-of-baseline statement). ``goldFvStatementPart``
      // falls back to ``free_text_label`` as the subject so the curator
      // sees gold's FV identity instead of a bare "no entry", and emits
      // explicit-empty for predicate / object so a divergent agent
      // statement reads as a near-match, not as gold-has-nothing.
      return goldFvStatementPart(goldFv, part);
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
  /** Extra current-side statements beyond ``statements[0]`` — the
   *  comparator row builder pairs the agent's single proposed
   *  statement against gold's ``statements[0]``, but a curated FV
   *  often carries multiple statements (subject + dose, role +
   *  modifier, etc.). The disagreement block renders these as
   *  "(also: S - P - O)" hints beneath the main Current line so
   *  the curator sees gold's full structure. Per Paul 2026-06-11
   *  (FV 4 dexamethasone case — only the first of two statements
   *  was rendering). */
  goldExtraStatements?: Array<{
    subject: SideValue;
    predicate: SideValue;
    object: SideValue;
  }>;
}

interface BuildResult {
  rows: Row[];
  fvMeta: Map<number, FvMeta>;
}

function pairAgentGoldFv(
  agentFactor: FactorValueProposal,
  gold: Factor | null,
  goldId?: number | null,
): FactorValue | null {
  if (!gold) return null;
  // ID-first: when the wire carries the paired gold ``FactorValue``'s
  // stable Gemma id (``rename.fv_pairs[].gold_id``), resolve by an id
  // join. This survives biomaterial reordering / partial overlap that
  // the exact-set-equality fallback below can't disambiguate.
  if (goldId != null && Number.isInteger(goldId)) {
    const byId = gold.factor_values.find((g) => g.id === goldId);
    if (byId) return byId;
  }
  // Fallback: exact biomaterial-set equality (older packages carry no
  // gold_id).
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
    if (allIn) return goldFv;
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
  const agent =
    factorProposalFromApplyAction(finding) ??
    resolveAgentFactor(finding, cp, labelHint);
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

  // Agent-FV-label → paired gold FactorValue id, from the finding's
  // self-carried ``rename.fv_pairs`` (id-hardening ship). Lets
  // ``pairAgentGoldFv`` do a stable-id join instead of biomaterial-set
  // equality. Keyed by the agent-side label so it survives FV
  // reordering; empty on older packages (no ``gold_id``), where the
  // biomaterial fallback stays in charge.
  const goldIdByAgentLabel = new Map<string, number>();
  for (const p of rename?.fv_pairs ?? []) {
    if (p.gold_id != null && Number.isInteger(p.gold_id) && p.agent?.label) {
      goldIdByAgentLabel.set(lc(p.agent.label), p.gold_id);
    }
  }

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
    const goldId =
      goldIdByAgentLabel.get(lc(fv.free_text_label || "")) ?? null;
    const pairedGoldFv = pairAgentGoldFv(fv, gold, goldId);
    // Gold-side statements beyond ``[0]`` — surface as "(also: …)"
    // lines in the disagreement block so the curator sees the full
    // current structure even when the comparator row builder only
    // pairs against ``statements[0]``.
    const goldExtraStatements = pairedGoldFv
      ? (pairedGoldFv.statements ?? []).slice(1).map((st) => ({
          subject: statementPart(st, "subject"),
          predicate: statementPart(st, "predicate"),
          object: statementPart(st, "object"),
        }))
      : [];
    fvMeta.set(fvIdx, {
      agentSampleCount: fv.biomaterial_short_names?.length ?? 0,
      goldSampleCount: pairedGoldFv
        ? (pairedGoldFv.biomaterial_short_names ?? []).length
        : null,
      goldExtraStatements: goldExtraStatements.length
        ? goldExtraStatements
        : undefined,
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
        : pairAgentStatementToGold(fv, gold, part, goldId);
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

/** Statement-delta rows for a tag near-match (calibration_tag_match_near,
 *  2026-07-13). The proposer proposes structured statements
 *  (subject·predicate·object — e.g. a bare ``genotype: Utrn`` gains
 *  ``Utrn · has_genotype · Heterozygous``); the curator needs the same
 *  Current-vs-Proposed delta the FV path shows, not just the proposed
 *  statement on the header. Mirrors the FV statement-part builder: one
 *  Subject / Predicate / Object row for the primary statement, pairing
 *  the proposed statement against the matched tag's current statement.
 *
 *  Only fires when the proposal carries real S-P-O detail (a predicate
 *  or object) — a plain / subject-only tag has no statement delta and
 *  keeps the Category / Value rows alone. */
function tagStatementRows(
  finding: AuditFinding,
  currentTag: Tag | null,
): Row[] {
  const proposed = (finding.proposer_statements ?? []).filter(
    (s) => s.subject?.label,
  );
  const hasDetail = proposed.some(
    (s) => !!s.predicate?.label || !!s.object?.label,
  );
  if (!hasDetail) return [];
  // Primary statement only — tags follow the one-tag-per-gene
  // convention, and the FV path likewise compares ``statements[0]``.
  const proposedStmt = proposed[0] as unknown as Statement;
  const currentStmt = (currentTag?.statements ?? [])[0] ?? null;
  const rows: Row[] = [];
  const partOrder: Array<"subject" | "predicate" | "object"> = [
    "subject",
    "predicate",
    "object",
  ];
  for (const part of partOrder) {
    const proposal = statementPart(proposedStmt, part);
    let currently: SideValue = currentStmt
      ? statementPart(currentStmt, part)
      : { label: "", uri: null };
    // Current bare tag (no statements): its subject IS its value
    // ("Subject = value" wire contract). Fall back so the Subject row
    // shows the existing concept rather than reading as brand-new.
    if (part === "subject" && isSideEmpty(currently) && currentTag) {
      currently = {
        label: currentTag.value?.label || "",
        uri: currentTag.value?.uri ?? null,
      };
    }
    if (part !== "subject") {
      if (isSideEmpty(proposal) && isSideEmpty(currently)) continue;
    }
    rows.push({
      path: `tag.statements[0].${part}`,
      rowLabel: part[0].toUpperCase() + part.slice(1),
      proposal,
      currently,
      reference: null,
      fvIndex: null,
      statementIndex: 0,
      allAgree: rowAgreement(proposal, currently, null),
    });
  }
  return rows;
}

export function buildTagRows(finding: AuditFinding, design: Design | null): Row[] {
  // Recognised prefixes:
  //   - ``calibration:<bucket>:<category>/<value>`` — real calibration
  //     finding from the agent-audit pipeline.
  //   - ``chipdiff:tag:<verb>:<key>`` — synthetic finding from the
  //     comparison view's chip strip (see
  //     features/comparison/diffToAuditReport.ts). The key is a
  //     ``<category>|<value>`` pair (URI when available, label
  //     fallback) — we want the human-readable bits from
  //     ``proposer_term`` + the rationale, not the URI keys.

  // Tag SWAP (``replace_tag`` near-match): the agent proposes replacing
  // an existing baseline tag with a same-concept term under a different
  // URI (GSE154383: ``disease model: brain ischemia`` MONDO:0005299 →
  // ``cerebral ischemia`` MONDO:0002679). The "current" side is the
  // REPLACED tag, addressed by ``target_id = "tag:N"`` — it is NOT
  // discoverable by looking up the proposed value (different URI), which
  // is why the proposer-value lookup below left the Current column empty
  // and the "don't change" button had no referent. Resolve current from
  // the replaced design tag instead. (my brother's
  // UIB_HANDOFF_2026_06_20_TAG_SWAP_CURRENT_SIDE_FROM_TARGETID.md.)
  const apply = finding.apply_action ?? null;
  if (apply?.kind === "replace_tag") {
    const swapTags = design?.tags ?? [];
    const parsedSwap = parseTargetId(finding.target_id);
    const replacedId =
      parsedSwap?.kind === "tag" && /^\d+$/.test(parsedSwap.categorySlug)
        ? Number(parsedSwap.categorySlug)
        : null;
    let baseline =
      replacedId != null
        ? swapTags.find((t) => t.id === replacedId) ?? null
        : null;
    // Slug-shaped target_id (``tag:<cat>/<val>``) — the statement
    // near-match addresses the existing tag by category/value slug, not
    // a numeric id. Resolve it the same way applyHandlers does so the
    // Current column + statement delta populate.
    if (!baseline && parsedSwap?.kind === "tag" && parsedSwap.valueSlug) {
      baseline =
        swapTags.find(
          (t) =>
            slug(t.category?.label) === parsedSwap.categorySlug &&
            slug(t.value?.label) === parsedSwap.valueSlug,
        ) ?? null;
    }
    if (baseline) {
      const swapTerm = finding.proposer_term ?? null;
      const a = apply as {
        new_category?: unknown;
        new_value?: unknown;
        new_value_uri?: unknown;
      };
      const newCategory =
        typeof a.new_category === "string" ? a.new_category : "";
      const newValue = typeof a.new_value === "string" ? a.new_value : "";
      const newValueUri =
        typeof a.new_value_uri === "string" ? a.new_value_uri : null;

      // Proposed (Auditor) side — prefer proposer_term, fall back to
      // apply_action so the value chip resolves even on lean payloads.
      const valueProposal: SideValue = {
        label: swapTerm?.label || newValue,
        uri: swapTerm?.uri ?? newValueUri,
      };
      // A swap keeps the category and only moves the value URI; borrow
      // the baseline category's URI when the labels agree so the
      // proposed category renders as a chip, not italic free text.
      const proposalCategoryLabel = newCategory || baseline.category.label || "";
      const categoryProposal: SideValue = {
        label: proposalCategoryLabel,
        uri:
          (lc(proposalCategoryLabel) === lc(baseline.category.label)
            ? baseline.category.uri ?? null
            : null),
      };
      const categoryCurrently: SideValue = {
        label: baseline.category.label || "",
        uri: baseline.category.uri ?? null,
      };
      const valueCurrently: SideValue = {
        label: baseline.value.label || "",
        uri: baseline.value.uri ?? null,
      };
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
        ...tagStatementRows(finding, baseline),
      ];
    }
    // No baseline tag found — bare ``--gses`` build without the gold
    // override (the design doesn't carry the replaced tag). Fall through
    // to the legacy path; ``tag:N`` hits the ``else { return [] }`` below
    // and renders nothing, same as before this branch. Per the handoff:
    // those packages aren't meant to be reviewed.
  }

  let agentCategory: string;
  let agentValue: string;
  if (finding.target_id.startsWith("calibration:")) {
    const rest = finding.target_id.slice("calibration:".length);
    const colon = rest.indexOf(":");
    if (colon === -1) return [];
    const tail = rest.slice(colon + 1);
    const slash = tail.indexOf("/");
    if (slash === -1) return [];
    agentCategory = tail.slice(0, slash);
    agentValue = tail.slice(slash + 1);
  } else if (finding.target_id.startsWith("chipdiff:tag:")) {
    // Synthetic chip-diff tag finding. The category + value labels
    // live on ``proposer_term`` (value side) + parsed out of the
    // rationale's "category: value" tail. Cheaper than threading
    // both URIs through the target_id.
    const term = finding.proposer_term ?? null;
    agentValue = term?.label ?? "";
    // Rationale is shaped "Actor verb tag — category: value". Pull
    // the ``category`` chunk by splitting on the last em-dash.
    const tail = finding.rationale.split(" — ").slice(-1)[0] ?? "";
    const idx = tail.lastIndexOf(": ");
    agentCategory = idx >= 0 ? tail.slice(0, idx) : "";
  } else {
    return [];
  }
  const term = finding.proposer_term ?? null;
  const lookupTags = design?.tags ?? [];

  // The calibration ``target_id`` carries only the category *label*
  // ("organism part"), never its URI, and ``proposer_term`` is the
  // value side only — so the proposer category has no URI on the wire
  // and rendered as plain italic text while the Current column showed a
  // proper term chip (Paul 2026-06-19). Category labels are a small
  // controlled vocabulary that resolves to the same ontology term across
  // the whole experiment ("organism part" → EFO:0000635), so borrow the
  // URI from any design tag filed under the same category label. Mirrors
  // the value-side / findingCard.tsx category-fallback pattern; when no
  // design tag uses the label (genuinely novel category) the URI stays
  // null and the chip degrades to italic, which is correct.
  const categoryUriFromDesign =
    lookupTags.find(
      (t) => lc(t.category?.label) === lc(agentCategory) && !!t.category?.uri,
    )?.category?.uri ?? null;

  const categoryProposal: SideValue = {
    label: agentCategory,
    uri: categoryUriFromDesign,
  };
  const valueProposal: SideValue = {
    label: term?.label || agentValue,
    uri: term?.uri ?? null,
  };

  // Look up the gold side from the local design's tags. URI-FIRST:
  // when the auditor's value carries a URI and a design tag carries
  // the same URI, that's the same tag regardless of which category
  // label the curator filed it under. Categories drift on this
  // surface — e.g. "disease" (EFO:0000408) and "disease model" are
  // both used for the same MONDO disease term. The pre-2026-06-12
  // lookup required category-label equality and silently dropped
  // tags whose categories differed, surfacing as "no entry" in the
  // Current column even when the tag was present. Per Paul: GSE87700
  // ``disease model: fetal alcohol spectrum disorder MONDO:0000408``
  // was matched against design tag ``disease: fetal alcohol spectrum
  // disorder MONDO:0000408`` — the URIs agree, the category labels
  // don't, lookup should succeed.
  //
  // Match order:
  //   1. Value URI exact match (the identity-bearing field).
  //   2. (category-label, value-label) case-insensitive both — for
  //      legacy / free-text tags where neither side carries a URI.
  const matchedTag =
    (valueProposal.uri
      ? lookupTags.find(
          (t) =>
            !!t.value?.uri && t.value.uri === valueProposal.uri,
        )
      : null) ??
    lookupTags.find(
      (t) =>
        lc(t.category?.label) === lc(agentCategory) &&
        sameOntologyTerm(t.value ?? null, valueProposal),
    ) ??
    null;

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
    ...tagStatementRows(finding, matchedTag),
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
    const agent =
      factorProposalFromApplyAction(finding) ??
      resolveAgentFactor(finding, cp, labelHint);
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
  onAgree,
  onDismiss,
  onPark,
  onUndo,
  isParked,
  onResolve,
}: {
  finding: AuditFinding;
  report: AuditReport | null;
  design: Design | null;
  currentDisposition: DispositionStatus;
  /** True when the finding is accepted-but-not-resolved (parked via
   *  "Agree, needs work"). Gates the "Resolve →" affordance so a
   *  parked finding can be closed from the editor instead of
   *  dead-ending. The editor only sees ``currentDisposition`` (the
   *  status enum), which can't distinguish parked from resolved —
   *  hence this explicit flag from findingCard. */
  isParked?: boolean;
  /** Close the two-step accept — stamp resolved_at now. Wired to the
   *  "Resolve →" button when ``isParked``. */
  onResolve?: () => void;
  onSave: (
    appliedFix: AppliedFix,
    structureOk: boolean | null,
    detailsOk: boolean | null,
    /** Optional free-text explanation from the curator. Surfaced
     *  on the "Apply with optional explanation" prompt; rides on
     *  the disposition PATCH so the close-review summary carries
     *  the WHY back to the curation agent. */
    notes?: string,
    /** When ``needsWork`` is true the accept is recorded as
     *  "agreed, follow-up pending" — status=accepted with
     *  ``resolved_at`` left null (the "parked" half of the two-step
     *  accept; see findingCard's ``isParked``). The draft mutation
     *  still runs exactly as a plain Agree; only the resolved stamp
     *  is withheld so the finding stays in the curator's follow-up
     *  queue (a "Resolve →" affordance closes it later). Drives the
     *  "Agree, needs work" button. Paul 2026-06-21. */
    opts?: { needsWork?: boolean },
  ) => Promise<void>;
  /** Plain "agree" — patch the disposition to accepted without any
   *  draft mutation. Used by the no-actionable-delta + actionable-
   *  severity case where the auditor flagged something the per-row
   *  comparator can't surface (e.g. ``wrong_fv_partition``): the
   *  curator can't pick a row to take, but they can acknowledge the
   *  finding. Optional — undefined hides the Agree button. */
  onAgree?: () => void;
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
  // Inline Reject-with-reason prompt — Reject requires a reason
  // (Paul 2026-05-25: "reject and park should have a reason"),
  // Agree is fire-and-forget without a notes prompt; Reject routes
  // through ``onDismiss`` → ``DismissDialog`` chip picker with the
  // per-issue-code chip set from ``dispositionChips.dismissChipsFor``;
  // Park routes through ``onPark`` → ``NotSureDialog``. The earlier
  // ``rejectPromptOpen`` / ``InlineNotesPrompt`` path was a bare
  // notes textarea that bypassed the chip taxonomy — removed
  // 2026-06-15 per Paul: "make sure there is a _uniform_ place those
  // are coded but the choices might differ based on the situation."
  // dispositionChips.ts IS that uniform place.
  // Free-text term lookup state (``findTermLabel`` + ``resolvedTerms``
  // + ``FreeTextLookup`` picker) removed 2026-06-15 — Paul: "I would
  // prefer not to even enable editing of free text. They would have
  // to accept it first, then they can edit in the usual place. For
  // now, proposal pane has no editing." Re-introduce if a
  // proposal-side editing affordance gets designed.
  // Editor-scoped term renderer — local declaration removed
  // 2026-06-15 in favour of the canonical ``termRenderer`` from
  // ``@/components/ui/Term``. Every ``FvDisplayRow`` call below now
  // plugs in the shared renderer so this surface's chips render
  // identically to the comparison grid / audit cards. Paul: "make
  // ALL surfaces use a single Term component."

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

  // Tag-add finding (``calibration_agent_extra``) — agent proposes a
  // NEW tag the gold doesn't have. Same workflow shape as
  // factor-add: Apply-only action with an optional-notes prompt;
  // Park stays; Dismiss + "don't add" are gone. The actual
  // mutation runs through the ApplyAction registry in
  // ``applyHandlers.ts`` (``resolveCalibrationApply`` → adds the
  // tag); the editor's per-row details-edit path is a no-op for
  // tag findings (``applyDetailsEditsToDesign`` is factor-only).
  //
  // Match-downgrade: a ``calibration_match`` viewed against a baseline
  // that lacks the tag reads as a tag-add — same render path
  // (``hideDismiss`` cleared so the [Add, Don't add] pair shows up
  // instead of the no-affordance ``[Agree only]`` row the bare match
  // code rendered). Per MATCH_DOWNGRADE_ACTION_HANDOFF, 2026-06-16.
  const isTagAddFinding =
    finding.target_kind === "tag" &&
    (finding.issue_code === "calibration_agent_extra" ||
      (finding.issue_code === "calibration_match" &&
        findingDisplayedGoldEmpty(finding, design) === true));

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
  // Match-downgrade signal: when the curator's displayed gold
  // baseline doesn't carry the entity even though the audit-time
  // baseline did, a ``*_match`` finding's action shape downgrades to
  // ``"add"`` — the row becomes [Agree, Don't add] and the apply path
  // routes through the add mutator. Mirrors the title downgrade in
  // ``findingCard.tsx`` (``goldEmptyForTitle``). Per
  // MATCH_DOWNGRADE_ACTION_HANDOFF, 2026-06-16.
  const displayedGoldEmpty =
    findingDisplayedGoldEmpty(finding, design) === true;
  const actionShape = findingActionShape(finding, {
    goldEmpty: displayedGoldEmpty,
  });
  const actionLbls = actionLabels(actionShape);

  function setPick(path: string, patch: Partial<RowState>): void {
    setRowState((prev) => {
      const next = new Map(prev);
      const base = next.get(path) ?? freshRowState();
      next.set(path, { ...base, ...patch });
      return next;
    });
  }

  async function dispatchSave(
    verdict: "proposal" | "currently" | "reference",
    notes?: string,
    /** Record the accept as "agreed, needs work" (resolved_at null)
     *  rather than resolved. Threaded straight through to onSave. */
    needsWork?: boolean,
  ) {
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
      await onSave(fix, structureOk, detailsOk, notes, { needsWork });
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
  // "Auditor says everything is exactly right" — hide ALL action
  // affordances (no Keep, no Adopt, no Agree, no Dismiss, no Park).
  // Per Paul 2026-05-25: "if the auditor says something is exactly
  // right then there should be no Dismiss or Accept; it's the stuff
  // the auditor doesn't like that we need to look at." Note this
  // is NARROWER than ``isCloseFactorMatch`` — close / near matches
  // still need the curator's eyes (URI variant, FV-count drift),
  // so they keep their buttons even when the per-row diff is empty.
  // Match-downgrade exception: a ``*_match`` finding viewed against
  // an empty displayed gold baseline is NOT "exactly right" — the
  // curator's action is to add the entity. The action-row collapse
  // to ``[Agree]`` only is wrong; the editor must render the
  // [Agree, Don't add] pair. ``displayedGoldEmpty`` is already
  // computed below for ``actionShape``. Per
  // MATCH_DOWNGRADE_ACTION_HANDOFF, 2026-06-16.
  const auditorSaysExactlyRightRaw =
    finding.severity === "ok" ||
    isExactFactorMatch(finding) ||
    finding.issue_code === "calibration_factor_match_exact" ||
    (finding.target_kind === "tag" &&
      finding.issue_code === "calibration_match" &&
      disagreementRows.length === 0);
  const auditorSaysExactlyRight =
    auditorSaysExactlyRightRaw &&
    findingDisplayedGoldEmpty(finding, design) !== true;

  // Partition-mismatch findings — agent and gold disagree on the
  // partition shape of a same-label factor along a clean
  // finer/coarser axis. One card, two primary buttons (adopt
  // agent's view / keep gold's view). No per-row disagreement
  // model — the payload carries an FV-level nesting map that
  // renders as a parent→children table.
  if (isPartitionMismatch) {
    const pm = finding.partition_mismatch!;
    // Cross-cutting partition_mismatch — the agent's factor
    // partitions samples along an axis that cross-cuts multiple gold
    // factors of the same category. Neither finer nor coarser; the
    // ``fv_pairs`` list is intentionally empty and the per-FV
    // overlap evidence lives in ``cross_cutting_overlaps``. This
    // branch ships ahead of Paul speccing the verb/action labels —
    // the actions are stubbed disabled with a TODO note so curators
    // see the right shape now (instead of the broken 0-level
    // fallthrough flagged on GSE79061) and we can drop the
    // affordance in without touching the card body again. */
    if (pm.direction === "cross_cutting") {
      const ccGolds = pm.cross_cutting_golds ?? [];
      const ccOverlaps = pm.cross_cutting_overlaps ?? [];
      const categoryLabel =
        pm.agent.category.label ||
        pm.gold.category.label ||
        finding.target_id;
      // Degenerate "cross-cutting" — only ONE gold factor spanned.
      // This isn't actually cross-cutting; the agent classified it
      // ``cross_cutting`` because no FV pair hit Jaccard ≥ 0.8, but
      // there's still just one gold factor in scope. Treat as a
      // regular partition_mismatch (adopt-shaped action), drop the
      // misleading "spans multiple" copy. Paul 2026-06-14 (GSE448).
      const isDegenerate = ccGolds.length <= 1;

      // Same partition, different term — NOT a partition disagreement.
      // Every FV lines up 1:1 on identical sample sets (Jaccard 1.0);
      // the only difference is which near-synonym term names the group
      // (GSE35977 disease: ``depressive disorder`` MONDO:0002050 ↔
      // ``depression`` MONDO:0012048). Render a quiet term-diff card —
      // no orange ⚠, no "combined partition" framing, and the actions
      // are a TERM choice (keep current term / adopt proposed term),
      // not a partition adjudication. Reserve the heavy cross-cutting
      // treatment below for genuine structural mismatches.
      if (isSamePartitionTermDiff(finding)) {
        // Pick the row whose terms actually differ for the headline /
        // button labels; fall back to the first row.
        const diffRow =
          ccOverlaps.find(
            (r) =>
              (r.gold_fv?.uri ?? r.gold_fv?.label) !==
              (r.agent_fv?.uri ?? r.agent_fv?.label),
          ) ?? ccOverlaps[0];
        const goldTerm = diffRow?.gold_fv?.label || "current term";
        const agentTerm = diffRow?.agent_fv?.label || "proposed term";
        // Share an ontology → factual "same ontology" chip (we don't
        // have ontology-distance data, so we don't over-claim "sibling"
        // / "subclass"). Prefix = the alpha ontology token in an OBO
        // PURL (``…/obo/MONDO_0002050`` → ``MONDO``) or a CURIE prefix.
        const ontoPrefix = (uri?: string | null): string | null => {
          if (!uri) return null;
          const obo = uri.match(/\/obo\/([A-Za-z]+)_/);
          if (obo) return obo[1].toUpperCase();
          const curie = uri.match(/^([A-Za-z]+):/);
          return curie ? curie[1].toUpperCase() : null;
        };
        const gp = ontoPrefix(diffRow?.gold_fv?.uri);
        const ap = ontoPrefix(diffRow?.agent_fv?.uri);
        const sameOntology = gp != null && ap != null && gp === ap;
        return (
          <div className="space-y-3 rounded border border-slate-300 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800">
            {/* Title row — quiet slate, no amber warning. */}
            <div className="flex items-baseline flex-wrap gap-2 text-[12px]">
              <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
                Factor
              </span>
              <span className="font-mono text-slate-800 dark:text-slate-100">
                {categoryLabel}
              </span>
              <span className="text-slate-400 dark:text-slate-500">·</span>
              <span className="text-slate-600 dark:text-slate-300">
                same partition — term difference only
              </span>
              {sameOntology ? (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                  same ontology ({gp})
                </span>
              ) : null}
            </div>

            {/* Term diff front and centre — current ↔ proposed, with the
                identical-sample-set count so the curator sees the
                grouping matches. */}
            <div className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-900/40">
              <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
                Same samples, different term
              </div>
              <div className="grid grid-cols-[auto_1fr_auto_1fr] gap-x-2 gap-y-1 text-[11px] items-baseline">
                {ccOverlaps.map((row, ri) => (
                  <Fragment key={ri}>
                    <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      {identities.goldCurator}
                    </span>
                    <Term
                      uri={row.gold_fv?.uri ?? null}
                      asLink={false}
                      className="!whitespace-normal break-words"
                    >
                      {row.gold_fv?.label || "(unnamed)"}
                    </Term>
                    <span
                      className="text-slate-400 dark:text-slate-500"
                      aria-hidden
                    >
                      ↔
                    </span>
                    <span className="flex items-baseline gap-1.5 min-w-0">
                      <Term
                        uri={row.agent_fv?.uri ?? null}
                        asLink={false}
                        className="!whitespace-normal break-words"
                      >
                        {row.agent_fv?.label || "(unnamed)"}
                      </Term>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 tabular-nums whitespace-nowrap">
                        {row.n_overlap} sample{row.n_overlap === 1 ? "" : "s"},
                        identical set
                      </span>
                    </span>
                  </Fragment>
                ))}
              </div>
            </div>

            {/* Action row — a TERM choice, not a partition choice. Keep
                the existing dispatchSave paths: "currently" keeps the
                current term, "proposal" adopts the proposed one. The
                shared Dismiss/Park escape hatches stay (a curator who
                judges the two interchangeable can dismiss as
                equivalent). */}
            <ActionRow
              saving={saving}
              disabled={false}
              buttons={[
                {
                  key: "keep",
                  kind: "primary-keep",
                  label: `Keep "${goldTerm}"`,
                  onClick: () => dispatchSave("currently"),
                  title: `Keep the current term (${goldTerm}); the sample grouping is unchanged either way.`,
                },
                {
                  key: "accept",
                  kind: "primary-accept",
                  label: `Adopt "${agentTerm}"`,
                  onClick: () => dispatchSave("proposal"),
                  title: `Relabel to ${identities.proposer}'s term (${agentTerm}); the sample grouping is unchanged either way.`,
                },
              ]}
              onDismiss={onDismiss}
              onPark={onPark}
              onResolve={isParked ? onResolve : undefined}
              onUndo={
                currentDisposition !== "pending" ? onUndo : undefined
              }
            />
          </div>
        );
      }

      return (
        <div className="space-y-3 rounded border border-slate-300 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800">
          {/* Title row. */}
          <div className="flex items-baseline flex-wrap gap-2 text-[12px]">
            <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
              Factor
            </span>
            <span className="font-mono text-slate-800 dark:text-slate-100">
              {categoryLabel}
            </span>
            <span className="text-slate-400 dark:text-slate-500">·</span>
            {/* Degenerate cross-cut with no overlap evidence: the card
                can't prove a disagreement OR call a single factor
                "cross-cutting", so drop the amber alarm for an honest,
                quiet "detail unavailable" line. Real disagreements
                (overlaps shipped) and genuine cross-cuts (≥2 factors)
                keep the amber warning. */}
            <span
              className={
                isDegenerate && ccOverlaps.length === 0
                  ? "text-slate-600 dark:text-slate-300"
                  : "text-amber-700 dark:text-amber-300"
              }
            >
              <strong>
                {isDegenerate
                  ? ccOverlaps.length === 0
                    ? "different partition proposed — no per-FV overlap detail shipped for this factor"
                    : `partition disagreement — no clean per-FV correspondence between ${identities.goldCurator} and ${identities.proposer}`
                  : `cross-cutting partition — ${identities.proposer}'s factor spans multiple ${identities.goldCurator} factors of the same category`}
              </strong>
            </span>
          </div>

          {/* Gold-factor list — the agent factor cross-cuts these N
              gold factors. Single-line chips matching the design-
              editor convention. */}
          {ccGolds.length > 0 ? (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
                {identities.goldCurator} factors spanned ({ccGolds.length})
              </div>
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {ccGolds.map((g, gi) => (
                  <Term
                    key={gi}
                    uri={g.category?.uri ?? null}
                    asLink={false}
                    className="!whitespace-normal break-words"
                  >
                    {capitalizeCategory(g.category?.label) || `factor ${gi + 1}`}
                  </Term>
                ))}
              </div>
            </div>
          ) : null}

          {/* Per-FV overlap rows — agent FV ↔ gold factor's FV with
              Jaccard ≥ 0.8. Tabular so curators can scan the
              "agent's X covers gold-A's X1 + gold-B's X2" pattern at
              a glance. */}
          {ccOverlaps.length > 0 ? (
            <div className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-900/40">
              <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
                FV-level overlaps (Jaccard ≥ 0.8)
              </div>
              <div className="grid grid-cols-[1fr_auto_1fr_auto_auto] gap-x-2 gap-y-1 text-[11px] items-baseline">
                <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500">
                  {identities.goldCurator}
                </div>
                <div />
                <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500">
                  {identities.proposer}
                </div>
                <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500 text-right">
                  Jaccard
                </div>
                <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500 text-right">
                  n
                </div>
                {ccOverlaps.map((row, ri) => (
                  <Fragment key={ri}>
                    <div className="flex items-baseline gap-1 min-w-0">
                      <Term
                        uri={row.gold_fv?.uri ?? null}
                        asLink={false}
                        className="!whitespace-normal break-words"
                      >
                        {row.gold_fv?.label || "(unnamed)"}
                      </Term>
                      <span className="text-slate-400 dark:text-slate-500 text-[10px] truncate">
                        · {capitalizeCategory(row.gold_factor?.category?.label)}
                      </span>
                    </div>
                    <span
                      className="text-slate-400 dark:text-slate-500"
                      aria-hidden
                    >
                      ↔
                    </span>
                    <div className="min-w-0">
                      <Term
                        uri={row.agent_fv?.uri ?? null}
                        asLink={false}
                        className="!whitespace-normal break-words"
                      >
                        {row.agent_fv?.label || "(unnamed)"}
                      </Term>
                    </div>
                    <div className="text-right tabular-nums text-slate-600 dark:text-slate-300">
                      {row.jaccard.toFixed(2)}
                    </div>
                    <div className="text-right tabular-nums text-slate-500 dark:text-slate-400 text-[10px]">
                      {row.n_overlap}/{row.n_gold} ∩ {row.n_agent}
                    </div>
                  </Fragment>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-[11px] italic text-slate-500 dark:text-slate-400">
              {isDegenerate
                ? `No per-FV sample overlap was shipped for this factor, so the specific value-level differences can't be shown here. Review the factor side-by-side in the Design tab, or keep the current design.`
                : `No FV-level overlaps shipped — the partition is genuinely cross-cutting with no clean per-FV correspondence.`}
            </div>
          )}

          {/* Action row. Degenerate cross-cutting (single gold
              spanned) routes through the same partition_mismatch
              adopt path the agent_finer / agent_coarser variants
              use — ``applyHandlers.resolveFactorCalibrationApply``
              picks up the ``calibration_factor_partition_mismatch``
              issue_code and runs ``adoptNearMatchAgentFactor`` on
              accept.

              For TRUE cross-cutting (multiple golds spanned) only the
              ADOPT button is disabled — adopting the auditor's shape
              means merging multiple existing same-category factors into
              one, an unspecced design mutation with no handler yet.
              KEEP stays enabled: keeping the current design unchanged is
              always safe (it records "keep current" via the same
              ``dispatchSave("currently")`` path the other partition
              variants use, with no fix to apply), and the curator must
              never be left with zero usable controls (Paul 2026-06-19,
              experiment 2828 — the two spanned factors there are both
              ``treatment``/``EFO:0000727``, a split factor the auditor
              wants to merge). */}
          <ActionRow
            saving={saving}
            disabled={false}
            buttons={[
              {
                key: "keep",
                kind: "primary-keep",
                label: isDegenerate
                  ? `Keep ${identities.goldCurator}'s partition`
                  : "Keep",
                onClick: () => dispatchSave("currently"),
                title: isDegenerate
                  ? `Reject ${identities.proposer}'s repartition; keep the existing factor as-is.`
                  : `Reject ${identities.proposer}'s merge; keep the current design as-is.`,
              },
              {
                key: "accept",
                kind: "primary-accept",
                label: isDegenerate
                  ? `Adopt ${identities.proposer}'s partition`
                  : `Adopt ${identities.proposer}'s cross-cutting shape`,
                onClick: () => dispatchSave("proposal"),
                disabled: !isDegenerate,
                title: isDegenerate
                  ? `Replace the existing factor's FV breakdown with ${identities.proposer}'s.`
                  : "Adopt affordance pending — merging the spanned same-category factors into one isn't a safe one-click action yet. Use Keep, or Reject.",
              },
            ]}
            onDismiss={onDismiss}
            onPark={onPark}
            onNeedsWork={() => dispatchSave("proposal", undefined, true)}
            onResolve={isParked ? onResolve : undefined}
            onUndo={
              currentDisposition !== "pending" ? onUndo : undefined
            }
          />
        </div>
      );
    }
    const isAgentFiner = pm.direction === "agent_finer";
    const agentVerb = "says";
    const goldVerb = currentlyVerb(identities.goldCurator);
    // 1:1 detection — when every parent has exactly one child the
    // agent's "finer/fewer" direction tag is a misclassification.
    // Frame as label drift. Group by the umbrella side (gold for
    // agent_finer; agent for agent_coarser); 1:1 means every group
    // has exactly one entry.
    const umbrellaKeyForPair = (
      p: typeof pm.fv_pairs[number],
    ): string =>
      isAgentFiner
        ? `${p.gold.label}|${p.gold.uri ?? ""}`
        : `${p.agent.label}|${p.agent.uri ?? ""}`;
    const umbrellaCounts = (() => {
      const m = new Map<string, number>();
      for (const p of pm.fv_pairs) {
        const k = umbrellaKeyForPair(p);
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return m;
    })();
    const distinctUmbrellaCount = umbrellaCounts.size;
    const is1to1 =
      pm.fv_pairs.length > 0 &&
      distinctUmbrellaCount === pm.fv_pairs.length;
    // Counts for the headline summary. Auditor (agent) side count
    // = distinct agent FVs; current (gold) side count = distinct
    // gold FVs. Computed independently of umbrella direction so the
    // "Auditor says N levels / Current says M levels" headline
    // reads consistently.
    const distinctAgentCount = new Set(
      pm.fv_pairs.map((p) => `${p.agent.label}|${p.agent.uri ?? ""}`),
    ).size;
    const distinctGoldCount = new Set(
      pm.fv_pairs.map((p) => `${p.gold.label}|${p.gold.uri ?? ""}`),
    ).size;
    const directionPhrase = is1to1
      ? "different labels (same partition)"
      : isAgentFiner
        ? "finer levels"
        : "fewer levels";
    // partition_mismatch is a `change` shape (FV reorg within an
    // existing factor). The "keep" reads "don't change"; the
    // "accept" reads "adopt <proposer>'s <directionPhrase>" so the
    // curator still sees WHICH direction they're adopting.
    const keepLabel = actionLbls.keep;
    // Partition-mismatch is always a "change" shape so the
    // possessive form ("adopt Auditor's …") reads correctly. We
    // append the direction phrase by hand here rather than going
    // through acceptLabel() because the directional cue belongs
    // only on this specific finding type.
    const acceptButtonLabel = is1to1
      ? `${actionLbls.adopt} ${identities.proposer}'s labels`
      : `${actionLbls.adopt} ${identities.proposer}'s ${directionPhrase}`;
    const acceptTitle = is1to1
      ? `Use ${identities.proposer}'s FV labels — the partition (sample groupings) is identical, only the level names differ.`
      : isAgentFiner
        ? `Use the finer factor-value partition ${identities.proposer} proposed.`
        : `Use the simpler factor-value partition ${identities.proposer} proposed.`;
    return (
      <div className="space-y-3 rounded border border-slate-300 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800">
        {/* Title row — matches the factor-card title shape. */}
        <div className="flex items-baseline flex-wrap gap-2 text-[12px]">
          <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
            Factor
          </span>
          <span className="font-mono text-slate-800 dark:text-slate-100">
            {capitalizeCategory(pm.gold.category.label) || capitalizeCategory(pm.agent.category.label) || finding.target_id}
          </span>
          <span className="text-slate-400 dark:text-slate-500">·</span>
          <span className="text-amber-700 dark:text-amber-300">
            <strong>
              {is1to1
                ? `label drift — ${identities.proposer} proposes ${directionPhrase}`
                : `partition mismatch — ${identities.proposer} proposes ${directionPhrase}`}
            </strong>
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
        {/* Horizontal, mirroring the CURRENT | AUDITOR columns of the
            grid below (Current LEFT, Auditor RIGHT) so the level-count
            asymmetry reads at a glance and lines up with the panes.
            Per Paul 2026-06-21: horizontal beats the old vertical
            stack (which also listed Auditor first, reversed vs the
            columns). */}
        <div className="grid grid-cols-2 gap-x-3 items-baseline text-[11px]">
          {/* LEFT = Current (gold) */}
          <span className="flex items-baseline gap-x-1.5">
            <strong className="text-slate-600 dark:text-slate-300">
              {identities.goldCurator}
            </strong>
            {goldVerb ? (
              <span className="text-slate-600 dark:text-slate-300">{goldVerb}</span>
            ) : null}
            <button
              type="button"
              onClick={onLocateCurrent}
              title={locateTooltipFor(finding.target_id)}
              aria-label={locateTooltipFor(finding.target_id)}
              className="align-baseline text-[11px] text-slate-400 hover:text-sky-700 dark:text-slate-500 dark:hover:text-sky-300"
            >
              🔍
            </button>
            <span className="text-xl font-bold text-slate-700 dark:text-slate-200 leading-none">
              {distinctGoldCount}
            </span>
            <span className="text-slate-600 dark:text-slate-300">levels</span>
          </span>
          {/* RIGHT = Auditor (proposer) */}
          <span className="flex items-baseline gap-x-1.5">
            <strong className="text-slate-600 dark:text-slate-300">
              {identities.proposer}
            </strong>
            {agentVerb ? (
              <span className="text-slate-600 dark:text-slate-300">{agentVerb}</span>
            ) : null}
            <span className="text-xl font-bold text-amber-700 dark:text-amber-300 leading-none">
              {distinctAgentCount}
            </span>
            <span className="text-slate-600 dark:text-slate-300">levels</span>
          </span>
        </div>

        {/* FV mapping — SAME FactorComparisonGrid used by the
            factor-match card. ONE shared component for every
            factor-side comparison; partition_mismatch is just a
            different fill of the same pairs slot. Paul 2026-06-16:
            "I want ONE component for factors and ONE component for
            TAGS." Cost of unification: when the partition is M:1
            (agent_coarser) the agent FV label repeats across each
            gold child row instead of rowspanning — accepted. */}
        {pm.fv_pairs.length > 0 ? (
          <FactorComparisonGrid
            leftHeader={{
              label: identities.goldCurator,
              category: {
                label: pm.gold.category.label ?? null,
                uri: pm.gold.category.uri ?? null,
              },
            }}
            rightHeader={{
              label: identities.proposer,
              category: {
                label: pm.agent.category.label ?? null,
                uri: pm.agent.category.uri ?? null,
              },
            }}
            pairs={buildPartitionMismatchPairs({
              direction: pm.direction,
              fvPairs: pm.fv_pairs.map((p) => ({
                agent: { label: p.agent.label, uri: p.agent.uri ?? null },
                gold: { label: p.gold.label, uri: p.gold.uri ?? null },
                agent_statement: p.agent_statement,
                gold_statement: p.gold_statement,
                agent_biomaterial_short_names:
                  p.agent_biomaterial_short_names ?? null,
                gold_biomaterial_short_names:
                  p.gold_biomaterial_short_names ?? null,
              })),
              project: (term, stmt, samples) =>
                _fvDisplayFromMapping(
                  term,
                  stmt as StatementParts | null,
                  samples,
                ) as FactorComparisonPair["left"],
            })}
            termRenderer={termRenderer}
            onLeftLocate={onLocateCurrent}
          />
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
              label: acceptButtonLabel,
              onClick: () => dispatchSave("proposal"),
              title: acceptTitle,
            },
          ]}
          onDismiss={onDismiss}
          onPark={onPark}
          onNeedsWork={() => dispatchSave("proposal", undefined, true)}
          onResolve={isParked ? onResolve : undefined}
          onUndo={
            currentDisposition !== "pending" ? onUndo : undefined
          }
        />
      </div>
    );
  }

  // Factor-extra findings — agent proposes a NEW factor that
  // gold doesn't have. The whole card is one decision (apply or
  // not), so the per-row "Current: no entry / keep / adopt /
  // edit" repetition is just noise.
  //
  // Action shape (per Paul 2026-05-25):
  //   - "Add Auditor's factor" — applies the mutation; opens a
  //     small optional-explanation prompt first so the curator
  //     can record WHY (the explanation rides on the disposition
  //     PATCH and goes back to the curation agent at close-
  //     review time).
  //   - "Park…" — defer; same dialog as elsewhere.
  //   - Dismiss + "don't add" are gone — both meant "I don't
  //     want this", which is what the close-review summary
  //     records implicitly for any finding the curator didn't
  //     apply. Keeping them was redundant + confusing.
  if (isFactorExtraFinding) {
    const cp = report?.evidence?.comparison_proposal ?? null;
    const labelHint = firstBacktick(finding.rationale);
    // Prefer the finding's own add-factor payload so multi-same-
    // category panels (GSE225864 ``genotype``: A152T / KO / P301S)
    // render each card's true FVs instead of collapsing onto the
    // first ``genotype`` factor via the label fallback. See
    // factorProposalFromApplyAction.
    const agentFactor =
      factorProposalFromApplyAction(finding) ??
      resolveAgentFactor(finding, cp, labelHint);
    const categoryLabel =
      agentFactor?.category?.label || labelHint || "";
    const categoryUri = agentFactor?.category?.uri ?? null;
    const fvs = agentFactor?.factor_values ?? [];
    // The draft mutation is owned by the parent's onSave structural-
    // only branch (AuditSidebarPanel) — it runs ``action.mutate`` =
    // ``addFactorFromProposal`` via the same ``ApplyAction`` the
    // legacy compact-card path uses, which carries the name-clash
    // confirmation gate (commit 8b1d747) + the alreadyApplied
    // idempotency check. Doing the apply here too caused a single
    // Agree click to append the factor twice (found 2026-06-06 on
    // GSE319683/91664 + ticket 21: ``calibration:factor_extra:
    // stimulation`` added two stimulation factors).
    const runApply = (notes: string, needsWork?: boolean) => {
      dispatchSave("proposal", notes.trim() || undefined, needsWork);
    };
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

        {/* FreeTextLookup mount removed 2026-06-15 with the rest of
            the free-text edit affordance. See state-declaration
            comment above. */}

        {/* Continuous-mode swap: a continuous factor's FVs are
            per-measurement (one FV per unique numeric reading), so
            rendering each as its own labelled row produces a vertical
            list of 20+ identical-looking rows — useless for grokking
            the distribution. Render the ContinuousStrip rug instead
            so the curator sees the value distribution + range at a
            glance. Left lane stays empty (this is ADD FACTOR — no
            current side); the strip's axis builds from the agent's
            values alone. Paul 2026-06-14: "this should display the
            factor using the plot like before — not a long list." */}
        {fvs.length > 0 ? (
          (() => {
            const factorType = (
              agentFactor as { factor_type?: string } | null
            )?.factor_type;
            const isContinuous =
              factorType === "continuous" ||
              (fvs.length >= 3 &&
                fvs.every(
                  (fv) =>
                    (fv as { numeric_value?: number | null }).numeric_value !=
                    null,
                ));
            if (isContinuous) {
              const right = continuousValuesFrom(
                fvs as Parameters<typeof continuousValuesFrom>[0],
              );
              return (
                <ContinuousStrip
                  left={[]}
                  right={right}
                  leftLabel="—"
                  rightLabel={identities.proposer.toLowerCase()}
                />
              );
            }
            return (
              <div className="space-y-1.5">
                {fvs.map((fv, i) => (
                  <FvDisplayRow
                    key={i}
                    fv={fv}
                    termRenderer={termRenderer}
                    indexLabel={i + 1}
                  />
                ))}
              </div>
            );
          })()
        ) : null}

        {(
          <ActionRow
            saving={saving}
            disabled={currentDisposition !== "pending"}
            buttons={[
              {
                key: "accept",
                kind: "primary-accept" as const,
                label: "Agree",
                // Agree is fire-and-forget — no notes prompt. Per
                // Paul 2026-05-25: "just agree". Reject opens the
                // shared DismissDialog chip picker via onDismiss —
                // chips come from ``dispositionChips.dismissChipsFor``
                // (CAL_EXTRA_FACTOR_DISMISS_CHIPS for factor-extra:
                // "Already covered" / "Wrong shape" / "FVs wrong" / …).
                onClick: () => runApply(""),
                title: `Agree with ${identities.proposer}: add the proposed factor to the design.`,
              } satisfies ActionButton,
              {
                key: "reject",
                kind: "secondary" as const,
                label: "Reject…",
                onClick: onDismiss,
                title:
                  "Reject with a reason chip (Already covered / Wrong shape / FVs wrong / Other) — goes back to the curation agent at close-review time.",
              } satisfies ActionButton,
            ]}
            onDismiss={onDismiss}
            onPark={onPark}
            onNeedsWork={() => runApply("", true)}
            onResolve={isParked ? onResolve : undefined}
            onUndo={
              currentDisposition !== "pending" ? onUndo : undefined
            }
            hideDismiss
          />
        )}
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
    // Gold-side FVs render via the shared FvDisplayRow per FV. That
    // gives us multi-statement stacking (head + indented rest sublines)
    // out of the box — earlier shape collected only `statements[0]` into
    // an intermediate `removalFvRows` array and rendered inline, which
    // silently dropped statements[1:] for combined-treatment / multi-
    // statement FVs.
    const removalFvList =
      goldFactor && goldFactor.factor_values.length > 0
        ? goldFactor.factor_values
        : null;
    // The tag/factor being voted on. For tags it's a single
    // category:value chip; for factor removals it's the category
    // name (the per-FV detail isn't surfaced — the decision is
    // binary). The proposer's row shows nothing (their proposal
    // IS removal); the gold curator's row shows what's there.
    const currentTermLabel = removeTargetLabel ?? "";
    // proposerVerb removed 2026-06-16 with the "Auditor says (proposes
    // removing — no entry)" placeholder line — see comment block in
    // the JSX below for context.
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
            with the same convention. Tight 5rem gutter (was 8rem) and
            the category chip sits inline next to "Current 🔍" so the
            FV chips below can fit on one line at 11px. */}
        <div className="space-y-1">
          {/* Auditor's "(proposes removing — no entry)" line removed
              2026-06-16 — placeholder anti-pattern flagged by Paul.
              The card header ("REMOVE TAG") and the body's "removal
              proposed" tag already convey the auditor's ask; a
              labeled empty-state row added noise. Per the
              three-phase spec: omit empty sections, never render
              "(no entry)" placeholders. */}
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px]">
            <span className="text-slate-600 dark:text-slate-300 whitespace-nowrap">
              <strong>{identities.goldCurator}</strong>
              {goldVerb ? ` ${goldVerb}` : null}
              <button
                type="button"
                onClick={onLocateCurrent}
                title={locateTooltipFor(finding.target_id)}
                aria-label={locateTooltipFor(finding.target_id)}
                className="ml-1 align-baseline text-[10px] text-slate-400 hover:text-sky-700 dark:text-slate-500 dark:hover:text-sky-300"
              >
                🔍
              </button>
            </span>
            <span className="flex items-baseline gap-x-1.5">
              {goldTagParts ? (
                // Tag removal — render category + value as two
                // separate ontology chips so each can resolve to
                // its own term.
                <>
                  <Term
                    uri={goldTagParts.category.uri}
                    asLink={false}
                    className="!whitespace-nowrap"
                  >
                    {capitalizeCategory(goldTagParts.category.label)}
                  </Term>
                  <span className="text-slate-400 dark:text-slate-500">
                    :
                  </span>
                  <Term
                    uri={goldTagParts.value.uri}
                    asLink={false}
                    className="!whitespace-nowrap"
                  >
                    {goldTagParts.value.label}
                  </Term>
                </>
              ) : currentTermLabel ? (
                <Term
                  uri={categoryUri}
                  asLink={false}
                  className="!whitespace-nowrap"
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

          {/* Per-FV cards for the gold side — one card per factor
              value, matching the per-FV cell the comparison grid uses
              (FactorComparisonGrid), so a removal card reads the same
              as a comparison card instead of a flat run of rows that
              jumble together for multi-statement / combined-treatment
              FVs. Each card still renders via the shared FvDisplayRow
              (Subj · Pred · Obj head + indented sublines). */}
          {removalFvList && removalFvList.length > 0 ? (
            <div className="pl-3 space-y-1.5">
              {removalFvList.map((fv) => (
                <div
                  key={fv.id}
                  className="rounded border border-slate-200 bg-slate-50/60 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900/40"
                >
                  <FvDisplayRow fv={fv} termRenderer={termRenderer} />
                </div>
              ))}
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
              // Reject-the-removal opens the shared DismissDialog chip
              // picker via onDismiss — chips come from
              // ``dispositionChips.dismissChipsFor`` (CAL_MISS_DISMISS_CHIPS
              // for removal findings: "Factor needed" / "Structure
              // correct, FVs wrong" / "Wrong partition" / "Missed
              // evidence" / …). Paul 2026-06-15: REMOVE TAG cards had
              // no disposition prompt at all — fire-and-forget on Keep
              // dropped the curator's reason on the floor.
              onClick: onDismiss,
              title: `Reject ${identities.proposer}'s removal with a reason chip.`,
            },
            {
              key: "remove",
              kind: leanKinds.accept,
              label: acceptLabel(actionShape, identities.proposer),
              // Accept-the-removal opens the shared accept chip
              // picker via onAgree — chips come from
              // ``dispositionChips.acceptChipsFor`` (CAL_MISS_ACCEPT_CHIPS
              // for removal findings: "Gold wrong" / "Borderline" /
              // "Other"). Paul 2026-06-15: a destructive action
              // (actually drops the tag/factor from the draft)
              // deserves a reason prompt; fire-and-forget on the
              // green button was wrong here.
              onClick: onAgree ?? (() => dispatchSave("proposal")),
              title: `Accept ${identities.proposer}'s removal with a reason chip.`,
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
            {capitalizeCategory(factorCategoryLabel)}
          </span>
        </div>
      ) : null}

      {/* One-line summary of the auditor's take — what's agreed,
          what's contested — so the curator reads the headline
          before diving into the side-by-side. Generated from
          issue_code; renders only when we have a confident framing
          for the code. */}
      <FactorFindingSummaryLine finding={finding} />

      {/* Side-by-side "Current vs Auditor" mini-table for factor
          findings. Restores the at-a-glance comparison that used to
          live in the retired EXPERIMENTAL DESIGN block (per Paul
          2026-05-25). FV chips on each side show sample counts; an
          inline amber disc marks FVs the OTHER side doesn't have so
          partition / label drift is visible without expanding the
          comparator rows below. */}
      <CurrentVsAuditorFactor
        finding={finding}
        report={report}
        design={design}
      />

      {/* OK FV checks on this same factor render here as compact
          green chips — visual confirmation that the auditor walked
          each FV — instead of as detached sibling cards in the
          finding list. The list already suppresses them under
          flagged factors; nesting here gives them a home so the
          curator sees the "FVs all OK" signal in context. */}
      <NestedOkFvConfirmations finding={finding} report={report} />

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
          locateTooltip={locateTooltipFor(finding.target_id)}
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

      {/* Catch-all explainer: any actionable severity that landed
          with no per-row delta the comparator could surface. Common
          for axes the row model can't capture — ``wrong_fv_partition``
          (FV count vs BM variety), ``conflated``, etc. Without this,
          the curator sees "Everyone agrees" next to a major-severity
          glyph and has no clue what the finding is about. */}
      {noActionableDelta &&
      finding.severity !== "ok" &&
      !isCloseFactorMatch(finding) &&
      !isExactFactorMatch(finding) &&
      finding.issue_code !== "calibration_match" &&
      // Suppress once the curator has decided — the explainer is for
      // helping the curator understand a "looks no-op but isn't"
      // finding before acting; after Agree/Reject lands it's noise,
      // and on ADD TAG cards it surfaces as an amber wrapper because
      // accepting moves the tag into the draft and the row matcher
      // (rightly) sees both sides agreeing. Paul 2026-06-15: "why
      // does 'agree' leave this amber-coloured thing?"
      currentDisposition === "pending" ? (
        <ActionableNoDeltaExplainer finding={finding} />
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
            locateTooltip={locateTooltipFor(finding.target_id)}
            editCategory={firstBacktick(finding.rationale) ?? null}
            leanKinds={leanKinds}
            actionLbls={actionLbls}
            actionShape={actionShape}
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
          Dismiss/Park. Per Paul 2026-05-21.
          Tag-add findings use the same Apply-only treatment as
          factor-add: an inline optional-notes prompt replaces the
          action row while the curator decides; Dismiss + "keep"
          are dropped (non-application records itself via the
          close-review summary). Per Paul 2026-05-25. */}
      {(
      <ActionRow
        saving={saving}
        disabled={currentDisposition !== "pending"}
        buttons={
          auditorSaysExactlyRight
            ? // Auditor says exactly right — the curator's verdict is
              // still a real disposition (accept / reject / park).
              // Per Paul 2026-06-11 on TAG MATCH cards: "should be
              // agree and reject" — the earlier "no buttons" branch
              // left curators with only Reject/Park, which felt
              // lopsided. Agree records acceptance without mutating
              // the draft (there's nothing to mutate on a match).
              [
                {
                  key: "agree",
                  kind: "primary-accept" as const,
                  label: "Agree",
                  onClick: () => dispatchSave("proposal"),
                  title:
                    `Agree with ${identities.proposer}: this is the right curation as-is.`,
                } satisfies ActionButton,
              ]
            : isTagAddFinding
              ? [
                  {
                    key: "accept",
                    kind: "primary-accept" as const,
                    label: "Agree",
                    // Agree fires immediately — no notes prompt
                    // (Paul 2026-05-25: "just agree"). Reject
                    // requires a reason via the prompt below.
                    onClick: () => dispatchSave("proposal"),
                    title: `Agree with ${identities.proposer}: add the proposed tag to the design.`,
                  } satisfies ActionButton,
                  {
                    key: "reject",
                    kind: "secondary" as const,
                    label: "Reject…",
                    // Reject opens the shared DismissDialog chip picker
                    // via onDismiss — chips come from
                    // ``dispositionChips.dismissChipsFor``
                    // (CAL_EXTRA_TAG_DISMISS_CHIPS for tag-add:
                    // "Subset only" / "No evidence" / "Redundant" /
                    // "Out of scope" / …). Paul 2026-06-15: a bare
                    // notes textarea here dropped the curator's
                    // structured reason on the floor — the chip set
                    // already existed in dispositionChips.ts and was
                    // routed by issue_code; the InlineNotesPrompt was
                    // just bypassing it.
                    onClick: onDismiss,
                    title:
                      "Reject with a reason chip (Subset only / No evidence / Redundant / Other) — goes back to the curation agent at close-review time.",
                  } satisfies ActionButton,
                ]
            : noActionableDelta
            ? // No per-row delta to act on, but the finding may still
              // be actionable (e.g. wrong_fv_partition, conflated).
              // Surface an Agree button so the curator can accept
              // the finding without mutating the draft.
              onAgree
                ? [
                    {
                      key: "agree",
                      kind: "primary-accept" as const,
                      label: "Agree",
                      onClick: onAgree,
                      title:
                        "Accept the finding without modifying the draft — the auditor flagged something the per-row comparator can't surface.",
                    } satisfies ActionButton,
                  ]
                : []
            : actionShape === "match"
              ? [
                  // Match findings: keep + adopt collapse to the same
                  // "confirm" verb (both sides already agree). Render
                  // ONE Confirm-all button instead of two identical
                  // ones — Paul 2026-06-11: "having 'confirm' and
                  // 'confirm' on every card is dumb." Acts as the
                  // factor-level "overall" the curator wants: fills
                  // any un-picked per-FV blocks with the same verdict.
                  {
                    key: "confirm",
                    kind: "primary-accept" as const,
                    label: "Confirm all",
                    onClick: () => dispatchSave("proposal"),
                    title:
                      `Confirm every FV — auditor's claim and current curation already agree. ` +
                      `Skips the per-FV walkthrough.`,
                  } satisfies ActionButton,
                ]
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
                  label: acceptLabel(actionShape, identities.proposer),
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
        // "Agree, needs work" makes sense wherever agreeing leaves
        // follow-up work to do. A pure MATCH / "exactly right" card
        // has nothing to apply (both sides already agree), so there's
        // no work to park — skip it there (mirrors findingCard's
        // ``noFollowUp`` auto-resolve). Everywhere else (add / adopt /
        // change / acknowledge), agreeing can leave cleanup pending.
        onNeedsWork={
          auditorSaysExactlyRight || actionShape === "match"
            ? undefined
            : () => dispatchSave("proposal", undefined, true)
        }
        onResolve={isParked ? onResolve : undefined}
        onUndo={currentDisposition !== "pending" ? onUndo : undefined}
        // Reject + Park stay available on every finding — including
        // exact matches and close matches. Paul 2026-06-11: "reject
        // should be an option, even if the proposal is 'close'." The
        // earlier gate ("nothing to dismiss") was wrong: the curator
        // may still disagree that the auditor's match assessment is
        // correct, and Reject is how they say so.
        showEscapeHatches={true}
        hideDismiss={isTagAddFinding}
      />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Subject-shared statement group used by AgreementSummary so multiple
 *  statements on the same subject ("APP has_genotype Overexpression"
 *  + "APP has_genotype V717F, KM670/671NL, E22G") collapse to one
 *  subject chip with the predicate/object pairs stacked beneath.
 *  Eye reads the subject ONCE, then walks the list. Per Paul
 *  2026-06-12 GSE93824 genotype walkthrough — the prior render
 *  repeated the subject on every line and made the inconsistent
 *  agent-side labelling (same URI, two different display strings)
 *  jump out as visual noise. */
function AgreementStatementGroup({
  subject,
  entries,
}: {
  subject: SideValue;
  entries: Array<{ predicate: SideValue; object: SideValue }>;
}) {
  if (!subject.label && entries.length === 0) return null;
  // CSS grid with three columns (subject / predicate / object) so
  // the predicates stack into a single visual column and the eye
  // can scan them. The subject column sizes to its widest content
  // (the row 0 chip), and ``⤷`` continuation rows occupy the same
  // column width, which is what makes the predicate column line up
  // vertically. Per Paul 2026-06-12: "you could make the
  // has_genotype align vertically."
  return (
    <span
      className="grid items-baseline gap-x-1.5 gap-y-0.5 min-w-0"
      style={{ gridTemplateColumns: "max-content max-content 1fr" }}
    >
      {entries.map((e, i) => (
        <Fragment key={`e-${i}`}>
          {/* Subject column. Row 0: the canonical subject chip.
              Row 1+: a small ⤷ glyph anchored to the subject column
              so the predicate column starts at the same x on every
              row. */}
          <span className="inline-flex items-baseline">
            {i === 0 ? (
              <Term
                uri={subject.uri ?? null}
                asLink={false}
                className="!whitespace-normal break-words"
              >
                {subject.label}
              </Term>
            ) : (
              <span
                className="text-slate-400 dark:text-slate-500 pl-1"
                aria-hidden
                title={subject.label}
              >
                ⤷
              </span>
            )}
          </span>
          {/* Predicate column — same vertical x across every row. */}
          <span className="inline-flex items-baseline">
            {e.predicate.label ? (
              <>
                <span
                  className="text-slate-400 dark:text-slate-500 mr-1"
                  aria-hidden
                >
                  -
                </span>
                <span
                  className="text-[10px] text-slate-500 dark:text-slate-200 font-mono"
                  title={e.predicate.uri || undefined}
                >
                  {e.predicate.label}
                </span>
                <span
                  className="text-slate-400 dark:text-slate-500 ml-1"
                  aria-hidden
                >
                  -
                </span>
              </>
            ) : null}
          </span>
          {/* Object column — fills the remaining width. */}
          <span className="inline-flex items-baseline flex-wrap min-w-0">
            {e.object.label ? (
              <Term
                uri={e.object.uri ?? null}
                asLink={false}
                className="!whitespace-normal break-words"
              >
                {e.object.label}
              </Term>
            ) : null}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

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
  if (fvIndices.length === 0 && factorRows.length === 0) return null;
  // Factor-level agreements (e.g. shared category) stay inline.
  const factorChips = factorRows.map(
    (r) => `${r.rowLabel.toLowerCase()} · ${r.proposal.label}`,
  );
  return (
    <div className="text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
      <div className="italic">
        <span className="text-emerald-600 dark:text-emerald-400 font-bold not-italic mr-1">
          ✓
        </span>
        Everyone agrees:
        {factorChips.length > 0 ? (
          <span className="ml-1">{factorChips.join(" · ")}</span>
        ) : null}
      </div>
      {/* Per-agreed-FV detail — Paul 2026-06-11: "all factor values
          should be shown — 'Everyone agrees: ... FV 2 (6)' is not
          good enough." Spell out the proposal labels for each agreed
          row so the curator sees the actual content of the FV they're
          not being asked to act on, not just the index. */}
      {fvIndices.length > 0 ? (
        <ul className="mt-0.5 pl-4 space-y-0.5">
          {fvIndices.map((idx) => {
            const meta = fvMeta.get(idx);
            const sampleHint = meta ? ` (${meta.agentSampleCount})` : "";
            const fvRows = byFv.get(idx) ?? [];
            const extras = meta?.goldExtraStatements ?? [];
            const subj = fvRows.find((r) => r.rowLabel === "Subject")
              ?.proposal;
            const pred = fvRows.find((r) => r.rowLabel === "Predicate")
              ?.proposal;
            const obj = fvRows.find((r) => r.rowLabel === "Object")?.proposal;
            // Collect every statement on this FV (primary + extras),
            // then group by subject URI/label so the eye can read
            // "subject X has predicates A, B, C" instead of repeating
            // the same subject chip every line. Paul 2026-06-12 on
            // GSE93824 genotype: "the label should be the same for the
            // same ontology term (gene) NCBI:gene:351, do you know
            // why it isn't?" Producer ships different display strings
            // ("APP" vs "APP [human] amyloid beta (A4) precursor
            // protein") for the same URI; collapsing them here picks
            // the SHORTER label as the visual stand-in so the
            // comparison reads cleanly. (Producer canonicalisation is
            // out for a separate handoff.)
            const allStatements: Array<{
              subject: SideValue;
              predicate: SideValue;
              object: SideValue;
            }> = [];
            if (subj?.label || pred?.label || obj?.label) {
              allStatements.push({
                subject: subj ?? { label: "", uri: null },
                predicate: pred ?? { label: "", uri: null },
                object: obj ?? { label: "", uri: null },
              });
            }
            for (const e of extras) allStatements.push(e);
            // Group by subject identity. Two statements share a group
            // when their subject URIs match (URI-first) or, when URIs
            // are absent on both sides, their lowercased labels match.
            type StmtGroup = {
              subject: SideValue;
              entries: Array<{ predicate: SideValue; object: SideValue }>;
            };
            const groups: StmtGroup[] = [];
            for (const s of allStatements) {
              const existing = groups.find((g) =>
                sameOntologyTerm(g.subject, s.subject),
              );
              if (existing) {
                // Same subject — prefer the shorter label (the canonical
                // short form is almost always the cleaner read).
                if (
                  s.subject.label &&
                  s.subject.label.length < existing.subject.label.length
                ) {
                  existing.subject = s.subject;
                }
                existing.entries.push({
                  predicate: s.predicate,
                  object: s.object,
                });
              } else {
                groups.push({
                  subject: s.subject,
                  entries: [{ predicate: s.predicate, object: s.object }],
                });
              }
            }
            return (
              <li key={idx} className="flex flex-col gap-y-0.5">
                {groups.map((g, gix) => (
                  <div
                    key={`g-${gix}`}
                    className={cn(
                      "flex items-baseline gap-x-1.5 flex-wrap",
                      gix > 0 && "pl-12",
                    )}
                  >
                    {gix === 0 ? (
                      <>
                        <span className="text-amber-700 dark:text-amber-400 font-semibold not-italic shrink-0">
                          FV {idx + 1}
                        </span>
                        <span className="text-slate-400 dark:text-slate-500 shrink-0">
                          {sampleHint}
                        </span>
                        <span className="text-slate-400 dark:text-slate-500 shrink-0">
                          ·
                        </span>
                      </>
                    ) : null}
                    <AgreementStatementGroup
                      subject={g.subject}
                      entries={g.entries}
                    />
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/** Compact "Current vs Auditor" comparison for factor findings.
 *
 *  Restores the at-a-glance comparison that used to live in the
 *  retired EXPERIMENTAL DESIGN block (Paul 2026-05-25). Aligns rows
 *  by normalised FV label so the curator's eye scans horizontally
 *  to spot drift; FV statements render via the shared
 *  ``<FvDisplayRow>`` so the familiar Subj · Pred · Obj layout +
 *  baseline glyph + sample-count appears in the same shape as the
 *  proposal-review and design surfaces.
 *
 *  Returns null for non-factor findings or when neither side has a
 *  match (e.g. an ``experiment``-scope finding). */
function CurrentVsAuditorFactor({
  finding,
  report,
  design,
}: {
  finding: AuditFinding;
  report: AuditReport | null;
  design: Design | null;
}) {
  if (finding.target_kind !== "factor") return null;
  const parsed = parseTargetId(finding.target_id);
  if (parsed?.kind !== "factor") return null;
  const allAuditorFactors =
    report?.evidence?.comparison_proposal?.factors ?? [];
  const currentFactors = (design?.factors ?? []).filter(
    (f) => slug(f.category?.label ?? "") === parsed.factorSlug,
  );
  // Auditor side: first try slug match (the common case). If empty,
  // fall back to sample-set Jaccard across ALL of comparison_proposal.
  // That's what handles ``wrong_category`` — the auditor's renamed
  // factor sits under the NEW category label, so slug-match fails
  // but the FVs still cover the same samples.
  const auditorSlugMatches = allAuditorFactors.filter(
    (f) => slug(f.category?.label ?? "") === parsed.factorSlug,
  );
  const auditorFactors =
    auditorSlugMatches.length > 0
      ? auditorSlugMatches
      : pairAuditorFactorsByContent(currentFactors, allAuditorFactors);
  if (currentFactors.length === 0 && auditorFactors.length === 0) {
    return null;
  }
  // 1:1 case → aligned mini-table inside a single pair of blocks.
  // N:M case (typically ``wrong_fv_partition``) → render each side
  // as a stack of distinct factor blocks; cross-block alignment is
  // intentionally OFF since merging FVs from two different factors
  // would lose the partition identity that's the whole point of
  // the disagreement. A Sankey overlay (drawn between the two
  // columns) traces sample-flow between sides so the curator can
  // see exactly which curator FVs the auditor's FVs would "merge".
  const isSimpleOneToOne =
    currentFactors.length === 1 && auditorFactors.length === 1;
  // Compute the high-level change pattern so the panel can lead
  // with a "Category change" / "Label change" / "Structural change"
  // banner. Multiple flags can fire simultaneously (e.g. the
  // partition-merge case is category + structural).
  const pattern = detectChangePattern(currentFactors, auditorFactors);
  return (
    <SankeyComparison
      currentFactors={currentFactors}
      auditorFactors={auditorFactors}
      aligned={isSimpleOneToOne}
      pattern={pattern}
    />
  );
}

interface ChangePattern {
  /** Curator and auditor factor names (categories) differ. Includes
   *  the case where the partition matches but the label was
   *  changed (``wrong_category``) AND the case where the merge
   *  ends up under a different name. */
  categoryChanged: boolean;
  /** FVs cover the same sample partition but at least one FV's
   *  label / URI differs between sides. */
  labelsChanged: boolean;
  /** Sample partition differs — the FV sample-sets don't align.
   *  ``wrong_fv_partition`` and partition-merge cases fire this. */
  structureChanged: boolean;
  /** Old categoryLabel → new categoryLabel for the category-change
   *  banner. Populated only on 1:1 pairings. */
  fromCategory: string | null;
  toCategory: string | null;
}

function detectChangePattern(
  currentFactors: ReadonlyArray<Factor>,
  auditorFactors: ReadonlyArray<FactorProposal>,
): ChangePattern {
  const pattern: ChangePattern = {
    categoryChanged: false,
    labelsChanged: false,
    structureChanged: false,
    fromCategory: null,
    toCategory: null,
  };
  if (currentFactors.length === 0 || auditorFactors.length === 0) {
    // Mid-fetch / pure-add / pure-drop case — no pairing to classify.
    return pattern;
  }
  // Category comparison — on 1:1, single-pair labels. On N:M,
  // compare label sets.
  const curCats = new Set(
    currentFactors.map((f) =>
      (f.category?.label ?? "").toLowerCase().trim(),
    ),
  );
  const audCats = new Set(
    auditorFactors.map((f) =>
      (f.category?.label ?? "").toLowerCase().trim(),
    ),
  );
  const allCats = new Set([...curCats, ...audCats]);
  pattern.categoryChanged = allCats.size > Math.max(curCats.size, audCats.size);
  if (
    currentFactors.length === 1 &&
    auditorFactors.length === 1 &&
    pattern.categoryChanged
  ) {
    pattern.fromCategory = currentFactors[0].category?.label ?? null;
    pattern.toCategory = auditorFactors[0].category?.label ?? null;
  }
  // Structure: compare sample-set partitions. Build the sorted-FV
  // signature on each side and compare.
  const fvSig = (fvs: ReadonlyArray<{ biomaterial_short_names?: string[] }>) =>
    fvs
      .map((fv) => [...(fv.biomaterial_short_names ?? [])].sort().join(","))
      .sort()
      .join(";");
  const curSig = fvSig(currentFactors.flatMap((f) => f.factor_values));
  const audSig = fvSig(auditorFactors.flatMap((f) => f.factor_values));
  pattern.structureChanged = curSig !== audSig;
  // Labels-only: if structure matches, look for any FV-label
  // disagreement. Sample → FV-label map on each side; mismatch
  // anywhere fires the flag.
  if (!pattern.structureChanged) {
    const labelFor = (
      factors: ReadonlyArray<Factor | FactorProposal>,
    ): Map<string, string> => {
      // Key: sorted-samples string; Value: FV label (lowercased).
      const m = new Map<string, string>();
      for (const f of factors) {
        for (const fv of f.factor_values) {
          const k = [...(fv.biomaterial_short_names ?? [])].sort().join(",");
          m.set(k, (fv.free_text_label ?? "").toLowerCase().trim());
        }
      }
      return m;
    };
    const curLabels = labelFor(currentFactors);
    const audLabels = labelFor(auditorFactors);
    for (const [k, l] of curLabels) {
      const r = audLabels.get(k);
      if (r != null && r !== l) {
        pattern.labelsChanged = true;
        break;
      }
    }
  }
  return pattern;
}

/** Find auditor factors that best pair with the given current
 *  factors by sample-set Jaccard. Used when slug-matching fails
 *  (e.g. wrong_category — auditor's renamed factor sits under a
 *  different category label). Returns auditor factors that pair
 *  with at least one current factor at Jaccard ≥ 0.5; each
 *  auditor factor appears at most once. */
function pairAuditorFactorsByContent(
  currentFactors: ReadonlyArray<Factor>,
  allAuditorFactors: ReadonlyArray<FactorProposal>,
): FactorProposal[] {
  if (currentFactors.length === 0 || allAuditorFactors.length === 0) {
    return [];
  }
  const samplesOf = (f: Factor | FactorProposal): Set<string> => {
    const s = new Set<string>();
    for (const fv of f.factor_values) {
      for (const sn of fv.biomaterial_short_names ?? []) s.add(sn);
    }
    return s;
  };
  const matched = new Set<number>();
  const picks: FactorProposal[] = [];
  for (const cur of currentFactors) {
    const curSet = samplesOf(cur);
    if (curSet.size === 0) continue;
    let bestIdx = -1;
    let bestJ = 0;
    for (let i = 0; i < allAuditorFactors.length; i++) {
      if (matched.has(i)) continue;
      const audSet = samplesOf(allAuditorFactors[i]);
      if (audSet.size === 0) continue;
      let inter = 0;
      for (const s of audSet) if (curSet.has(s)) inter++;
      const union = curSet.size + audSet.size - inter;
      const j = union > 0 ? inter / union : 0;
      if (j > bestJ) {
        bestJ = j;
        bestIdx = i;
      }
    }
    if (bestJ >= 0.5 && bestIdx >= 0) {
      matched.add(bestIdx);
      picks.push(allAuditorFactors[bestIdx]);
    }
  }
  return picks;
}

/** Outer shell of the comparison view. Owns the relative container
 *  the SVG overlay anchors to, the row-position registry that
 *  measures the rendered FV rows after layout, and the SVG that
 *  draws sample-flow lines between left and right rows.
 *
 *  Why the indirection: the row rendering happens deep inside
 *  FactorBlock → MiniFvLine, and we want the Sankey to anchor on
 *  the actual rendered DOM (so it survives content changes / dark-
 *  mode resize / etc.). Rather than thread refs through every
 *  child, rows ship with ``data-row-key`` + ``data-samples`` attrs;
 *  a useLayoutEffect walks the container after each render and
 *  rebuilds the position map. */
function SankeyComparison({
  currentFactors,
  auditorFactors,
  aligned,
  pattern,
}: {
  currentFactors: ReadonlyArray<Factor>;
  auditorFactors: ReadonlyArray<FactorProposal>;
  aligned: boolean;
  pattern: ChangePattern;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<SankeyEdge[]>([]);
  // Stable input signature for the layout effect — re-running on
  // every render would loop because measurements trigger a state
  // update.
  const sig = useMemo(() => {
    const sideSig = (
      list: ReadonlyArray<Factor | FactorProposal>,
    ) =>
      list
        .map(
          (f) =>
            `${f.category?.label ?? ""}|` +
            f.factor_values
              .map(
                (fv) =>
                  `${fv.free_text_label ?? ""}#${(fv.biomaterial_short_names ?? []).length}`,
              )
              .join(","),
        )
        .join(";");
    return `${sideSig(currentFactors)}::${sideSig(auditorFactors)}`;
  }, [currentFactors, auditorFactors]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const recompute = () => {
      setEdges(measureEdges(container));
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(container);
    return () => ro.disconnect();
  }, [sig]);

  return (
    <div className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
      {/* Category-change banner — leads the comparison surface when
          the auditor's pair has a different category label, even
          when everything else (FVs / structure) matches. Lives
          ABOVE the column headers so it's the first thing the
          curator reads. */}
      {pattern.categoryChanged && pattern.fromCategory && pattern.toCategory ? (
        <div className="px-2 py-1 text-[11px] flex items-center gap-1.5 border-b border-slate-200 dark:border-slate-700 bg-amber-50 dark:bg-amber-900/15 text-amber-900 dark:text-amber-100">
          <span className="text-[10px] uppercase tracking-wide font-semibold">
            Category
          </span>
          <span className="font-mono">{pattern.fromCategory}</span>
          <span aria-hidden>→</span>
          <span className="font-mono font-semibold">
            {pattern.toCategory}
          </span>
          {!pattern.labelsChanged && !pattern.structureChanged ? (
            <span className="ml-auto text-[10px] italic text-amber-700 dark:text-amber-300">
              FVs unchanged
            </span>
          ) : null}
        </div>
      ) : pattern.categoryChanged ? (
        // Multi-factor / partition-merge case: we can't show a
        // single old→new arrow, but we still surface that the
        // categories diverge so the curator doesn't miss it.
        <div className="px-2 py-1 text-[11px] border-b border-slate-200 dark:border-slate-700 bg-amber-50 dark:bg-amber-900/15 text-amber-900 dark:text-amber-100">
          <span className="text-[10px] uppercase tracking-wide font-semibold mr-1.5">
            Category change
          </span>
          <span className="italic">
            current and auditor disagree on what the factor(s) should
            be called.
          </span>
        </div>
      ) : null}
      <div className="grid grid-cols-2 text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
        <div className="px-2 py-1 border-r border-slate-200 dark:border-slate-700">
          Current{currentFactors.length > 1 ? ` · ${currentFactors.length} factors` : ""}
        </div>
        <div className="px-2 py-1">
          Auditor proposes
          {auditorFactors.length > 1 ? ` · ${auditorFactors.length} factors` : ""}
        </div>
      </div>
      <div ref={containerRef} className="relative">
        {aligned ? (
          <AlignedFactorBlock
            current={currentFactors[0]}
            auditor={auditorFactors[0]}
          />
        ) : (
          <PartitionMismatchBlocks
            currentFactors={currentFactors}
            auditorFactors={auditorFactors}
          />
        )}
        <SankeyOverlay edges={edges} />
      </div>
    </div>
  );
}

interface SankeyEdge {
  /** y-coordinate at the right edge of the left cell (relative to
   *  the container's top-left). */
  leftY: number;
  /** y-coordinate at the left edge of the right cell. */
  rightY: number;
  /** x-coordinate where the curve starts (right edge of the left
   *  column / left of the dividing border). */
  startX: number;
  /** x-coordinate where the curve ends (left edge of the right
   *  column / right of the dividing border). */
  endX: number;
  /** Number of shared samples — drives stroke width. */
  overlap: number;
  /** Fraction of the LEFT side's samples this overlap represents.
   *  Used for opacity grading — a tiny overlap on a big curator FV
   *  is visually softer than a complete-overlap edge. */
  leftFrac: number;
  /** Stable key for React. */
  key: string;
}

/** Walk the rendered DOM, find all rows tagged with
 *  ``data-row-key`` + ``data-samples``, compute sample-set
 *  intersections between every left/right pair, and build SVG
 *  paths for non-zero overlaps. */
function measureEdges(container: HTMLDivElement): SankeyEdge[] {
  const containerRect = container.getBoundingClientRect();
  type Row = {
    side: "current" | "auditor";
    samples: Set<string>;
    centerY: number;
    rightEdge: number;
    leftEdge: number;
    key: string;
  };
  const rows: Row[] = [];
  const els = container.querySelectorAll<HTMLElement>("[data-row-key]");
  els.forEach((el) => {
    const key = el.dataset.rowKey ?? "";
    if (!key) return;
    const [side, ..._rest] = key.split(":");
    if (side !== "current" && side !== "auditor") return;
    const samplesAttr = el.dataset.samples ?? "";
    const samples = new Set(
      samplesAttr ? samplesAttr.split(",").filter(Boolean) : [],
    );
    const rect = el.getBoundingClientRect();
    rows.push({
      side: side as "current" | "auditor",
      samples,
      centerY: rect.top - containerRect.top + rect.height / 2,
      rightEdge: rect.right - containerRect.left,
      leftEdge: rect.left - containerRect.left,
      key,
    });
  });
  const left = rows.filter((r) => r.side === "current");
  const right = rows.filter((r) => r.side === "auditor");
  if (left.length === 0 || right.length === 0) return [];
  // The "rail" between the two columns runs from the max right-
  // edge of the left rows to the min left-edge of the right rows.
  // We use those as the x-anchors for curve endpoints.
  const startX = Math.max(...left.map((r) => r.rightEdge));
  const endX = Math.min(...right.map((r) => r.leftEdge));
  const edges: SankeyEdge[] = [];
  for (const l of left) {
    if (l.samples.size === 0) continue;
    for (const r of right) {
      if (r.samples.size === 0) continue;
      let inter = 0;
      for (const s of l.samples) if (r.samples.has(s)) inter++;
      if (inter === 0) continue;
      edges.push({
        leftY: l.centerY,
        rightY: r.centerY,
        startX,
        endX,
        overlap: inter,
        leftFrac: inter / l.samples.size,
        key: `${l.key}->${r.key}`,
      });
    }
  }
  return edges;
}

function SankeyOverlay({ edges }: { edges: SankeyEdge[] }) {
  if (edges.length === 0) return null;
  // Stroke width grows with sample count; clamp so a 50-sample
  // overlap doesn't paint over the labels.
  const widthFor = (n: number) => Math.max(1, Math.min(6, 0.6 + n * 0.4));
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden
    >
      {edges.map((e) => {
        const dx = (e.endX - e.startX) * 0.5;
        const d = `M ${e.startX} ${e.leftY} C ${e.startX + dx} ${e.leftY}, ${e.endX - dx} ${e.rightY}, ${e.endX} ${e.rightY}`;
        return (
          <path
            key={e.key}
            d={d}
            fill="none"
            stroke="currentColor"
            className="text-sky-500/40 dark:text-sky-400/40"
            strokeWidth={widthFor(e.overlap)}
            strokeLinecap="round"
          >
            <title>{`${e.overlap} shared sample${e.overlap === 1 ? "" : "s"}`}</title>
          </path>
        );
      })}
    </svg>
  );
}

/** Single-pair aligned view. Both sides have exactly one factor;
 *  rows align by gemma_ref → sample-Jaccard → label. */
function AlignedFactorBlock({
  current,
  auditor,
}: {
  current: Factor | undefined;
  auditor: FactorProposal | undefined;
}) {
  const norm = (s: string) => s.toLowerCase().trim();
  const currentFvs = (current?.factor_values ?? []).map((fv) => ({ fv }));
  const auditorFvs = (auditor?.factor_values ?? []).map((fv) => ({ fv }));
  const pairs: Array<{ left?: number; right?: number }> = [];
  const leftPaired = new Set<number>();
  const rightPaired = new Set<number>();
  // Pass 1: gemma_ref label (audit's pre-computed link).
  for (let ri = 0; ri < auditorFvs.length; ri++) {
    const fv = auditorFvs[ri].fv as FactorProposal["factor_values"][number];
    const refLabel = norm(fv.gemma_ref?.label || "");
    if (!refLabel) continue;
    const li = currentFvs.findIndex(
      (e, i) =>
        !leftPaired.has(i) && norm(e.fv.free_text_label || "") === refLabel,
    );
    if (li >= 0) {
      pairs.push({ left: li, right: ri });
      leftPaired.add(li);
      rightPaired.add(ri);
    }
  }
  // Pass 2: sample-set Jaccard ≥ 0.5.
  const sampleSet = (e: { fv: { biomaterial_short_names?: string[] } }) =>
    new Set(e.fv.biomaterial_short_names ?? []);
  for (let ri = 0; ri < auditorFvs.length; ri++) {
    if (rightPaired.has(ri)) continue;
    const rSet = sampleSet(auditorFvs[ri]);
    if (rSet.size === 0) continue;
    let bestLi = -1;
    let bestJaccard = 0;
    for (let li = 0; li < currentFvs.length; li++) {
      if (leftPaired.has(li)) continue;
      const lSet = sampleSet(currentFvs[li]);
      if (lSet.size === 0) continue;
      let inter = 0;
      for (const s of rSet) if (lSet.has(s)) inter++;
      const union = lSet.size + rSet.size - inter;
      const j = union > 0 ? inter / union : 0;
      if (j > bestJaccard) {
        bestJaccard = j;
        bestLi = li;
      }
    }
    if (bestJaccard >= 0.5 && bestLi >= 0) {
      pairs.push({ left: bestLi, right: ri });
      leftPaired.add(bestLi);
      rightPaired.add(ri);
    }
  }
  // Pass 3: label match.
  for (let ri = 0; ri < auditorFvs.length; ri++) {
    if (rightPaired.has(ri)) continue;
    const rLabel = norm(auditorFvs[ri].fv.free_text_label || "");
    if (!rLabel) continue;
    const li = currentFvs.findIndex(
      (e, i) =>
        !leftPaired.has(i) && norm(e.fv.free_text_label || "") === rLabel,
    );
    if (li >= 0) {
      pairs.push({ left: li, right: ri });
      leftPaired.add(li);
      rightPaired.add(ri);
    }
  }
  for (let ri = 0; ri < auditorFvs.length; ri++) {
    if (!rightPaired.has(ri)) pairs.push({ right: ri });
  }
  for (let li = 0; li < currentFvs.length; li++) {
    if (!leftPaired.has(li)) pairs.push({ left: li });
  }
  return (
    <ul>
      {pairs.map((p, i) => {
        const left = p.left != null ? currentFvs[p.left] : undefined;
        const right = p.right != null ? auditorFvs[p.right] : undefined;
        return (
          <li
            key={i}
            className="grid grid-cols-2 border-b border-slate-100 dark:border-slate-800 last:border-b-0"
          >
            <FactorSideCell
              slot={left ? { fv: left.fv, parent: null } : undefined}
              muted={!left}
              onlyHere={!!left && !right}
            />
            <FactorSideCell
              slot={right ? { fv: right.fv, parent: null } : undefined}
              muted={!right}
              onlyHere={!!right && !left}
              leftBorder
            />
          </li>
        );
      })}
    </ul>
  );
}

/** Per-side palette so each factor in the stack reads as a distinct
 *  identity. Picked for high contrast against both light and dark
 *  card backgrounds while staying clearly secondary to the term-
 *  chip emerald (which carries "ontology-resolved" meaning). The
 *  palette is applied independently per side — same colour on
 *  Current and Auditor does NOT mean "same factor across sides";
 *  the sample-overlap Sankey (forthcoming) carries cross-side
 *  identity. */
const FACTOR_PALETTE: ReadonlyArray<{
  border: string;
  dot: string;
  text: string;
}> = [
  {
    border: "border-l-sky-500",
    dot: "bg-sky-500",
    text: "text-sky-700 dark:text-sky-300",
  },
  {
    border: "border-l-violet-500",
    dot: "bg-violet-500",
    text: "text-violet-700 dark:text-violet-300",
  },
  {
    border: "border-l-amber-500",
    dot: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-300",
  },
  {
    border: "border-l-rose-500",
    dot: "bg-rose-500",
    text: "text-rose-700 dark:text-rose-300",
  },
];

function paletteFor(idx: number): (typeof FACTOR_PALETTE)[number] {
  return FACTOR_PALETTE[idx % FACTOR_PALETTE.length];
}

/** Partition-disagreement view: each side stacks its factors as
 *  distinct blocks. No cross-side row alignment — the partitions
 *  literally don't match, so pretending the rows line up would
 *  hide the disagreement. Each block gets a left-border accent
 *  colour from the per-side palette so multi-factor stacks read
 *  as distinct identities at a glance. */
function PartitionMismatchBlocks({
  currentFactors,
  auditorFactors,
}: {
  currentFactors: ReadonlyArray<Factor>;
  auditorFactors: ReadonlyArray<FactorProposal>;
}) {
  return (
    <div className="grid grid-cols-2">
      <div className="border-r border-slate-200 dark:border-slate-700">
        {currentFactors.length === 0 ? (
          <div className="px-2 py-1 italic text-slate-400 text-[10px]">
            — none —
          </div>
        ) : (
          currentFactors.map((f, i) => (
            <FactorBlock
              key={i}
              header={
                currentFactors.length > 1
                  ? `Factor ${i + 1} · ${capitalizeCategory(f.category?.label) || "?"}`
                  : null
              }
              factor={f}
              isLast={i === currentFactors.length - 1}
              palette={
                currentFactors.length > 1 ? paletteFor(i) : null
              }
            />
          ))
        )}
      </div>
      <div>
        {auditorFactors.length === 0 ? (
          <div className="px-2 py-1 italic text-slate-400 text-[10px]">
            — none —
          </div>
        ) : (
          auditorFactors.map((f, i) => (
            <FactorBlock
              key={i}
              header={
                auditorFactors.length > 1
                  ? `Factor ${i + 1} · ${capitalizeCategory(f.category?.label) || "?"}`
                  : null
              }
              factor={f}
              isLast={i === auditorFactors.length - 1}
              palette={
                auditorFactors.length > 1 ? paletteFor(i) : null
              }
            />
          ))
        )}
      </div>
    </div>
  );
}

function FactorBlock({
  header,
  factor,
  isLast,
  palette,
}: {
  header: string | null;
  factor: Factor | FactorProposal;
  isLast: boolean;
  /** Per-side accent colour. When null the block renders
   *  borderless / unaccented (the single-factor case). */
  palette: (typeof FACTOR_PALETTE)[number] | null;
}) {
  return (
    <div
      className={cn(
        "py-1",
        !isLast && "border-b border-slate-200 dark:border-slate-700",
        palette ? cn("border-l-4 pl-2 pr-2", palette.border) : "px-2",
      )}
    >
      {header ? (
        <div
          className={cn(
            "text-[10px] uppercase tracking-wide font-semibold flex items-center gap-1 mb-0.5",
            palette
              ? palette.text
              : "text-slate-500 dark:text-slate-400",
          )}
        >
          {palette ? (
            <span
              aria-hidden
              className={cn("inline-block w-1.5 h-1.5 rounded-full", palette.dot)}
            />
          ) : null}
          {header}
        </div>
      ) : null}
      <ul className="space-y-0.5">
        {factor.factor_values.map((fv, j) => (
          <li key={j}>
            <MiniFvLine fv={fv} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function FactorSideCell({
  slot,
  muted,
  onlyHere,
  leftBorder,
  rowKey,
}: {
  slot:
    | { fv: Factor["factor_values"][number] | FactorProposal["factor_values"][number]; parent: string | null }
    | undefined;
  /** Render the cell as an absent-on-this-side placeholder. */
  muted: boolean;
  /** Show an amber disc indicating the matching FV isn't on the
   *  other side. */
  onlyHere: boolean;
  leftBorder?: boolean;
  /** ``side:factorIdx:fvIdx`` — Sankey overlay reads this off the
   *  rendered DOM via ``data-row-key`` + ``data-samples``. */
  rowKey?: string;
}) {
  const samples = (slot?.fv.biomaterial_short_names ?? []).join(",");
  return (
    <div
      className={cn(
        "px-2 py-0.5",
        leftBorder && "border-l border-slate-200 dark:border-slate-700",
      )}
      data-row-key={rowKey && !muted ? rowKey : undefined}
      data-samples={rowKey && !muted ? samples : undefined}
    >
      {muted ? (
        <span className="italic text-slate-400 dark:text-slate-500 text-[10px]">
          — absent —
        </span>
      ) : (
        <div className="flex items-start gap-1">
          <span
            aria-hidden
            className={cn(
              "inline-block w-1.5 h-1.5 rounded-full shrink-0 mt-1",
              onlyHere ? "bg-amber-500" : "invisible",
            )}
            title={
              onlyHere ? "this FV isn't on the other side" : undefined
            }
          />
          <div className="min-w-0 flex-1">
            {slot!.parent ? (
              <div className="text-[9px] uppercase tracking-wide text-slate-400 dark:text-slate-500 truncate leading-tight">
                {slot!.parent}
              </div>
            ) : null}
            <MiniFvLine fv={slot!.fv} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Dainty single-line render of a factor-value — same Subj·Pred·Obj
 *  shape as the full-blown FvDisplayRow / design surface but at
 *  half the visual weight (10px chips, no baseline glyph slot, no
 *  FV-index slot, no editing affordance). Multi-statement FVs
 *  collapse extra statements onto compact sublines. */
function MiniFvLine({
  fv,
}: {
  fv:
    | Factor["factor_values"][number]
    | FactorProposal["factor_values"][number];
}) {
  const statements = fv.statements ?? [];
  const head = statements[0];
  const rest = statements.slice(1);
  const subjLabel =
    head?.subject?.label?.trim() || fv.free_text_label?.trim() || "";
  const subjUri = head?.subject?.uri ?? null;
  const predLabel = head?.predicate?.label?.trim() ?? "";
  const predUri = head?.predicate?.uri ?? null;
  const objLabel = head?.object?.label?.trim() ?? "";
  const objUri = head?.object?.uri ?? null;
  const n = fv.biomaterial_short_names?.length ?? 0;
  return (
    <div className="text-[10px] leading-tight">
      <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
        {subjLabel ? (
          <MiniTerm label={subjLabel} uri={subjUri} />
        ) : (
          <span className="italic text-slate-400">(blank)</span>
        )}
        {predLabel ? (
          <>
            <span className="text-slate-400 dark:text-slate-500">·</span>
            <span
              className="text-slate-500 dark:text-slate-300 font-mono"
              title={predUri || undefined}
            >
              {predLabel}
            </span>
          </>
        ) : null}
        {objLabel ? (
          <>
            <span className="text-slate-400 dark:text-slate-500">·</span>
            <MiniTerm label={objLabel} uri={objUri} />
          </>
        ) : null}
        {fv.is_baseline ? (
          <span
            className="text-amber-600 dark:text-amber-400 leading-none"
            title="baseline"
            aria-label="baseline"
          >
            ▂
          </span>
        ) : null}
        {n > 0 ? (
          <span className="text-slate-400 dark:text-slate-500">
            ({n})
          </span>
        ) : null}
      </div>
      {rest.length > 0 ? (
        <div className="pl-2 mt-0.5 space-y-0.5">
          {rest.map((s, i) => (
            <div
              key={i}
              className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5"
            >
              {s.subject?.label ? (
                <MiniTerm
                  label={s.subject.label}
                  uri={s.subject.uri ?? null}
                />
              ) : null}
              {s.predicate?.label ? (
                <>
                  <span className="text-slate-400 dark:text-slate-500">·</span>
                  <span className="text-slate-500 dark:text-slate-300 font-mono">
                    {s.predicate.label}
                  </span>
                </>
              ) : null}
              {s.object?.label ? (
                <>
                  <span className="text-slate-400 dark:text-slate-500">·</span>
                  <MiniTerm
                    label={s.object.label}
                    uri={s.object.uri ?? null}
                  />
                </>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Mini chip: same visual cues as the full Term chip (emerald wash
 *  + URI suffix when resolved; grey italic when free-text) at
 *  half the size. Not interactive — these rows aren't editable. */
function MiniTerm({
  label,
  uri,
}: {
  label: string;
  uri: string | null;
}) {
  const resolved = !!uri;
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1 px-1 rounded-sm border leading-tight",
        resolved
          ? "bg-emerald-50 text-emerald-800 border-emerald-200 border-l-[2px] border-l-emerald-500 dark:bg-emerald-900/30 dark:text-emerald-100 dark:border-emerald-700"
          : "bg-stone-50 text-stone-600 border-stone-200 italic dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600",
      )}
      title={uri || undefined}
    >
      <span className="break-words">{label}</span>
      {uri ? (
        <span className="text-slate-400 dark:text-slate-500 font-mono text-[9px] whitespace-nowrap">
          {shortenUri(uri)}
        </span>
      ) : null}
    </span>
  );
}

/** Per-FV confirmation chips, nested inside the parent factor
 *  card body. Renders only when the factor finding has OK-severity
 *  FV findings on the same parent slug — those carry the auditor's
 *  per-FV statement-correctness check, which is valuable context
 *  but doesn't deserve a standalone card. */
function NestedOkFvConfirmations({
  finding,
  report,
}: {
  finding: AuditFinding;
  report: AuditReport | null;
}) {
  if (finding.target_kind !== "factor") return null;
  const parsed = parseTargetId(finding.target_id);
  if (parsed?.kind !== "factor") return null;
  const parentSlug = parsed.factorSlug;
  const okFvs = (report?.findings ?? []).filter((f) => {
    if (f.target_kind !== "fv" || f.severity !== "ok") return false;
    const p = parseTargetId(f.target_id);
    return p?.kind === "fv" && p.factorSlug === parentSlug;
  });
  if (okFvs.length === 0) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-1.5 text-[10px]">
      <span className="uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
        Auditor confirms FV{okFvs.length === 1 ? "" : "s"}:
      </span>
      {okFvs.map((f, i) => {
        const p = parseTargetId(f.target_id);
        const fvLabel =
          p?.kind === "fv" ? p.fvSlug.replace(/-/g, " ") : f.target_id;
        return (
          <span
            key={i}
            className="inline-flex items-baseline gap-0.5 px-1.5 py-0.5 rounded-sm border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-100"
            title={f.rationale || undefined}
          >
            <span className="text-emerald-600 dark:text-emerald-400 font-bold">
              ✓
            </span>
            <span>{fvLabel}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Human-friendly one-liner over the auditor's take, derived from
 *  ``issue_code``. Returns null for codes we don't have confident
 *  framing for — the rest of the card (rationale block + side-by-
 *  side) still carries the message. */
function FactorFindingSummaryLine({ finding }: { finding: AuditFinding }) {
  if (finding.target_kind !== "factor") return null;
  const category = firstBacktick(finding.rationale ?? "") || null;
  const cat = category && /^[^`]+$/.test(category) ? category : null;
  const summary = factorFindingSummary(finding, cat);
  if (!summary) return null;
  return (
    <div className="text-[11px] text-slate-700 dark:text-slate-200 leading-snug italic">
      {summary}
    </div>
  );
}

function factorFindingSummary(
  finding: AuditFinding,
  category: string | null,
): string | null {
  const code = finding.issue_code;
  const catLabel = category || "this category";
  switch (code) {
    case "wrong_fv_partition":
      return `Auditor agrees ${catLabel} is a factor but proposes a different partitioning.`;
    case "wrong_category":
      return `Auditor agrees on the FVs but proposes a different category label.`;
    case "calibration_factor_extra":
      return `Auditor proposes a new ${catLabel} factor not in the current design.`;
    case "calibration_factor_gold_only_miss":
      return `Auditor says the current ${catLabel} factor shouldn't be in the design.`;
    case "calibration_factor_match":
      return `Auditor confirms the ${catLabel} factor matches.`;
    case "calibration_factor_match_exact":
      return `Auditor confirms the ${catLabel} factor matches exactly.`;
    case "calibration_factor_match_near":
      return `Auditor agrees on ${catLabel} but proposes refinements to label or terms.`;
    case "calibration_factor_partition_mismatch":
      return `Auditor agrees ${catLabel} is a factor but proposes a finer/coarser partition.`;
    case "calibration_factor_rename":
      return `Auditor agrees on the ${catLabel} factor's structure but proposes a different name.`;
    case "forbidden_efc":
      return `Auditor flags ${catLabel} as an EFC the curation guide forbids.`;
    case "vague_fv_labels":
      return `Auditor flags vague factor-value labels on ${catLabel}.`;
    case "conflated":
      return `Auditor says ${catLabel} conflates two different concepts.`;
    case "missing_factor":
      return `Auditor proposes ${catLabel} as a factor missing from the current design.`;
    default:
      return null;
  }
}

/** Generic counterpart to ``NearMatchExplainer`` for any actionable
 *  finding whose disagreement axis the per-row comparator can't
 *  surface — ``wrong_fv_partition`` (BM has more distinct values
 *  than the factor declares), ``conflated`` (two factors should be
 *  one), etc. Without this the curator reads "Everyone agrees" next
 *  to a major-severity glyph and has nothing to act on. */
function ActionableNoDeltaExplainer({ finding }: { finding: AuditFinding }) {
  const { kind } = useAudit();
  const rationale = trimRationaleBoilerplate(finding.rationale ?? "").trim();
  const sevPalette =
    finding.severity === "blocker"
      ? "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-700/60 dark:bg-rose-900/20 dark:text-rose-100"
      : finding.severity === "major"
        ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/15 dark:text-amber-100"
        : "border-slate-300 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-200";
  // Severity-axis labels ("major" / "minor" / "blocker") are an
  // audit framing — they signal "how broken is this gold curation".
  // Proposals don't have a "broken-ness" axis; collapse the label
  // strip when ``kind="proposal"``. The colored palette still
  // encodes urgency for readability without making the curator
  // parse a vocabulary that doesn't apply. The ``issue_code``
  // chip is behind-the-scenes plumbing — hide it everywhere (per
  // Paul 2026-05-25); the rationale below carries the human
  // signal.
  const showSeverityLabel = kind === "audit";
  return (
    <div
      className={cn(
        "rounded border px-2.5 py-2 text-[11px] leading-snug",
        sevPalette,
      )}
    >
      {showSeverityLabel ? (
        <div className="flex items-baseline gap-1.5 mb-1">
          <span className="font-semibold uppercase tracking-wide text-[10px]">
            {finding.severity}
          </span>
        </div>
      ) : null}
      {rationale ? (
        <div className="italic opacity-90">{rationale}</div>
      ) : (
        <div className="italic opacity-70">
          (no rationale on the wire — see Auditor details below)
        </div>
      )}
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

/** Renders a single extra current-side statement (statements[1+])
 *  inline beneath the main Current comparator line. The row builder
 *  pairs the agent's one proposed statement against gold's
 *  ``statements[0]``; this surfaces the remaining ones so the curator
 *  sees the full current structure (e.g. dexamethasone FV with both
 *  a "delivered at dose · 100 nmol/kg" and a "has modifier · …"
 *  statement). Per Paul 2026-06-11. */
function ExtraCurrentStatement({
  extra,
}: {
  extra: {
    subject: SideValue;
    predicate: SideValue;
    object: SideValue;
  };
}) {
  const parts: Array<{ kind: "subject" | "predicate" | "object"; value: SideValue }> = [];
  if (extra.subject.label) parts.push({ kind: "subject", value: extra.subject });
  if (extra.predicate.label) parts.push({ kind: "predicate", value: extra.predicate });
  if (extra.object.label) parts.push({ kind: "object", value: extra.object });
  if (parts.length === 0) return null;
  return (
    <div className="grid grid-cols-[5rem_1fr] gap-x-2 items-baseline text-[11px]">
      <span />
      <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
        {parts.map((p, i) => {
          const sep =
            i === 0 ? null : (
              <span
                key={`sep-${i}`}
                className="text-slate-400 dark:text-slate-500"
                aria-hidden
              >
                {" - "}
              </span>
            );
          if (p.kind === "predicate") {
            return (
              <span key={`p-${i}`} className="inline-flex items-baseline">
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
          return (
            <span key={`p-${i}`} className="inline-flex items-baseline">
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
        })}
      </span>
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
  locateTooltip,
  editCategory,
  leanKinds,
  actionLbls,
  actionShape,
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
  /** Tooltip + aria-label for the locate button — passed in so it
   *  names the actual tab (Overview / Design / Samples) the focus
   *  jumps to. Defaults to a generic "locate" when omitted. */
  locateTooltip?: string;
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
  /** Action shape — same finding-level shape the parent computes.
   *  Threaded so the accept button can suppress the possessive
   *  suffix when shape is "remove" / "match" (per Paul 2026-06-08,
   *  the "remove Auditor's" hanging-possessive bug). */
  actionShape: ActionShape;
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
  // Hook order: useState MUST run before the empty-rows early
  // return below — Rules-of-Hooks. ``rows[0]`` is undefined when
  // rows is empty, but ``?.pick`` short-circuits cleanly so this
  // is safe.
  const subjectRow = rows.find((r) => r.rowLabel === "Subject") ?? rows[0];
  const subjectState = subjectRow ? rowState.get(subjectRow.path) : undefined;
  const [editOpen, setEditOpen] = useState(subjectState?.pick === "edit");
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

  // ``subjectRow`` / ``subjectState`` / ``editOpen`` are lifted to
  // the top of the function (above the empty-rows guard) to keep
  // hook order stable across renders — see the useState above.

  // Action-aware button labels — `don't add` / `don't remove` /
  // `don't change` / `confirm` per the finding's action shape (Paul
  // 2026-05-21). The OUTER ActionRow uses the same `actionLbls`
  // object so the per-FV row reads consistently with the bottom-of-
  // card buttons. Replaces the older identity-bearing
  // `keepLabelFor(identities.goldCurator)` ("keep current" /
  // "keep amanda's") — those didn't carry the action verb.
  const keepLabel = actionLbls.keep;
  // For action shapes where the accept verb stands on its own
  // ("remove" / "confirm"), the trailing "<Proposer>'s" was reading
  // as a hanging possessive ("remove Auditor's"). Use the helper
  // so the suffix only appears for add/change actions where it
  // makes grammatical sense.
  const adoptLabel = acceptLabel(actionShape, identities.proposer);

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
        locateTooltip={locateTooltip}
      />
      {/* Extra current-side statements beyond ``statements[0]`` — a
          curated FV often layers multiple statements (subject + dose,
          role + modifier, etc.) but the row builder only pairs against
          the first. Surface the rest here as "(also: S - P - O)" hints
          so the curator sees the full current structure. Per Paul
          2026-06-11. */}
      {meta?.goldExtraStatements?.map((extra, ix) => (
        <ExtraCurrentStatement key={`extra-${ix}`} extra={extra} />
      ))}
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
        {actionShape === "match" ? (
          // Match findings — auditor's claim and current row already
          // agree, so both keep/adopt labels resolve to "confirm".
          // Rendering both was Paul's "having 'confirm' and 'confirm'
          // on every card is dumb" (2026-06-11): two buttons doing
          // the same thing under different colours. Collapse to a
          // single Confirm that records the agreement. The outer
          // Agree button on FindingActionRow already serves as the
          // factor-level "confirm all" when the curator wants to
          // skip the per-FV walkthrough.
          <PickButton
            active={blockPick === "proposal" || blockPick === "currently"}
            recommended={true}
            onClick={() => onPick("proposal")}
            tone="accept"
          >
            Confirm
          </PickButton>
        ) : (
          <>
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
              {adoptLabel}
            </PickButton>
          </>
        )}
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
  locateTooltip,
}: {
  rows: Row[];
  identities: AuditIdentities;
  onLocateCurrent?: () => void;
  locateTooltip?: string;
}) {
  const catRow = rows.find((r) => r.rowLabel === "Category");
  const valRow = rows.find((r) => r.rowLabel === "Value");
  // Statement-delta rows (tag near-match) — when present, each side
  // renders its subject·predicate·object IN PLACE OF the bare value,
  // exactly as the finding-card header does. That surfaces the
  // Current-vs-Proposed statement delta (e.g. Proposer adds
  // ``· has_genotype · Heterozygous`` that Current lacks).
  const subjRow = rows.find((r) => r.rowLabel === "Subject");
  const predRow = rows.find((r) => r.rowLabel === "Predicate");
  const objRow = rows.find((r) => r.rowLabel === "Object");
  if (!catRow && !valRow) return null;
  function renderSide(side: "proposal" | "currently"): JSX.Element {
    const pick = (r: Row | undefined): SideValue | null =>
      r ? (side === "proposal" ? r.proposal : r.currently) : null;
    const cat = pick(catRow);
    const val = pick(valRow);
    const subj = pick(subjRow);
    const pred = pick(predRow);
    const obj = pick(objRow);
    // This side carries structured statement detail iff it has a
    // predicate or object — then render the statement instead of the
    // value chip (no subject/value duplication). A side without detail
    // (a bare tag) keeps the value chip.
    const sideHasStatement = !!(pred?.label || obj?.label) && !!subj?.label;
    const catEmpty = !cat || !cat.label;
    const valEmpty = !val || !val.label;
    if (catEmpty && valEmpty && !sideHasStatement) {
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
        {sideHasStatement ? (
          <span className="inline-flex items-baseline gap-x-1.5">
            <StatementSequence
              subject={{ label: subj!.label, uri: subj!.uri ?? null }}
              pairs={[
                {
                  predicate: pred?.label
                    ? { label: pred.label, uri: pred.uri ?? null }
                    : null,
                  object: obj?.label
                    ? { label: obj.label, uri: obj.uri ?? null }
                    : null,
                },
              ]}
              separator="·"
              separatorClassName="text-slate-400 dark:text-slate-600 select-none"
              predicateClassName="italic text-slate-500 dark:text-slate-400 font-normal"
              asLink={false}
            />
          </span>
        ) : !valEmpty ? (
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
      <div className="grid grid-cols-[5rem_1fr] gap-x-2 items-baseline text-[11px]">
        <span className="text-slate-600 dark:text-slate-300">
          <strong>{identities.proposer}</strong> says
        </span>
        {renderSide("proposal")}
      </div>
      <div className="grid grid-cols-[5rem_1fr] gap-x-2 items-baseline text-[11px]">
        <span className="text-slate-600 dark:text-slate-300">
          <strong>{identities.goldCurator}</strong>
          {goldVerb ? ` ${goldVerb}` : null}
          {onLocateCurrent ? (
            <button
              type="button"
              onClick={onLocateCurrent}
              title={locateTooltip ?? "locate"}
              aria-label={locateTooltip ?? "locate"}
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
  locateTooltip,
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
  /** Tooltip for the locate button — usually the dynamic
   *  ``locateTooltipFor(targetId)`` string ("show in Design tab" /
   *  "show in Overview tab" / "show in Samples tab"). */
  locateTooltip?: string;
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
        "grid grid-cols-[5rem_1fr] gap-x-2 items-baseline text-[11px]",
        picked && "rounded bg-blue-50 dark:bg-blue-900/30 px-1 py-0.5",
      )}
    >
      <span className="text-slate-600 dark:text-slate-300">
        <strong>{who}</strong>{verb ? ` ${verb}` : null}
        {onLocate ? (
          <button
            type="button"
            onClick={onLocate}
            title={locateTooltip ?? "locate"}
            aria-label={locateTooltip ?? "locate"}
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
  /** Per-button disable, OR-ed with the row-level ``disabled``. Lets a
   *  card disable ONE primary while leaving its sibling live — e.g. the
   *  cross-cutting partition card disables only "Adopt" (an unspecced
   *  design merge) while "Keep current" stays clickable, since keeping
   *  the design unchanged is always safe (Paul 2026-06-19). */
  disabled?: boolean;
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

/** Synthesise an ``FvDisplayLike`` for the partition_mismatch mapping
 *  block from a side's ``OntologyTerm`` (FV-level label / URI) plus
 *  the wire's optional ``StatementParts`` decomposition. Hands the
 *  result to ``FvDisplayRow`` so the mapping rows render statement
 *  chips (subject · predicate · object) instead of just the FV's
 *  free-text name — matching the design-editor's per-FV display
 *  surface. ``biomaterial_short_names`` is left empty (the wire
 *  doesn't carry per-pair sample sets here); the ``(n)`` count
 *  simply doesn't render. */
function _fvDisplayFromMapping(
  term: { label: string; uri: string | null },
  stmt: StatementParts | null | undefined,
  samples: readonly string[] | null = null,
) {
  const statements = stmt
    ? [
        {
          subject: stmt.subject
            ? { label: stmt.subject.label, uri: stmt.subject.uri ?? null }
            : null,
          predicate: stmt.predicate
            ? { label: stmt.predicate.label, uri: stmt.predicate.uri ?? null }
            : null,
          object: stmt.object
            ? { label: stmt.object.label, uri: stmt.object.uri ?? null }
            : null,
        },
      ]
    : [];
  return {
    free_text_label: term.label,
    statements,
    biomaterial_short_names: samples ? [...samples] : [],
  };
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

// FreeTextLookup component removed 2026-06-15 with the
// proposal-pane editing affordance. Recover from git history
// (commit c687592) if/when it's needed again.

// InlineNotesPrompt deleted 2026-06-15 — Reject paths now route
// through ``onDismiss`` → ``DismissDialog`` chip picker, sourcing
// per-issue-code chips from ``dispositionChips.dismissChipsFor``.
// Paul: "make sure there is a _uniform_ place those are coded but
// the choices might differ based on the situation." Recover from
// git history if a future surface wants a free-text-only prompt.


function ActionRow({
  saving,
  disabled,
  buttons,
  onDismiss,
  onPark,
  onUndo,
  onNeedsWork,
  onResolve,
  showEscapeHatches = true,
  hideDismiss = false,
}: {
  saving: boolean;
  disabled: boolean;
  buttons: ActionButton[];
  onDismiss: () => void;
  onPark: () => void;
  /** When provided AND the primary row carries an accept button,
   *  renders an "Agree, needs work" button beside it. It runs the
   *  same accept/apply as the primary Agree (the draft mutation
   *  still lands) but records the disposition as parked
   *  (status=accepted, resolved_at null) so the finding stays in the
   *  curator's follow-up queue — the work happens later, not inline.
   *  Paul 2026-06-21: "there should be an 'agree but needs work' —
   *  no editing here, the work would be done after accepting it." */
  onNeedsWork?: () => void;
  /** When provided, the finding is currently parked (accepted via
   *  "Agree, needs work" — resolved_at null) and this closes the
   *  two-step accept: stamps resolved_at now. Rendered as a
   *  "Resolve →" button so a parked finding never dead-ends in the
   *  editor. Mirrors the legacy action row's Resolve affordance
   *  (findingCard ``isParked``). */
  onResolve?: () => void;
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
  /** When true, suppress JUST the Dismiss button — Park stays.
   *  Used on "Apply or park" surfaces (factor-add, tag-add) where
   *  Dismiss is redundant with the implicit "didn't apply" verdict
   *  the close-review step will record. Per Paul 2026-05-25. */
  hideDismiss?: boolean;
}) {
  // Review-mode lock — curator can read every proposal but can't
  // act on one. Replace the action row with a faint "read-only"
  // marker so the visual rhythm of the card stays consistent.
  const readOnly = useIsReadOnly();
  if (readOnly) {
    return (
      <div className="pt-1 text-[11px] text-slate-400 italic dark:text-slate-500">
        read-only — open via a calibration package to take action
      </div>
    );
  }
  // If there's nothing for the curator to act on AND we've hidden
  // the escape hatches, the whole row collapses to either the undo
  // affordance (if dispositioned) or nothing at all.
  const hasNothingToRender =
    buttons.length === 0 && !showEscapeHatches && !onUndo;
  if (hasNothingToRender) return null;

  // "Agree, needs work" — accept + apply exactly like the primary
  // Agree, but park the disposition (resolved_at null) so it stays in
  // the follow-up queue. Only meaningful when there's an ENABLED
  // accept button to pair against (a keep-only / reject-only row, or a
  // disabled cross-cutting Adopt, has nothing safe to "agree" to). The
  // amber tone reads as "agreed but not done" without competing with
  // the solid primary Agree. Rendered immediately after that accept
  // button so the two Agree variants sit together. Paul 2026-06-21.
  const acceptIdx = buttons.findIndex(
    (b) => b.kind === "primary-accept" && !b.disabled,
  );
  const needsWorkBtn =
    onNeedsWork && acceptIdx >= 0 ? (
      <button
        key="needs-work"
        type="button"
        onClick={onNeedsWork}
        disabled={saving || disabled}
        title="Agree and apply now, but flag that it still needs work — the finding stays in your follow-up queue (mark it resolved once you've done the work). No editing here."
        className="px-2.5 py-1 rounded text-xs font-semibold bg-blue-500 text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:bg-blue-600 dark:hover:bg-blue-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
      >
        {saving ? "Saving…" : "Agree w/ caveats"}
      </button>
    ) : null;

  return (
    <div className="flex items-center gap-2 pt-1 text-xs flex-wrap">
      {buttons.map((b, i) => {
        const btn = (
          <button
            key={b.key}
            type="button"
            onClick={b.onClick}
            disabled={saving || disabled || b.disabled}
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
        );
        // Slot the amber "Agree, needs work" right after the primary
        // accept so the two Agree variants read as a pair.
        return needsWorkBtn && i === acceptIdx ? (
          <Fragment key={b.key}>
            {btn}
            {needsWorkBtn}
          </Fragment>
        ) : (
          btn
        );
      })}
      {/* Escape hatches — historically rendered Reject + Park
          alongside the primary buttons. Paul 2026-06-14 (and the
          earlier findingCard refactor):
            - When the primary buttons already include the disagree
              action (e.g. "don't remove" sits next to "remove"),
              Reject is redundant — drop it.
            - Park is hidden across the audit/proposal surface until
              the mid-curation handoff flow that needs it lands;
              handlers + dialog stay wired so flipping the gate
              restores the button.
          Reject still shows when the primary row has only ONE
          button (the "Agree-only" surfaces like single-tag add):
          there's no opposite action button there, so the curator
          needs an escape hatch. */}
      {showEscapeHatches && buttons.length < 2 && !hideDismiss ? (
        <>
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <button
            type="button"
            onClick={onDismiss}
            disabled={saving}
            className="px-2.5 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Reject…
          </button>
        </>
      ) : null}
      {/* Park button — gated off via SHOW_PARK_AFFORDANCE (auditPresentation.ts). */}
      {SHOW_PARK_AFFORDANCE && showEscapeHatches ? (
        <button
          type="button"
          onClick={onPark}
          disabled={saving}
          className="px-2.5 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          Park…
        </button>
      ) : null}
      {onResolve ? (
        <button
          type="button"
          onClick={onResolve}
          disabled={saving}
          title="Mark resolved — once you've done the follow-up work. Closes the 'needs work' state."
          className="px-2.5 py-1 rounded text-xs font-semibold border border-emerald-700 text-emerald-700 bg-white hover:bg-emerald-50 disabled:opacity-50 dark:bg-slate-900 dark:border-emerald-400 dark:text-emerald-300 dark:hover:bg-slate-800"
        >
          Resolve →
        </button>
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
