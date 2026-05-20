/**
 * Per-element 2-axis disposition editor.
 *
 * Replaces the single Agree / Dismiss / Park button row on findings
 * that have resolvable structured content (factor proposals + tag
 * proposals). The curator can flag each individual element —
 * category, per-FV label, per-statement subject/predicate/object —
 * as ✓ or ✗, and edit the labels inline.
 *
 * Wire shape lives in HANDOFF_2026-05-19_INTER_CURATOR_AUDIT_FOLLOWUPS
 * §2 (structure_ok / details_ok on `AuditFindingDisposition`,
 * landed in agents repo commit 9eb5dfa) and the UI-Claude reply
 * below ($applied_fix structured payload$). Until the structured
 * applied_fix shape ships, this component serialises its output
 * as a JSON-stringified ``AppliedFix`` into the existing string
 * field; the server treats it as opaque text.
 *
 * Findings without a resolvable agent proposal (no
 * comparison_proposal entry, missing proposer_term on tag side)
 * fall through to the legacy single-button DispositionBar — see
 * the gating helper ``findingHasStructuredContent`` exported at
 * the bottom.
 */
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/Toast";
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
// Row model
// ---------------------------------------------------------------------------

/** One editable row in the per-element table. The ``path`` follows
 *  the convention documented in the UI-Claude reply on the handoff
 *  doc:
 *    - ``factor.category.label`` / ``factor.category.uri``
 *    - ``fv[i].label``                — free_text_label
 *    - ``fv[i].statements[j].subject``   (carries label + uri)
 *    - ``fv[i].statements[j].predicate``
 *    - ``fv[i].statements[j].object``
 *    - ``tag.category`` / ``tag.value``  (each carries label + uri)
 *
 *  The path is the load-bearing identity for an applied_fix edit. */
interface Row {
  path: string;
  /** UI label for the row's left-hand column — "Category", "Label",
   *  "Subject", etc. The grouping into FV blocks happens at render
   *  time off ``fvIndex``. */
  rowLabel: string;
  agent: { label: string; uri: string | null };
  /** Gold-side counterpart for the side-by-side diff column. ``null``
   *  when no gold counterpart resolved (proposal is an add). */
  gold: { label: string; uri: string | null } | null;
  /** Which FV this row belongs to (0-indexed). ``null`` for
   *  factor-level rows like Category. */
  fvIndex: number | null;
  /** Which statement within the FV (0-indexed). ``null`` for
   *  non-statement rows. */
  statementIndex: number | null;
  /** Whether agent's label/uri equals gold's. Computed at row build
   *  time; drives the ``= / ≠`` diff cue. ``null`` when no gold to
   *  compare against. */
  matchesGold: boolean | null;
}

/** Per-row curator state. Untouched rows carry ``ok=null`` and
 *  ``edited=false``. */
interface RowEditState {
  ok: boolean | null;
  /** Live label value in the input. Initialised to agent's label;
   *  user typing updates it. */
  toLabel: string;
  /** ``true`` when ``toLabel`` differs from agent's label. */
  edited: boolean;
}

// ---------------------------------------------------------------------------
// Public gating helper
// ---------------------------------------------------------------------------

/** Returns ``true`` when the finding has enough structured content
 *  for the 2-axis editor to render meaningful rows. Factor findings
 *  need a resolvable agent proposal AND a gold counterpart (or
 *  acceptance of "this is an add", which still has agent-only rows).
 *  Tag findings need either a ``proposer_term`` (calibration_agent_extra)
 *  or a parseable target_id (calibration_gold_only_miss). */
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
    // gold_only_miss with no agent — we can still render the gold-side
    // rows in read-only mode (curator confirms removal).
    const gold = resolveGoldFactor(finding, design?.factors ?? [], labelHint);
    return !!gold;
  }
  if (finding.target_kind === "tag") {
    return !!finding.proposer_term || finding.target_id.startsWith("calibration:");
  }
  return false;
}

// ---------------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------------

function lc(s: string | null | undefined): string {
  return (s || "").toLowerCase().trim();
}

function statementPart(
  st: Statement,
  part: "subject" | "predicate" | "object",
): { label: string; uri: string | null } {
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
): { label: string; uri: string | null } {
  // FactorValueProposal carries ``statements: StatementProposal[]``
  // — same shape as Statement (category/subject/predicate/object)
  // but Pydantic-mirrored as a different interface in api/types.ts.
  const st = fv.statements?.[0];
  if (!st) return { label: "", uri: null };
  // Read with permissive ``any`` because StatementProposal and
  // Statement carry the same shape with slightly different optional
  // markers — narrowing via the runtime structure keeps both happy.
  const s = st as unknown as Statement;
  return statementPart(s, part);
}

