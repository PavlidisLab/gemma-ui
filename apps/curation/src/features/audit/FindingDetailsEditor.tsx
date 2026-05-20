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
 * Reference data (Gemma snapshot) is not separately stored
 * locally yet — until §1 design-per-batch ships, the Reference
 * column populates as null and the third button is suppressed.
 * The shape is built to accept it the moment data flows in.
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
} from "@/api/auditTypes";
import type {
  Design,
  Factor,
  Statement,
} from "@/features/experiment/types";
import type { FactorValueProposal } from "@/api/types";
import { resolveAgentFactor, resolveGoldFactor } from "./factorMatch";

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
  goldCurator: "current",
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

interface SideValue {
  label: string;
  uri: string | null;
}

function lc(s: string | null | undefined): string {
  return (s || "").toLowerCase().trim();
}

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
  if (!st) return { label: "", uri: null };
  const s = st as unknown as Statement;
  return statementPart(s, part);
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
      return st ? statementPart(st, part) : null;
    }
  }
  return null;
}

function sidesAgree(a: SideValue | null, b: SideValue | null): boolean {
  if (a === null && b === null) return true;
  if (!a || !b) return false;
  if (a.uri && b.uri && a.uri === b.uri) return true;
  if (lc(a.label) === lc(b.label)) return true;
  return false;
}

