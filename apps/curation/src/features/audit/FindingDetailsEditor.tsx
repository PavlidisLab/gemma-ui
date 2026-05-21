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
import { resolveAgentFactor, resolveGoldFactor } from "./factorMatch";
import { verdictToStructureDetails } from "./dispositionSave";
import { consequentHint, type ConsequentHintState } from "./consequentHint";
import { firstBacktick } from "./rationaleText";
import {
  isSideEmpty,
  lc,
  rowAgreement,
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
  proposer: "Agent",
  // The curator opening the page IS the gold side in every regular
  // audit (their own design draft). "you" anchors the trichotomy
  // better than a generic "current" — when the curator scrolls
  // through 7 disagreements they don't lose track of which side is
  // theirs. For inter-curator-audit packages parsed below, the
  // gold curator's actual name overrides this default.
  goldCurator: "you",
  reference: "Gemma",
};

/** Pull party identities from the audit's ``model`` field. Matches
 *  the inter-curator-audit pattern ("inter-curator audit · X's
 *  curation applied · Y reviews") and otherwise falls back to
 *  generic role names. */
function extractAuditIdentities(
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
  const groupedDisagreements: Row[][] = (() => {
    const groups = new Map<string, Row[]>();
    for (const r of disagreementRows) {
      const k = `${r.fvIndex ?? "f"}.${r.statementIndex ?? "0"}`;
      const list = groups.get(k) ?? [];
      list.push(r);
      groups.set(k, list);
    }
    return Array.from(groups.values());
  })();

  const isRemovalFinding =
    finding.issue_code === "calibration_factor_gold_only_miss" ||
    finding.issue_code === "calibration_gold_only_miss";

  const isPartitionMismatch =
    finding.issue_code === "calibration_factor_partition_mismatch" &&
    finding.partition_mismatch != null;

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

  const hasReferenceData = rows.some((r) => r.reference !== null);
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
    const actionWord = isAgentFiner ? "split" : "combine";
    const agentVerb = identities.proposer === "Agent" ? "says" : "says";
    const goldVerb = identities.goldCurator === "you" ? "have" : "has";
    const keepLabel =
      identities.goldCurator === "you"
        ? "keep yours"
        : `keep ${identities.goldCurator}'s`;
    const acceptLabel = `adopt ${identities.proposer}'s ${actionWord}`;
    const acceptTitle = isAgentFiner
      ? `Split the existing factor along the axis ${identities.proposer} proposed.`
      : `Combine the existing factors into the single factor ${identities.proposer} proposed.`;
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
            <strong>partition mismatch — {identities.proposer} proposes to {actionWord}</strong>
          </span>
        </div>

        {/* Comparator-row lines — identity-first, no FV listing here
            (the mapping block below has the FV detail). */}
        <div className="space-y-1.5">
          <div className="grid grid-cols-[8rem_1fr] gap-x-2 items-baseline text-[12px]">
            <span className="text-slate-600 dark:text-slate-300">
              <strong>{identities.proposer}</strong> {agentVerb}
            </span>
            <span className="flex flex-wrap items-baseline gap-x-1.5">
              <Term
                uri={pm.agent.category.uri}
                asLink={false}
                className="!whitespace-normal break-words"
              >
                {pm.agent.category.label}
              </Term>
              <span className="text-slate-500 dark:text-slate-400 italic">
                {isAgentFiner
                  ? `(${pm.fv_pairs.length} FVs, finer partition)`
                  : `(${groups.length} parents collapsed into 1 factor)`}
              </span>
            </span>
          </div>
          <div className="grid grid-cols-[8rem_1fr] gap-x-2 items-baseline text-[12px]">
            <span className="text-slate-600 dark:text-slate-300">
              <strong>{identities.goldCurator}</strong> {goldVerb}
            </span>
            <span className="flex flex-wrap items-baseline gap-x-1.5">
              <Term
                uri={pm.gold.category.uri}
                asLink={false}
                className="!whitespace-normal break-words"
              >
                {pm.gold.category.label}
              </Term>
              <span className="text-slate-500 dark:text-slate-400 italic">
                {isAgentFiner
                  ? `(${groups.length} FVs, coarser partition)`
                  : `(${pm.fv_pairs.length} FVs across ${groups.length} factor${
                      groups.length === 1 ? "" : "s"
                    })`}
              </span>
              <span
                className="ml-1 text-[10px] uppercase tracking-wide font-semibold text-blue-700 dark:text-blue-300"
                title="This is what's currently on the design tab (the working draft)."
              >
                ← in current design
              </span>
            </span>
          </div>
        </div>

        {/* Mapping block — parent → children rows. Renders the
            nesting that the payload's fv_pairs encode via repeated
            parents. Chips are a compact inline variant (no URI
            annotation, smaller padding) so a parent + several
            children fit on one line; full URI still surfaces via
            the chip's title tooltip. */}
        {groups.length > 0 ? (
          <div className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-900/40">
            <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
              {isAgentFiner ? "Mapping (gold parent ← agent children)" : "Mapping (agent parent ← gold children)"}
            </div>
            <div className="space-y-1 text-[11px]">
              {groups.map((g, i) => (
                <div
                  key={`${g.parent.label}|${g.parent.uri ?? ""}|${i}`}
                  className="flex items-baseline gap-x-1.5 flex-wrap"
                >
                  <MappingChip term={g.parent} />
                  <span className="text-slate-400 dark:text-slate-500">←</span>
                  {g.children.map((c, j) => (
                    <span key={j} className="inline-flex items-baseline">
                      {j > 0 ? (
                        <span className="text-slate-400 dark:text-slate-500 mr-1">
                          ,
                        </span>
                      ) : null}
                      <MappingChip term={c} />
                    </span>
                  ))}
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
              kind: "primary-keep",
              label: keepLabel,
              onClick: () => dispatchSave("currently"),
              title: isAgentFiner
                ? `Keep the existing single factor; reject ${identities.proposer}'s proposal to split.`
                : `Keep the existing separate factors; reject ${identities.proposer}'s proposal to combine.`,
            },
            {
              key: "accept",
              kind: "primary-accept",
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

  // Removal-only findings collapse to keep-vs-remove. No row
  // disagreement model applies.
  if (isRemovalFinding) {
    const keepLabel =
      identities.goldCurator === "you"
        ? "keep yours"
        : `keep ${identities.goldCurator}'s`;
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
    const proposerVerb =
      identities.proposer === "Agent" ? "says" : "says";
    const goldVerb =
      identities.goldCurator === "you" ? "have" : "has";
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
              <strong>{identities.goldCurator}</strong> {goldVerb}
              {/* "in current design" lives in the identity (left)
                  column so it stays adjacent to "you have" even when
                  the FV chips on the right wrap onto multiple lines.
                  Stacked underneath the identity label as a small
                  caption. */}
              <span
                className="block text-[10px] uppercase tracking-wide font-semibold text-blue-700 dark:text-blue-300 mt-0.5"
                title="This is what's currently on the design tab (the working draft)."
              >
                ← in current design
              </span>
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
                          className="text-[10px] text-slate-500 dark:text-slate-400 font-mono"
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
              kind: "primary-keep",
              label: keepLabel,
              onClick: () => dispatchSave("currently"),
            },
            {
              key: "remove",
              kind: "primary-accept",
              label: `accept ${identities.proposer}'s (remove)`,
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

  return (
    <div className="space-y-3 rounded border border-slate-300 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800">
      {/* Title row — replaces the role of the legacy MatchCompareCard
          header. Carries the entity identity (category for factors;
          ``category: value`` for tags) + a count of disagreements
          so the curator sees the scope at a glance. */}
      <div className="flex items-baseline flex-wrap gap-2 text-[12px]">
        <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
          {finding.target_kind === "factor" ? "Factor" : "Tag"}
        </span>
        <span className="font-mono text-slate-800 dark:text-slate-100">
          {(() => {
            // Tag findings carry two rows (Category + Value); the
            // load-bearing identity is the full ``category: value``
            // pair, not just the category. Factor findings put the
            // load-bearing identity on the Category row alone.
            if (finding.target_kind === "tag") {
              const catRow = rows.find((r) => r.rowLabel === "Category");
              const valRow = rows.find((r) => r.rowLabel === "Value");
              if (catRow && valRow) {
                return `${catRow.proposal.label}: ${valRow.proposal.label}`;
              }
            }
            return rows[0]?.proposal.label || finding.target_id;
          })()}
        </span>
        <span className="text-slate-400 dark:text-slate-500">·</span>
        {allAgreeAtCard ? (
          <span className="text-emerald-700 dark:text-emerald-300">
            <strong>everyone agrees</strong> ✓
          </span>
        ) : (
          <span className="text-amber-700 dark:text-amber-300">
            <strong>
              {disagreementRows.length} disagreement
              {disagreementRows.length === 1 ? "" : "s"}
            </strong>
          </span>
        )}
      </div>

      {/* Agreement summary — single line listing the elements where
          all comparators agree, including FV identities + sample
          counts. Shown even when the WHOLE card agrees so the
          curator can see WHICH factor / FVs this finding is about
          (otherwise "FACTOR treatment · everyone agrees ✓" reads as
          "treatment what?"). */}
      {agreementRows.length > 0 ? (
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

      {/* One block per *statement* — Subject/Predicate/Object rows
          that share an FV+statement collapse into a single decision
          block with shared buttons. Category rows are their own
          group (no FV index). Per Paul: "I don't want a separate
          thing for the predicate and another for the object" — the
          statement is one decision, not three. */}
      {groupedDisagreements.map((groupRows) => (
        <DisagreementBlock
          key={`${groupRows[0].fvIndex ?? "f"}.${groupRows[0].statementIndex ?? "0"}.${groupRows[0].path}`}
          rows={groupRows}
          fvMeta={fvMeta}
          identities={identities}
          rowState={rowState}
          onPick={(pick) => {
            for (const row of groupRows) setPick(row.path, { pick });
          }}
          onEditCommit={(label, uri) => {
            // For statement-level edits, the curator's typed value
            // currently lands on the SUBJECT row (the headline of
            // the statement). Predicate/object stay at their current
            // values. Richer per-part edit is a follow-up; the
            // single-input shape covers ~95% of the wrong-subject
            // case Paul described.
            const target =
              groupRows.find((r) => r.rowLabel === "Subject") ??
              groupRows[0];
            setPick(target.path, {
              pick: "edit",
              editLabel: label,
              editUri: uri,
            });
            // Other rows in the group implicitly stay on their
            // current pick (or null) — the curator's edit on the
            // subject doesn't force a stance on the predicate.
          }}
        />
      ))}

      {/* Action row — when all rows agree, this is just Dismiss/Park.
          Otherwise the three header-level verdict buttons +
          per-row-save + Dismiss/Park. */}
      <ActionRow
        saving={saving}
        disabled={currentDisposition !== "pending"}
        buttons={
          allAgreeAtCard
            ? [
                {
                  key: "confirm",
                  kind: "primary-accept",
                  label: "confirm",
                  onClick: () => dispatchSave("currently"),
                  title:
                    "All comparators agree — confirm and close this finding.",
                },
              ]
            : [
                {
                  key: "keep",
                  kind: "primary-keep",
                  label:
                    identities.goldCurator === "you"
                      ? "keep yours"
                      : `keep ${identities.goldCurator}'s`,
                  onClick: () => dispatchSave("currently"),
                  title: `Take ${
                    identities.goldCurator === "you"
                      ? "your"
                      : `${identities.goldCurator}'s`
                  } value on every disagreement.`,
                },
                {
                  key: "accept",
                  kind: "primary-accept",
                  label: `adopt ${identities.proposer}'s`,
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
                {
                  key: "save",
                  kind: "secondary",
                  label: "save per-row picks",
                  onClick: dispatchPerRowSave,
                  title:
                    "Save what's been picked per-row (mix of proposal / kept / edited).",
                },
              ]
        }
        onDismiss={onDismiss}
        onPark={onPark}
        onUndo={currentDisposition !== "pending" ? onUndo : undefined}
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
  fvMeta,
  identities,
  rowState,
  onPick,
  onEditCommit,
}: {
  rows: Row[];
  fvMeta: Map<number, FvMeta>;
  identities: AuditIdentities;
  rowState: Map<string, RowState>;
  onPick: (pick: Pick) => void;
  onEditCommit: (label: string, uri: string | null) => void;
}) {
  if (rows.length === 0) return null;
  const first = rows[0];
  const meta = first.fvIndex !== null ? fvMeta.get(first.fvIndex) : undefined;
  const sampleNote =
    meta && meta.agentSampleCount
      ? meta.goldSampleCount !== null &&
        meta.goldSampleCount !== meta.agentSampleCount
        ? `${meta.agentSampleCount} samples · ${identities.goldCurator === "you" ? "yours" : identities.goldCurator}: ${meta.goldSampleCount}`
        : `${meta.agentSampleCount} samples`
      : null;
  const elementLabel =
    first.fvIndex !== null
      ? `FV ${first.fvIndex + 1}`
      : first.rowLabel;
  // ANY row in the group having reference data → show the reference
  // line + button. Each row's reference can be null even when the
  // statement has one (subject has Gemma, predicate doesn't).
  const hasReference = rows.some((r) => r.reference !== null);

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
  const [editVal, setEditVal] = useState(subjectState?.editLabel ?? "");

  // Pretty button label for keep — "keep yours" reads better than
  // "keep you's".
  const keepLabel =
    identities.goldCurator === "you"
      ? "keep yours"
      : `keep ${identities.goldCurator}'s`;

  return (
    <div className="rounded border border-amber-200 bg-amber-50/30 dark:border-amber-800/60 dark:bg-amber-900/15 p-2 space-y-1.5">
      <div className="text-[11px] uppercase tracking-wide font-semibold text-amber-800 dark:text-amber-300 flex items-baseline gap-2">
        <span>{elementLabel}</span>
        {sampleNote ? (
          <span className="font-normal normal-case tracking-normal text-slate-500 dark:text-slate-400">
            ({sampleNote})
          </span>
        ) : null}
      </div>

      <ComparatorLine
        who={identities.proposer}
        verb="said"
        rows={rows}
        side="proposal"
        picked={blockPick === "proposal"}
      />
      <ComparatorLine
        who={identities.goldCurator}
        verb={identities.goldCurator === "you" ? "have" : "has"}
        rows={rows}
        side="currently"
        picked={blockPick === "currently"}
        isActiveInDesign
      />
      {hasReference ? (
        <ComparatorLine
          who={identities.reference}
          verb="has"
          rows={rows}
          side="reference"
          picked={blockPick === "reference"}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
        <PickButton
          active={blockPick === "currently"}
          onClick={() => onPick("currently")}
          tone="keep"
        >
          {keepLabel}
        </PickButton>
        <PickButton
          active={blockPick === "proposal"}
          onClick={() => onPick("proposal")}
          tone="accept"
        >
          adopt {identities.proposer}'s
        </PickButton>
        {hasReference ? (
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
          onClick={() => {
            setEditOpen((v) => !v);
            if (!editOpen) setEditVal(subjectState?.editLabel ?? "");
          }}
          className={cn(
            "px-2 py-0.5 rounded border text-[11px]",
            subjectState?.pick === "edit"
              ? "bg-violet-100 border-violet-400 text-violet-900 dark:bg-violet-900/40 dark:border-violet-600 dark:text-violet-100 font-semibold"
              : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700",
          )}
          title="None of the choices is right — type the correct value (label-only; lands on subject)."
        >
          edit…
        </button>
      </div>

      {editOpen ? (
        <div className="pt-1 space-y-1">
          <input
            type="text"
            value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            placeholder="Type the correct value (label-only for now; ontology picker coming)"
            className="w-full text-[11px] px-1.5 py-0.5 rounded border border-violet-300 dark:border-violet-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
          />
          <div className="flex gap-1.5 text-[11px]">
            <button
              type="button"
              onClick={() => {
                onEditCommit(editVal, null);
                setEditOpen(false);
              }}
              disabled={!editVal.trim()}
              className="px-2 py-0.5 rounded bg-violet-700 text-white font-semibold hover:bg-violet-800 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed"
            >
              save edit
            </button>
            <button
              type="button"
              onClick={() => {
                setEditOpen(false);
                setEditVal("");
              }}
              className="px-2 py-0.5 rounded border border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              cancel
            </button>
          </div>
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
function ComparatorLine({
  who,
  verb,
  rows,
  side,
  picked,
  isActiveInDesign,
}: {
  who: string;
  verb: string;
  rows: Row[];
  side: "proposal" | "currently" | "reference";
  picked: boolean;
  /** True when this comparator's value is the one currently
   *  visible on the design tab (i.e. the gold-curator's row).
   *  Adds a small "← in your design" suffix so the curator can
   *  see at a glance which line maps to what they have open on
   *  the left side of the screen. */
  isActiveInDesign?: boolean;
}) {
  // Sort within the group by part order: Subject → Predicate →
  // Object → (anything else, e.g. Category alone).
  const ORDER = ["Category", "Subject", "Predicate", "Object"];
  const sorted = [...rows].sort(
    (a, b) => ORDER.indexOf(a.rowLabel) - ORDER.indexOf(b.rowLabel),
  );
  const parts: { value: SideValue; partLabel: string }[] = [];
  for (const r of sorted) {
    const v =
      side === "proposal"
        ? r.proposal
        : side === "currently"
          ? r.currently
          : r.reference;
    if (v && v.label) {
      parts.push({ value: v, partLabel: r.rowLabel });
    }
  }
  return (
    <div
      className={cn(
        "grid grid-cols-[6rem_1fr] gap-x-2 items-baseline text-[12px]",
        picked && "rounded bg-blue-50 dark:bg-blue-900/30 px-1 py-0.5",
      )}
    >
      <span className="text-slate-600 dark:text-slate-300">
        <strong>{who}</strong> {verb}
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
            // Predicates render small + muted, no chip styling —
            // they're structural plumbing (e.g. "has_genotype"
            // between subject and object). Gemma's own per-FV
            // display uses the same teeny-predicate convention.
            if (p.partLabel === "Predicate") {
              return (
                <span key={p.partLabel} className="inline-flex items-baseline">
                  {sep}
                  <span
                    className="text-[10px] text-slate-500 dark:text-slate-400 font-mono"
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
        {isActiveInDesign ? (
          <span
            className="ml-1 text-[10px] uppercase tracking-wide font-semibold text-blue-700 dark:text-blue-300"
            title="This is what's currently on the design tab (the working draft)."
          >
            ← in current design
          </span>
        ) : null}
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
        "inline-flex items-center px-1 py-0 rounded text-[11px] leading-[1.3rem] border",
        hasUri
          ? "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-700"
          : "bg-stone-50 text-stone-600 border-stone-200 italic dark:bg-stone-800 dark:text-stone-300 dark:border-stone-600",
      )}
    >
      {term.label}
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
      <div className="flex items-baseline flex-wrap gap-2 rounded border border-sky-300 bg-sky-50 px-2.5 py-1.5 text-[11px] text-sky-900 dark:border-sky-700 dark:bg-sky-900/30 dark:text-sky-100">
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
}) {
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
      <span className="text-slate-300 dark:text-slate-600">·</span>
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

function PickButton({
  active,
  onClick,
  tone,
  children,
}: {
  active: boolean;
  onClick: () => void;
  tone: "keep" | "accept" | "ref";
  children: React.ReactNode;
}) {
  const activeCls = {
    keep: "bg-emerald-700 text-white border-emerald-700",
    accept: "bg-blue-700 text-white border-blue-700",
    ref: "bg-sky-700 text-white border-sky-700",
  }[tone];
  const inactiveCls = {
    keep:
      "border-emerald-400 text-emerald-800 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/30",
    accept:
      "border-blue-400 text-blue-800 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-900/30",
    ref: "border-sky-400 text-sky-800 hover:bg-sky-50 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-900/30",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2 py-0.5 rounded border text-[11px] font-semibold",
        active ? activeCls : inactiveCls,
      )}
    >
      {children}
    </button>
  );
}