function pairAgentStatementToGold(
  agentFv: FactorValueProposal,
  gold: Factor | null,
  part: "subject" | "predicate" | "object",
): { label: string; uri: string | null } | null {
  if (!gold) return null;
  const agentBms = new Set(agentFv.biomaterial_short_names || []);
  for (const goldFv of gold.factor_values) {
    const gBms = new Set(goldFv.biomaterial_short_names || []);
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
      if (!st) return null;
      return statementPart(st, part);
    }
  }
  return null;
}

function rowMatches(
  agent: { label: string; uri: string | null },
  gold: { label: string; uri: string | null } | null,
): boolean | null {
  if (!gold) return null;
  // Labels-equal beats URI-equal — same human surface should read
  // ``=`` regardless of which ontology URI each side resolved to.
  // The opposite ordering (URI first) flagged "Homozygous negative"
  // ≠ "Homozygous negative" when agent + gold picked different
  // canonical URIs for the same term.
  if (lc(agent.label) === lc(gold.label)) return true;
  if (agent.uri && gold.uri && agent.uri === gold.uri) return true;
  return false;
}

/** Per-FV metadata sidecar — sample partition sizes for both
 *  agent and gold. Rendered in the FV-block header so the curator
 *  can see how many samples each level covers (and whether the
 *  partition sizes match across agent and gold) without scanning
 *  the rows. */
interface FvMeta {
  /** Number of biomaterials assigned to the agent's FV. */
  agentSampleCount: number;
  /** Number assigned to the paired gold FV; null when no gold
   *  counterpart resolved. */
  goldSampleCount: number | null;
}

interface FactorRowsResult {
  rows: Row[];
  fvMeta: Map<number, FvMeta>;
}