function isSideEmpty(s: SideValue | null): boolean {
  if (!s) return true;
  return !s.label && !s.uri;
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

function rowAgreement(
  proposal: SideValue,
  currently: SideValue | null,
  reference: SideValue | null,
): boolean {
  const sides: SideValue[] = [proposal];
  if (currently && !isSideEmpty(currently)) sides.push(currently);
  if (reference && !isSideEmpty(reference)) sides.push(reference);
  if (sides.length <= 1) {
    // Single comparator → no disagreement possible.
    return true;
  }
  for (let i = 1; i < sides.length; i++) {
    if (!sidesAgree(sides[0], sides[i])) return false;
  }
  return true;
}

function buildFactorRows(
  finding: AuditFinding,
  report: AuditReport | null,
  design: Design | null,
): BuildResult {
  const cp = report?.evidence?.comparison_proposal ?? null;
  const labelHint = finding.rationale?.match(/`([^`]+)`/)?.[1] ?? null;
  const agent = resolveAgentFactor(finding, cp, labelHint);
  if (!agent) return { rows: [], fvMeta: new Map() };
  const gold = resolveGoldFactor(finding, design?.factors ?? [], labelHint);

  const rows: Row[] = [];
  const fvMeta = new Map<number, FvMeta>();

  // Category row.
  {
    const proposal: SideValue = {
      label: agent.category.label || "",
      uri: agent.category.uri ?? null,
    };
    const currently: SideValue | null = gold
      ? { label: gold.category.label || "", uri: gold.category.uri ?? null }
      : null;
    // Reference (Gemma) snapshot not separately stored locally yet.
    const reference: SideValue | null = null;
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

    const partOrder: Array<"subject" | "predicate" | "object"> = [
      "subject",
      "predicate",
      "object",
    ];
    for (const part of partOrder) {
      const proposal = fvProposalStatementPart(fv, part);
      const currently = pairAgentStatementToGold(fv, gold, part);
      const reference: SideValue | null = null;
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

function buildTagRows(finding: AuditFinding): Row[] {
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
  return [
    {
      path: "tag.category",
      rowLabel: "Category",
      proposal: categoryProposal,
      currently: null,
      reference: null,
      fvIndex: null,
      statementIndex: null,
      allAgree: rowAgreement(categoryProposal, null, null),
    },
    {
      path: "tag.value",
      rowLabel: "Value",
      proposal: valueProposal,
      currently: null,
      reference: null,
      fvIndex: null,
      statementIndex: null,
      allAgree: rowAgreement(valueProposal, null, null),
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
    return { rows: buildTagRows(finding), fvMeta: new Map() };
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
  if (finding.target_kind === "factor") {
    const cp = report?.evidence?.comparison_proposal ?? null;
    const labelHint = finding.rationale?.match(/`([^`]+)`/)?.[1] ?? null;
    const agent = resolveAgentFactor(finding, cp, labelHint);
    if (agent) return true;
    const gold = resolveGoldFactor(finding, design?.factors ?? [], labelHint);
    return !!gold;
  }
  if (finding.target_kind === "tag") {
    return !!finding.proposer_term || finding.target_id.startsWith("calibration:");
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

  const isRemovalFinding =
    finding.issue_code === "calibration_factor_gold_only_miss" ||
    finding.issue_code === "calibration_gold_only_miss";

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
      let structureOk: boolean | null = true;
      let detailsOk: boolean | null = true;
      if (verdict === "currently") {
        structureOk = false;
        detailsOk = null;
      }
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

  // Removal-only findings collapse to keep-vs-remove. No row
  // disagreement model applies.
  if (isRemovalFinding) {
    return (
      <div className="space-y-3 rounded border border-slate-300 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800">
        <div className="text-[12px] text-slate-700 dark:text-slate-200">
          <strong>{identities.proposer}</strong> proposes removing this
          factor.{" "}
          <em>{identities.goldCurator}</em> currently has it.
        </div>
        <ActionRow
          saving={saving}
          disabled={currentDisposition === "dismissed"}
          buttons={[
            {
              key: "keep",
              kind: "primary-keep",
              label: `keep ${identities.goldCurator}'s`,
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
        />
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded border border-slate-300 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800">
      {/* Title row — replaces the role of the legacy MatchCompareCard
          header. Carries the factor's category + a count of
          disagreements so the curator sees the scope at a glance. */}
      <div className="flex items-baseline flex-wrap gap-2 text-[12px]">
        <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
          {finding.target_kind === "factor" ? "Factor" : "Tag"}
        </span>
        <span className="font-mono text-slate-800 dark:text-slate-100">
          {rows[0]?.proposal.label || finding.target_id}
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
          all comparators agree. Skipped when the card has nothing in
          disagreement (the title row's "everyone agrees ✓" carries
          the same message). */}
      {agreementRows.length > 0 && !allAgreeAtCard ? (
        <AgreementSummary rows={agreementRows} fvMeta={fvMeta} />
      ) : null}

      {/* One block per disagreement. */}
      {disagreementRows.map((row) => (
        <DisagreementBlock
          key={row.path}
          row={row}
          fvMeta={fvMeta}
          identities={identities}
          state={rowState.get(row.path) ?? freshRowState()}
          onPick={(pick) => setPick(row.path, { pick })}
          onEditCommit={(label, uri) =>
            setPick(row.path, { pick: "edit", editLabel: label, editUri: uri })
          }
        />
      ))}

      {/* Action row — when all rows agree, this is just Dismiss/Park.
          Otherwise the three header-level verdict buttons +
          per-row-save + Dismiss/Park. */}
      <ActionRow
        saving={saving}
        disabled={currentDisposition === "dismissed"}
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
                  label: `keep ${identities.goldCurator}'s`,
                  onClick: () => dispatchSave("currently"),
                  title: `Take ${identities.goldCurator}'s value on every disagreement.`,
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
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AgreementSummary({
  rows,
  fvMeta,
}: {
  rows: Row[];
  fvMeta: Map<number, FvMeta>;
}) {
  // Group agreed-rows by fvIndex for compact rendering.
  const factorRows = rows.filter((r) => r.fvIndex === null);
  const byFv = new Map<number, Row[]>();
  for (const r of rows) {
    if (r.fvIndex !== null) {
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

function DisagreementBlock({
  row,
  fvMeta,
  identities,
  state,
  onPick,
  onEditCommit,
}: {
  row: Row;
  fvMeta: Map<number, FvMeta>;
  identities: AuditIdentities;
  state: RowState;
  onPick: (pick: Pick) => void;
  onEditCommit: (label: string, uri: string | null) => void;
}) {
  const meta = row.fvIndex !== null ? fvMeta.get(row.fvIndex) : undefined;
  const sampleNote =
    meta && meta.agentSampleCount
      ? meta.goldSampleCount !== null &&
        meta.goldSampleCount !== meta.agentSampleCount
        ? `${meta.agentSampleCount} samples · ${identities.goldCurator} has ${meta.goldSampleCount}`
        : `${meta.agentSampleCount} samples`
      : null;
  const elementLabel =
    row.fvIndex !== null
      ? `FV ${row.fvIndex + 1} ${row.rowLabel.toLowerCase()}`
      : row.rowLabel;
  const hasReference = row.reference !== null;

  // Inline edit state — typed value before commit. Mirrors the
  // ``editLabel`` already on RowState so the box is controlled.
  const [editOpen, setEditOpen] = useState(state.pick === "edit");
  const [editVal, setEditVal] = useState(state.editLabel);

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

      <SideLine
        who={identities.proposer}
        verb="said"
        value={row.proposal}
        picked={state.pick === "proposal"}
      />
      {row.currently ? (
        <SideLine
          who={identities.goldCurator}
          verb="has"
          value={row.currently}
          picked={state.pick === "currently"}
        />
      ) : (
        <SideLine
          who={identities.goldCurator}
          verb="has"
          value={null}
          picked={state.pick === "currently"}
        />
      )}
      {hasReference ? (
        <SideLine
          who={identities.reference}
          verb="has"
          value={row.reference}
          picked={state.pick === "reference"}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
        <PickButton
          active={state.pick === "currently"}
          onClick={() => onPick("currently")}
          tone="keep"
        >
          keep {identities.goldCurator}'s
        </PickButton>
        <PickButton
          active={state.pick === "proposal"}
          onClick={() => onPick("proposal")}
          tone="accept"
        >
          adopt {identities.proposer}'s
        </PickButton>
        {hasReference ? (
          <PickButton
            active={state.pick === "reference"}
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
            if (!editOpen) setEditVal(state.editLabel);
          }}
          className={cn(
            "px-2 py-0.5 rounded border text-[11px]",
            state.pick === "edit"
              ? "bg-violet-100 border-violet-400 text-violet-900 dark:bg-violet-900/40 dark:border-violet-600 dark:text-violet-100 font-semibold"
              : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700",
          )}
          title="None of the choices is right — type the correct value."
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

function SideLine({
  who,
  verb,
  value,
  picked,
}: {
  who: string;
  verb: string;
  value: SideValue | null;
  picked: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[8rem_1fr] gap-x-2 items-baseline text-[12px]",
        picked && "rounded bg-blue-50 dark:bg-blue-900/30 px-1 py-0.5",
      )}
    >
      <span className="text-slate-600 dark:text-slate-300">
        <strong>{who}</strong> {verb}
      </span>
      <span className="truncate">
        {value && value.label ? (
          <Term uri={value.uri ?? null} asLink={false}>
            {value.label}
          </Term>
        ) : value === null ? (
          <span className="italic text-slate-400">no entry</span>
        ) : (
          <span className="italic text-slate-400">—</span>
        )}
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

function ActionRow({
  saving,
  disabled,
  buttons,
  onDismiss,
  onPark,
}: {
  saving: boolean;
  disabled: boolean;
  buttons: ActionButton[];
  onDismiss: () => void;
  onPark: () => void;
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