function buildFactorRows(
  finding: AuditFinding,
  report: AuditReport | null,
  design: Design | null,
): FactorRowsResult {
  const cp = report?.evidence?.comparison_proposal ?? null;
  const labelHint = finding.rationale?.match(/`([^`]+)`/)?.[1] ?? null;
  const agent = resolveAgentFactor(finding, cp, labelHint);
  if (!agent) return { rows: [], fvMeta: new Map() };
  const gold = resolveGoldFactor(finding, design?.factors ?? [], labelHint);

  const rows: Row[] = [];
  const fvMeta = new Map<number, FvMeta>();

  // Category row.
  {
    const agentSide = {
      label: agent.category.label || "",
      uri: agent.category.uri ?? null,
    };
    const goldSide = gold
      ? { label: gold.category.label || "", uri: gold.category.uri ?? null }
      : null;
    rows.push({
      path: "factor.category",
      rowLabel: "Category",
      agent: agentSide,
      gold: goldSide,
      fvIndex: null,
      statementIndex: null,
      matchesGold: rowMatches(agentSide, goldSide),
    });
  }

  // Per-FV rows. Label row dropped — `free_text_label` is a
  // generated surface; statement parts (subject/predicate/object)
  // are the load-bearing comparison. See feedback 2026-05-19.
  agent.factor_values.forEach((fv, fvIdx) => {
    const pairedGoldFv = pairAgentGoldFv(fv, gold);
    fvMeta.set(fvIdx, {
      agentSampleCount: fv.biomaterial_short_names?.length ?? 0,
      goldSampleCount: pairedGoldFv
        ? pairedGoldFv.biomaterial_short_names.length
        : null,
    });

    // Statement parts. v1 only inspects ``statements[0]`` —
    // multi-statement FVs are rare and add later if needed.
    // Predicate + Object rows render only when at least one side
    // (agent or gold) has a non-empty value; degenerate FVs
    // (wild-type / single-term tags) collapse to just the Subject
    // row.
    const partOrder: Array<"subject" | "predicate" | "object"> = [
      "subject",
      "predicate",
      "object",
    ];
    for (const part of partOrder) {
      const agentSide = fvProposalStatementPart(fv, part);
      const goldSide = pairAgentStatementToGold(fv, gold, part);
      // Always render subject; skip predicate/object when both
      // sides are empty (no content for the curator to flag).
      if (part !== "subject") {
        const agentEmpty = !agentSide.label && !agentSide.uri;
        const goldEmpty = !goldSide || (!goldSide.label && !goldSide.uri);
        if (agentEmpty && goldEmpty) continue;
      }
      rows.push({
        path: `fv[${fvIdx}].statements[0].${part}`,
        rowLabel: part[0].toUpperCase() + part.slice(1),
        agent: agentSide,
        gold: goldSide,
        fvIndex: fvIdx,
        statementIndex: 0,
        matchesGold: rowMatches(agentSide, goldSide),
      });
    }
  });

  return { rows, fvMeta };
}

/** Pair an agent FV to the gold FV that covers the same biomaterial
 *  set. Same logic the row builders use internally — extracted so
 *  the FV-meta sidecar can read the paired gold FV's sample count. */
function pairAgentGoldFv(
  agentFv: FactorValueProposal,
  gold: Factor | null,
): { biomaterial_short_names: string[]; free_text_label: string } | null {
  if (!gold) return null;
  const agentBms = new Set(agentFv.biomaterial_short_names || []);
  for (const goldFv of gold.factor_values) {
    const gBms = new Set(goldFv.biomaterial_short_names || []);
    if (gBms.size !== agentBms.size) continue;
    let allIn = true;
    for (const bm of agentBms) {
      if (!gBms.has(bm)) {
        allIn = false;
        break;
      }
    }
    if (allIn) {
      return {
        biomaterial_short_names: goldFv.biomaterial_short_names ?? [],
        free_text_label: goldFv.free_text_label ?? "",
      };
    }
  }
  // Label fallback for the meta — biomaterial counts on a label-
  // matched gold FV are at least informative.
  const labelHit = gold.factor_values.find(
    (g) => lc(g.free_text_label) === lc(agentFv.free_text_label),
  );
  return labelHit
    ? {
        biomaterial_short_names: labelHit.biomaterial_short_names ?? [],
        free_text_label: labelHit.free_text_label ?? "",
      }
    : null;
}

function buildTagRows(finding: AuditFinding): Row[] {
  // Parse target_id for category + value. Format set by agents-side
  // build_calibration_batch.py: ``calibration:<status>:<category>/<value>``.
  if (!finding.target_id.startsWith("calibration:")) return [];
  const rest = finding.target_id.slice("calibration:".length);
  const colon = rest.indexOf(":");
  if (colon === -1) return [];
  const tail = rest.slice(colon + 1);
  const slash = tail.indexOf("/");
  if (slash === -1) return [];
  const agentCategory = tail.slice(0, slash);
  const agentValue = tail.slice(slash + 1);
  // Proposer term carries the resolved value-side ontology term;
  // ``proposer_defense`` would carry per-attribute provenance but
  // for v1 we just surface category + value.
  const term = finding.proposer_term ?? null;

  const rows: Row[] = [
    {
      path: "tag.category",
      rowLabel: "Category",
      agent: { label: agentCategory, uri: null },
      gold: null,
      fvIndex: null,
      statementIndex: null,
      matchesGold: null,
    },
    {
      path: "tag.value",
      rowLabel: "Value",
      agent: {
        label: term?.label || agentValue,
        uri: term?.uri ?? null,
      },
      gold: null,
      fvIndex: null,
      statementIndex: null,
      matchesGold: null,
    },
  ];
  return rows;
}

interface BuildResult {
  rows: Row[];
  fvMeta: Map<number, FvMeta>;
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
// applied_fix payload construction
// ---------------------------------------------------------------------------

/** Build the structured applied_fix from the per-row state. Only
 *  rows the curator touched (ok !== null OR edited === true) are
 *  serialised — leaves the wire payload tight. Types live in
 *  ``@/api/auditTypes`` (``AppliedFix`` / ``AppliedEdit``) mirroring
 *  bro's Pydantic shape. */
function buildAppliedFix(
  rows: Row[],
  state: Map<string, RowEditState>,
): AppliedFix {
  const edits: AppliedEdit[] = [];
  for (const row of rows) {
    const s = state.get(row.path);
    if (!s) continue;
    const touched = s.ok !== null || s.edited;
    if (!touched) continue;
    const edit: AppliedEdit = {
      path: row.path,
      ok: s.ok,
      from_label: row.agent.label,
      from_uri: row.agent.uri,
    };
    if (s.edited && s.toLabel !== row.agent.label) {
      edit.to_label = s.toLabel;
    }
    edits.push(edit);
  }
  return { kind: "details_edit", edits };
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
  /** Called when the curator clicks "Save edits". Payload carries
   *  the structured ``AppliedFix`` object directly (bro shipped the
   *  union typing on the wire in agents commit ``e9e52ea``).
   *  ``structure_ok`` is the card-level axis; ``details_ok`` is
   *  derived from per-row state (true iff every touched row is ✓). */
  onSave: (
    appliedFix: AppliedFix,
    structureOk: boolean | null,
    detailsOk: boolean | null,
  ) => Promise<void>;
  onDismiss: () => void;
  onPark: () => void;
}) {
  const toast = useToast();
  const { rows, fvMeta } = useMemo(
    () => buildRows(finding, report, design),
    [finding, report, design],
  );
  // Per-row state — keyed by path. Initialised lazily on first
  // touch; rows the curator hasn't interacted with stay out of the
  // map (treated as untouched / ok=null).
  const [rowState, setRowState] = useState<Map<string, RowEditState>>(
    new Map(),
  );
  // Structure axis. Inferred default from issue_code (per
  // §2 of the handoff doc): match codes pre-confirm structure=true;
  // extra/gold_only_miss start at null.
  const inferredStructureOk = useMemo<boolean | null>(() => {
    const code = finding.issue_code;
    if (
      code === "calibration_factor_match_exact" ||
      code === "calibration_factor_match_near" ||
      code === "calibration_factor_rename" ||
      code === "calibration_match"
    ) {
      return true;
    }
    return null;
  }, [finding.issue_code]);
  const [structureOk, setStructureOk] = useState<boolean | null>(
    inferredStructureOk,
  );
  const [saving, setSaving] = useState(false);
  // Per-FV expanded state. Default: an FV-block where every row
  // matches gold collapses to a single "all match" line; everything
  // else expands. Curator clicks the collapsed header to expand,
  // or the expanded header to re-collapse. Decisions persist while
  // the editor is mounted but reset on finding change.
  const [fvExpanded, setFvExpanded] = useState<Map<number, boolean>>(
    new Map(),
  );

  // Derived: aggregated details_ok across rows the curator touched.
  // null until any row is touched; false if any touched row is ✗;
  // true if every touched row is ✓.
  const detailsOk = useMemo<boolean | null>(() => {
    let any = false;
    let allOk = true;
    for (const s of rowState.values()) {
      if (s.ok === null && !s.edited) continue;
      any = true;
      if (s.ok === false || s.edited) {
        allOk = false;
      }
    }
    if (!any) return null;
    return allOk;
  }, [rowState]);

  function getRow(path: string, agentLabel: string): RowEditState {
    return (
      rowState.get(path) ?? {
        ok: null,
        toLabel: agentLabel,
        edited: false,
      }
    );
  }

  function setRow(path: string, patch: Partial<RowEditState>): void {
    setRowState((prev) => {
      const next = new Map(prev);
      const row = rows.find((r) => r.path === path);
      const base =
        next.get(path) ?? {
          ok: null,
          toLabel: row?.agent.label || "",
          edited: false,
        };
      next.set(path, { ...base, ...patch });
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const applied = buildAppliedFix(rows, rowState);
      await onSave(applied, structureOk, detailsOk);
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

  /** "Accept agent" — the curator's "agent's proposal is right,
   *  apply it as-is" verdict. Sets structure_ok=true,
   *  details_ok=true, empty edits — no per-row corrections.
   *  Downstream apply-handlers do the actual mutation (add factor /
   *  rename / remove) based on the finding's issue_code; the wire
   *  just records the verdict. */
  async function acceptAgent() {
    setSaving(true);
    try {
      const applied: AppliedFix = { kind: "details_edit", edits: [] };
      await onSave(applied, true, true);
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

  /** "Keep gold" — the curator's "existing curation is right, don't
   *  change anything" verdict. The single most common call on a
   *  finding when the agent's proposal is wrong; bypasses the
   *  per-row clicking entirely. Semantics depend on the finding's
   *  ``issue_code``:
   *
   *  - ``*_match_*`` / ``*_rename``: confirm gold's labels stand —
   *    structure_ok=true, details_ok=true, no applied_fix edits.
   *    Maps to ``accepted/resolved``.
   *  - ``*_extra`` (agent says ADD): don't add — structure_ok=false,
   *    details_ok=null. Maps to ``dismissed`` with a structural-
   *    rationale ``applied_fix(kind="structural")``.
   *  - ``*_gold_only_miss`` (gold has X agent didn't propose):
   *    keep X — structure_ok=false (don't honour the removal),
   *    details_ok=null. Maps to ``dismissed``.
   *
   *  Saves immediately; no curator confirmation step. The dismiss-
   *  reason chip dialog gets skipped because "keep gold" carries
   *  the rationale on its own. */
  async function keepGold() {
    setSaving(true);
    try {
      const code = finding.issue_code;
      const isMatch =
        code === "calibration_factor_match_exact" ||
        code === "calibration_factor_match_near" ||
        code === "calibration_factor_rename" ||
        code === "calibration_match";
      const isExtra =
        code === "calibration_factor_extra" ||
        code === "calibration_agent_extra";
      const isMiss =
        code === "calibration_factor_gold_only_miss" ||
        code === "calibration_gold_only_miss";
      let nextStructureOk: boolean | null = null;
      let nextDetailsOk: boolean | null = null;
      let applied: AppliedFix;
      if (isMatch) {
        nextStructureOk = true;
        nextDetailsOk = true;
        applied = { kind: "details_edit", edits: [] };
      } else if (isExtra || isMiss) {
        nextStructureOk = false;
        applied = {
          kind: "structural",
          note: isExtra
            ? "Keep gold — agent's proposed addition is wrong."
            : "Keep gold — existing curation stands.",
          edits: [],
        };
      } else {
        // Conservative default: treat as "agent's proposal is
        // wrong" → dismiss with structural note.
        nextStructureOk = false;
        applied = {
          kind: "structural",
          note: "Keep gold — existing curation is correct.",
        };
      }
      await onSave(applied, nextStructureOk, nextDetailsOk);
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

  // Group rows by FV for the FV-block rendering.
  const factorRows = rows.filter((r) => r.fvIndex === null);
  const fvBuckets = new Map<number, Row[]>();
  for (const r of rows) {
    if (r.fvIndex !== null) {
      const list = fvBuckets.get(r.fvIndex) ?? [];
      list.push(r);
      fvBuckets.set(r.fvIndex, list);
    }
  }
  const fvIndices = Array.from(fvBuckets.keys()).sort((a, b) => a - b);

  // Detect the mis-framed "Add factor X?" case where partition
  // matches gold — old audits (pre-2026-05-19 builder change
  // a741daf) emit ``calibration_factor_extra`` for cases that
  // should now be ``calibration_factor_match_near``. The agent's
  // FVs cover the same biomaterials as gold's; only the labels
  // differ. Surface a banner that explains the actual decision
  // is "change labels", not "add a new factor". Three-way verdict
  // (Keep gold / Accept agent / per-row edit) is the right frame
  // for these, not "should I add this thing".
  const code = finding.issue_code;
  const isExtraButPairedToGold =
    (code === "calibration_factor_extra" ||
      code === "calibration_agent_extra") &&
    fvIndices.length > 0 &&
    fvIndices.every((idx) => {
      const meta = fvMeta.get(idx);
      return (
        meta &&
        meta.goldSampleCount !== null &&
        meta.goldSampleCount === meta.agentSampleCount
      );
    });

  // Removal-only findings (``*_gold_only_miss``) collapse to a
  // binary "keep vs remove" decision — there's nothing to edit at
  // the row level because the curator's verdict is on the gold
  // factor's existence, not its labels. Hide the per-row panel
  // entirely; the Keep-gold / Accept-agent buttons carry the
  // whole verdict.
  const isRemovalFinding =
    code === "calibration_factor_gold_only_miss" ||
    code === "calibration_gold_only_miss";

  // Stronger sub-case of ``isExtraButPairedToGold``: the proposal
  // matches gold on EVERY row (category + all FV statement parts).
  // Effectively noise — bro's pre-a741daf builder emitted these
  // when its own judges disagreed about whether to fold the
  // proposal into an existing gold factor. The right curator call
  // is almost always "Keep gold" (dismiss as duplicate). Surface
  // a more emphatic banner so the curator doesn't pore over rows
  // looking for the difference that isn't there.
  const isExtraDuplicateOfGold =
    isExtraButPairedToGold &&
    rows.length > 0 &&
    rows.every((r) => r.matchesGold === true);

  return (
    <div className="space-y-3 rounded border border-slate-300 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800">
      {/* Mis-framed-extra banner. Pre-a741daf audits framed
          partition-equal cases as "Add factor X?" when the curator's
          actual call is "change labels on the existing X" — or, in
          the strongest sub-case, "nothing to do, this is a
          duplicate". Bump the frame explicitly. */}
      {isExtraDuplicateOfGold ? (
        <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100">
          <strong>Proposal duplicates existing curation</strong> —
          category and all FVs match gold exactly. The agent's
          judges disagreed about whether to emit this finding;
          there's nothing to fix. <em>Keep gold</em> dismisses it
          cleanly.
        </div>
      ) : isExtraButPairedToGold ? (
        <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100">
          <strong>Framed as "add" but partition matches existing
          curation</strong> — this is really a label-correction case.
          Use <em>Keep gold</em> / <em>Accept proposal</em> / per-row
          edits below to decide.
        </div>
      ) : null}

      {/* Structure axis — card-level. Hidden for removal findings
          (``*_gold_only_miss``) where the verdict is binary and the
          Keep-gold / Accept-agent buttons already carry it. */}
      {isRemovalFinding ? (
        <div className="text-[11px] text-slate-500 dark:text-slate-400">
          Proposed removing this factor — pick{" "}
          <strong>Keep gold</strong> to keep it, or{" "}
          <strong>Accept proposal</strong> to remove it.
        </div>
      ) : (
        <div className="flex items-center gap-3 text-xs">
          <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 w-20">
            Structure
          </span>
          <AxisToggle
            value={structureOk}
            onChange={setStructureOk}
            okLabel="ok"
            wrongLabel="wrong"
          />
          <span className="text-[11px] text-slate-400">
            ← the factor itself
          </span>
        </div>
      )}

      {/* Details — per-row rows. Equal rows collapse to a single
          condensed line (no checkboxes, no input, no side-by-side
          comparison) so the curator's eye lands on the rows that
          actually disagree. Suppressed for removal-only findings
          (``*_gold_only_miss``) — verdict is binary, no row-level
          fixes possible. */}
      {!isRemovalFinding ? (
      <div className="space-y-2">
        <div className="grid grid-cols-[5rem_auto_minmax(8rem,1fr)_minmax(8rem,1fr)] gap-x-2 gap-y-1 items-center text-[11px] text-slate-500 dark:text-slate-400">
          <span className="text-[10px] uppercase tracking-wide font-semibold col-start-1">
            Details
          </span>
          <span></span>
          <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
            proposal
          </span>
          <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
            currently
          </span>
        </div>

        {/* Factor-level rows (Category). */}
        {factorRows.map((row) => (
          <RowView
            key={row.path}
            row={row}
            state={getRow(row.path, row.agent.label)}
            onToggle={(ok) => setRow(row.path, { ok })}
            onLabelChange={(toLabel) =>
              setRow(row.path, {
                toLabel,
                edited: toLabel !== row.agent.label,
                // Editing a label flips the row to ✗ automatically;
                // matches bro's spec "edit a label → row flips to ✗".
                ok: toLabel !== row.agent.label ? false : null,
              })
            }
          />
        ))}

        {/* Per-FV blocks. The header carries the sample count for
            both agent and gold — partition-size differences are
            often the curator's first cue that a near-match is
            actually a wrong-subject case.
            FV-blocks where every row matches gold collapse to a
            single "all match ✓" line by default; curator expands by
            clicking the header. Reduces the visual scan for cases
            where only 1 of 3 FVs has any drift. */}
        {fvIndices.map((fvIdx) => {
          const meta = fvMeta.get(fvIdx);
          const countTxt = meta
            ? meta.goldSampleCount !== null &&
              meta.goldSampleCount !== meta.agentSampleCount
              ? ` · ${meta.agentSampleCount} samples (gold: ${meta.goldSampleCount})`
              : ` · ${meta.agentSampleCount} sample${meta.agentSampleCount === 1 ? "" : "s"}`
            : "";
          const partitionMismatch =
            meta &&
            meta.goldSampleCount !== null &&
            meta.goldSampleCount !== meta.agentSampleCount;
          const fvRows = fvBuckets.get(fvIdx) ?? [];
          const anyTouched = fvRows.some((r) => {
            const s = rowState.get(r.path);
            return s && (s.ok !== null || s.edited);
          });
          const allMatch =
            fvRows.length > 0 &&
            fvRows.every((r) => r.matchesGold === true) &&
            !partitionMismatch;
          // Collapse by default when ALL rows match AND nothing's
          // been touched. Curator's explicit expand wins via the
          // ``fvExpanded`` map.
          const explicitlyExpanded = fvExpanded.get(fvIdx);
          const expanded =
            explicitlyExpanded !== undefined
              ? explicitlyExpanded
              : !allMatch || anyTouched;
          const toggleExpanded = () => {
            setFvExpanded((prev) => {
              const next = new Map(prev);
              next.set(fvIdx, !expanded);
              return next;
            });
          };
          return (
            <div
              key={fvIdx}
              className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 space-y-1 dark:border-slate-700 dark:bg-slate-700/40"
            >
              <button
                type="button"
                onClick={toggleExpanded}
                className="w-full text-left text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400 flex items-baseline gap-1 hover:text-slate-700 dark:hover:text-slate-200"
                title={expanded ? "collapse FV" : "expand FV"}
              >
                <span className="font-mono text-slate-400">
                  {expanded ? "▾" : "▸"}
                </span>
                <span>FV {fvIdx + 1}</span>
                <span
                  className={cn(
                    "font-normal normal-case tracking-normal",
                    partitionMismatch ? "text-rose-600" : "text-slate-400",
                  )}
                >
                  {countTxt}
                </span>
                {!expanded && allMatch ? (
                  <span className="ml-auto font-normal normal-case tracking-normal text-emerald-600 dark:text-emerald-400 text-[11px]">
                    all match <span className="font-bold">✓</span>
                  </span>
                ) : null}
              </button>
              {expanded
                ? fvRows.map((row) => (
                    <RowView
                      key={row.path}
                      row={row}
                      state={getRow(row.path, row.agent.label)}
                      onToggle={(ok) => setRow(row.path, { ok })}
                      onLabelChange={(toLabel) =>
                        setRow(row.path, {
                          toLabel,
                          edited: toLabel !== row.agent.label,
                          ok: toLabel !== row.agent.label ? false : null,
                        })
                      }
                    />
                  ))
                : null}
            </div>
          );
        })}
      </div>
      ) : null}

      {/* Action row. Three-way verdict: ``Keep gold`` (existing
          curation is right) and ``Accept agent`` (agent's proposal
          is right) are the two common calls — one click each, no
          per-row noise. ``Save edits`` is the rarer "both are
          partially wrong" path where the curator's typed
          corrections are the real fix. */}
      <div className="flex items-center gap-2 pt-1 text-xs">
        <button
          type="button"
          onClick={keepGold}
          disabled={saving}
          title="Existing curation is correct — no changes needed."
          className="px-2.5 py-1 rounded bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
        >
          {saving ? "Saving…" : "Keep gold"}
        </button>
        <button
          type="button"
          onClick={acceptAgent}
          disabled={saving}
          title="The proposal is correct — apply it as-is."
          className="px-2.5 py-1 rounded bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
        >
          {saving ? "Saving…" : "Accept proposal"}
        </button>
        {!isRemovalFinding ? (
          <>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <button
              type="button"
              onClick={save}
              disabled={
                saving ||
                (structureOk === null && detailsOk === null) ||
                currentDisposition === "dismissed"
              }
              title="Both gold and agent are wrong — use your per-row edits."
              className="px-2.5 py-1 rounded border border-slate-400 text-slate-700 text-xs font-semibold hover:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed dark:border-slate-500 dark:text-slate-200 dark:hover:bg-slate-700 dark:disabled:text-slate-500"
            >
              {saving ? "Saving…" : "Save edits"}
            </button>
          </>
        ) : null}
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
        <span className="ml-auto text-[10px] text-slate-400">
          {detailsOk === null
            ? "details: untouched"
            : detailsOk
              ? "details: ✓ all ok"
              : "details: ✗ some wrong"}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AxisToggle({
  value,
  onChange,
  okLabel,
  wrongLabel,
}: {
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  okLabel: string;
  wrongLabel: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(value === true ? null : true)}
        className={cn(
          "px-2 py-0.5 rounded border text-xs",
          value === true
            ? "bg-emerald-100 border-emerald-400 text-emerald-900 font-semibold dark:bg-emerald-900/40 dark:border-emerald-600 dark:text-emerald-100"
            : "bg-white border-slate-300 text-slate-500 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700",
        )}
        title={`Toggle ${okLabel}`}
      >
        ✓ {okLabel}
      </button>
      <button
        type="button"
        onClick={() => onChange(value === false ? null : false)}
        className={cn(
          "px-2 py-0.5 rounded border text-xs",
          value === false
            ? "bg-rose-100 border-rose-400 text-rose-900 font-semibold dark:bg-rose-900/40 dark:border-rose-600 dark:text-rose-100"
            : "bg-white border-slate-300 text-slate-500 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700",
        )}
        title={`Toggle ${wrongLabel}`}
      >
        ✗ {wrongLabel}
      </button>
    </span>
  );
}

function RowView({
  row,
  state,
  onToggle,
  onLabelChange,
}: {
  row: Row;
  state: RowEditState;
  onToggle: (ok: boolean | null) => void;
  onLabelChange: (toLabel: string) => void;
}) {
  // Two render variants:
  //  - **Equal row** (matchesGold === true AND curator hasn't
  //    edited): collapsed to a single line. Just label + value
  //    + small ✓ glyph. No toggle (Paul's "skip checkboxes when
  //    equal"), no input (nothing to fix), no separate gold
  //    column (values are identical). Visually muted so the
  //    curator's eye skips past it.
  //  - **Unequal row** (matchesGold === false OR null, OR the
  //    curator has typed an edit): full layout with toggle +
  //    editable input + proposal/currently side-by-side. This is
  //    the row that actually needs attention.
  // Curator-edited equal rows still render as "unequal" because
  // the curator's typing implies they're working on it.
  const isEqualAndUntouched = row.matchesGold === true && !state.edited;
  const isEmpty = !row.agent.label;

  if (isEqualAndUntouched) {
    return (
      <div className="grid grid-cols-[5rem_1fr_auto] gap-x-2 items-baseline text-[11px]">
        <span className="text-slate-500 dark:text-slate-400">
          {row.rowLabel}
        </span>
        <span className="text-slate-700 dark:text-slate-200 truncate">
          {row.agent.label || (
            <span className="italic text-slate-400">—</span>
          )}
        </span>
        <span
          className="text-emerald-600 dark:text-emerald-400 text-sm font-bold leading-none"
          title="matches existing curation"
        >
          ✓
        </span>
      </div>
    );
  }

  const diffCue =
    row.matchesGold === null ? "·" : row.matchesGold ? "=" : "≠";
  const diffCls =
    row.matchesGold === false
      ? "text-amber-600 dark:text-amber-400"
      : row.matchesGold === true
        ? "text-emerald-500/80 dark:text-emerald-400/70"
        : "text-slate-400 dark:text-slate-500";

  return (
    <div className="grid grid-cols-[5rem_auto_minmax(8rem,1fr)_minmax(8rem,1fr)] gap-x-2 items-center">
      <span className="text-[11px] text-slate-700 dark:text-slate-300">
        {row.rowLabel}
      </span>
      <span className="inline-flex items-center gap-0.5">
        <RowToggle ok={state.ok} onChange={onToggle} />
      </span>
      <input
        type="text"
        value={state.toLabel}
        onChange={(e) => onLabelChange(e.target.value)}
        placeholder={isEmpty ? "—" : ""}
        className={cn(
          "text-[11px] px-1.5 py-0.5 rounded border",
          state.edited
            ? "border-amber-400 bg-amber-50/40 dark:bg-amber-950/30 dark:border-amber-600"
            : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900",
          isEmpty && !state.edited
            ? "italic text-slate-400 placeholder-slate-300 dark:text-slate-500"
            : "text-slate-800 dark:text-slate-100",
        )}
      />
      <span
        className={cn(
          "text-[11px] inline-flex items-baseline gap-1",
          diffCls,
        )}
      >
        <span className="font-mono">{diffCue}</span>
        <span className="truncate">
          {row.gold?.label || (row.gold === null ? "—" : "(empty)")}
        </span>
      </span>
    </div>
  );
}

function RowToggle({
  ok,
  onChange,
}: {
  ok: boolean | null;
  onChange: (ok: boolean | null) => void;
}) {
  return (
    <span className="inline-flex">
      <button
        type="button"
        onClick={() => onChange(ok === true ? null : true)}
        className={cn(
          "w-5 h-5 inline-flex items-center justify-center text-[11px] border rounded-l",
          ok === true
            ? "bg-emerald-100 border-emerald-400 text-emerald-900 font-semibold dark:bg-emerald-900/40 dark:border-emerald-600 dark:text-emerald-100"
            : "bg-white border-slate-300 text-slate-400 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700",
        )}
        title="✓ ok"
      >
        ✓
      </button>
      <button
        type="button"
        onClick={() => onChange(ok === false ? null : false)}
        className={cn(
          "w-5 h-5 inline-flex items-center justify-center text-[11px] border -ml-px rounded-r",
          ok === false
            ? "bg-rose-100 border-rose-400 text-rose-900 font-semibold dark:bg-rose-900/40 dark:border-rose-600 dark:text-rose-100"
            : "bg-white border-slate-300 text-slate-400 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700",
        )}
        title="✗ wrong"
      >
        ✗
      </button>
    </span>
  );
}
