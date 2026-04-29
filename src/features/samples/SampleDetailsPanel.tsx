import { useEffect, useMemo, useRef, useState } from "react";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import {
  reassignSample,
  reassignSamples,
  setBiomaterialCharacteristic,
  setBiomaterialName,
} from "@/features/design/mutations";
import { InlineText } from "@/components/ui/InlineText";
import { InlineFvPicker } from "@/components/ui/InlineFvPicker";
import type {
  Biomaterial,
  Design,
  Factor,
} from "@/features/experiment/types";
import { cn } from "@/lib/cn";
import { BulkAssignPanel } from "@/features/samples/BulkAssignPanel";
import { useProposalReview } from "@/features/proposal/ProposalReviewContext";
import type {
  BiomaterialAssignmentMeta,
  FactorProposal,
  FactorValueProposal,
} from "@/api/types";

type SortDir = "asc" | "desc";
interface SortState {
  /** Column key. Encoded:
   *    "short_name" / "name" / "bio_assay"
   *    "char:<characteristic key>"
   *    "factor:<factor id>"
   */
  key: string;
  dir: SortDir;
}

/**
 * Sample-level view of the experiment with editing, bulk changes,
 * and sorting.
 *
 * - **Sort**: any column header toggles asc / desc.
 * - **Edit**: factor-value cells become a `<select>` over the
 *   factor's FVs; selecting reassigns the biomaterial via the
 *   shared `reassignSample` mutation, so the change shows up in
 *   the bottom CommitBar like any other design edit.
 * - **Select**: click a row's left gutter to select; shift-click
 *   to extend a range; cmd / ctrl-click to toggle one row without
 *   clearing the rest. Esc clears selection. The bulk-action bar
 *   sits at the top of the card so it's visible before scrolling
 *   through samples — appears only when ≥1 row is selected.
 *
 * Reads the **draft** (not the saved server copy) so cells reflect
 * uncommitted edits made elsewhere (e.g. drag-drop in the design
 * tab).
 */
export function SampleDetailsPanel({ experimentId }: { experimentId: number }) {
  const { draft, saved, apply, isLoading, loadError } = useDesignDraft();
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "short_name", dir: "asc" });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  if (isLoading) {
    return (
      <div className="card p-4 text-sm text-slate-500">loading samples…</div>
    );
  }
  if (loadError || !draft) {
    return (
      <div className="card p-4 text-sm text-rose-700">
        couldn't load samples for experiment {experimentId}:{" "}
        {loadError ?? "unknown"}
      </div>
    );
  }

  return (
    <SampleTable
      design={draft}
      saved={saved}
      filter={filter}
      onFilterChange={setFilter}
      sort={sort}
      onSortChange={setSort}
      selected={selected}
      onSelectedChange={setSelected}
      onReassign={(shortName, factorId, toFvId) =>
        apply((d) => reassignSample(d, factorId, shortName, toFvId))
      }
      onReassignBulk={(shortNames, factorId, toFvId) =>
        // Single design pass for many samples — used by the bulk
        // action bar instead of looping per-sample. Keeps the
        // reduction cost O(factors × FVs) regardless of selection
        // size.
        apply((d) => reassignSamples(d, factorId, shortNames, toFvId))
      }
      onSetName={(shortName, name) =>
        apply((d) => setBiomaterialName(d, shortName, name))
      }
      onSetCharacteristic={(shortName, key, value) =>
        apply((d) => setBiomaterialCharacteristic(d, shortName, key, value))
      }
    />
  );
}

function SampleTable({
  design,
  saved,
  filter,
  onFilterChange,
  sort,
  onSortChange,
  selected,
  onSelectedChange,
  onReassign,
  onReassignBulk,
  onSetName,
  onSetCharacteristic,
}: {
  design: Design;
  /** Server-saved baseline; null until first fetch. We only use it
   *  to flag per-cell dirty state (draft.characteristics differs from
   *  saved.characteristics for that biomaterial+key). */
  saved: Design | null;
  filter: string;
  onFilterChange: (s: string) => void;
  sort: SortState;
  onSortChange: (s: SortState) => void;
  selected: Set<string>;
  onSelectedChange: (s: Set<string>) => void;
  onReassign: (shortName: string, factorId: number, toFvId: number) => void;
  onReassignBulk: (
    shortNames: string[],
    factorId: number,
    toFvId: number,
  ) => void;
  onSetName: (shortName: string, name: string) => void;
  onSetCharacteristic: (shortName: string, key: string, value: string) => void;
}) {
  const charKeys = useMemo(
    () => collectCharacteristicKeys(design.biomaterials),
    [design.biomaterials],
  );
  const fvByBmPerFactor = useMemo(
    () =>
      design.factors.map((f) => ({
        factor: f,
        index: indexFvByBiomaterial(f),
      })),
    [design.factors],
  );
  // Match characteristic keys to categorical factors so the cell
  // editor can offer an FV picker instead of free text. Keyed by
  // lowercased char key for case-insensitive lookup; only entries
  // for ``categorical`` factors with ≥1 FV land in the map —
  // continuous factors and factor-less chars fall through to the
  // text editor.
  const categoricalFactorByCharKey = useMemo(() => {
    const m = new Map<string, Factor>();
    for (const f of design.factors) {
      if (f.type !== "categorical") continue;
      if (f.factor_values.length === 0) continue;
      const key = (f.category.label || "").trim().toLowerCase();
      if (!key) continue;
      if (!m.has(key)) m.set(key, f);
    }
    return m;
  }, [design.factors]);
  // Saved-baseline char lookup for per-cell dirty detection. Keyed
  // by ``${short_name}|${charKey}`` so the rendering path can do an
  // O(1) "did the curator edit this" check against draft. Empty map
  // until ``saved`` loads — every cell renders clean in the meantime.
  const savedCharIndex = useMemo(() => {
    const m = new Map<string, string>();
    if (!saved) return m;
    for (const b of saved.biomaterials) {
      for (const [k, v] of Object.entries(b.characteristics ?? {})) {
        m.set(`${b.short_name}|${k}`, v ?? "");
      }
    }
    return m;
  }, [saved]);
  // Proposal-overlay state (Slice 7+ — sample-table reassignment).
  // When a curator clicks "review on Samples tab" on a v2
  // ProposalCard, this hook returns the proposal whose per-sample
  // assignments should be rendered as additional table columns.
  // Reassignments accumulate in the same context so the card's
  // accept flow can read them on submit.
  const {
    activeProposal,
    setActiveProposal,
    reassignments: proposalReassignments,
    setReassignment: setProposalReassignment,
    getReassignment: getProposalReassignment,
  } = useProposalReview();
  // Only treat the overlay as "active" when the proposal is for THIS
  // experiment and actually has factors to render. Pending proposals
  // for other experiments shouldn't bleed into this view.
  const overlayProposal =
    activeProposal &&
    activeProposal.experiment_id === design.experiment_id &&
    activeProposal.factors.length > 0
      ? activeProposal
      : null;
  const proposalFactors: FactorProposal[] = overlayProposal?.factors ?? [];
  // Show the bio_assay column ONLY when it carries information the
  // biomaterial column doesn't already show. Common bulk pattern:
  // one assay per biomaterial, sharing the same short_name (GSM…).
  // In that case the column is a redundant duplicate — hide it.
  // Two non-trivial cases keep the column visible:
  //   (a) any assay's short_name differs from its biomaterial's, or
  //   (b) some biomaterial has multiple assays (multi-lane / multi-
  //       platform runs).
  const hasBioAssays = useMemo(
    () =>
      design.biomaterials.some((b) => {
        const assays = b.bio_assays ?? [];
        if (assays.length > 1) return true;
        if (assays.length === 1 && assays[0].short_name !== b.short_name) {
          return true;
        }
        return false;
      }),
    [design.biomaterials],
  );

  // Column-filtering state: a substring search over column labels,
  // and a toggle that hides any column whose value is identical
  // across every visible row. Both are view-only — local to this
  // component, not persisted.
  const [colFilter, setColFilter] = useState("");
  const [hideConstant, setHideConstant] = useState(false);
  // Bulk-assign modal (factor → FV mapping by characteristic). Null
  // when closed; carries the currently-targeted factor when open.
  const [bulkAssignFactor, setBulkAssignFactor] = useState<Factor | null>(null);

  // Whether to collapse single-cell BioMaterial rows by source
  // sample. Auto-on whenever any BM in the experiment carries a
  // source_biomaterial_id (single-cell signal); curator can force
  // it off to inspect / edit per cell-type bucket directly. Stays
  // local (not persisted) — a "view setting" rather than a
  // curation choice.
  const hasSourceIds = useMemo(
    () =>
      design.biomaterials.some(
        (b) => (b.source_biomaterial_id ?? null) != null,
      ),
    [design.biomaterials],
  );
  const [collapseGroups, setCollapseGroups] = useState<boolean>(true);

  // Per-column constancy is keyed off the full biomaterial set,
  // not the filtered subset — "constant" means "never varies in
  // this experiment", and shouldn't shift around when the curator
  // narrows rows. Decoupling also breaks a would-be cycle between
  // row-filter and column-visibility.
  const constantCharKeys = useMemo(() => {
    const out = new Set<string>();
    if (design.biomaterials.length <= 1) return out;
    for (const k of charKeys) {
      let first: string | undefined;
      let allSame = true;
      for (const b of design.biomaterials) {
        const v = b.characteristics?.[k] ?? "";
        if (first === undefined) first = v;
        else if (v !== first) { allSame = false; break; }
      }
      if (allSame) out.add(k);
    }
    return out;
  }, [charKeys, design.biomaterials]);

  const constantFactorIds = useMemo(() => {
    const out = new Set<number>();
    if (design.biomaterials.length <= 1) return out;
    for (const { factor, index } of fvByBmPerFactor) {
      let first: number | null | undefined;
      let allSame = true;
      for (const b of design.biomaterials) {
        const fv = index.get(b.short_name)?.fv_id ?? null;
        if (first === undefined) first = fv;
        else if (fv !== first) { allSame = false; break; }
      }
      if (allSame) out.add(factor.id);
    }
    return out;
  }, [fvByBmPerFactor, design.biomaterials]);

  // Apply the column-name filter + the hide-constant toggle to the
  // characteristic-key list and the per-factor list. Constant
  // columns and non-matching columns drop out of the table.
  const visibleCharKeys = useMemo(() => {
    const q = colFilter.trim().toLowerCase();
    return charKeys.filter((k) => {
      if (hideConstant && constantCharKeys.has(k)) return false;
      if (q && !k.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [charKeys, colFilter, hideConstant, constantCharKeys]);

  const visibleFactors = useMemo(() => {
    const q = colFilter.trim().toLowerCase();
    return fvByBmPerFactor.filter(({ factor }) => {
      if (hideConstant && constantFactorIds.has(factor.id)) return false;
      if (q) {
        const name = (factor.name || `factor#${factor.id}`).toLowerCase();
        const cat = (factor.category?.label || "").toLowerCase();
        if (!name.includes(q) && !cat.includes(q)) return false;
      }
      return true;
    });
  }, [fvByBmPerFactor, colFilter, hideConstant, constantFactorIds]);

  const hiddenColCount =
    (charKeys.length - visibleCharKeys.length) +
    (fvByBmPerFactor.length - visibleFactors.length);

  // Row filter — searches only what's actually rendered (WYSIWYG).
  // If a column is hidden by the column-filter or hide-constant
  // toggle, its values don't contribute to row matches. That makes
  // the search behave intuitively: typing "wild" only catches rows
  // where you can SEE "wild" in a visible cell.
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return design.biomaterials;
    return design.biomaterials.filter((b) => {
      // Always-visible columns: short_name, name, bio_assays.
      if (b.short_name.toLowerCase().includes(q)) return true;
      if (b.name.toLowerCase().includes(q)) return true;
      for (const a of b.bio_assays ?? []) {
        if (a.short_name.toLowerCase().includes(q)) return true;
        if ((a.name ?? "").toLowerCase().includes(q)) return true;
      }
      // Visible characteristic columns only.
      for (const k of visibleCharKeys) {
        const v = b.characteristics?.[k] ?? "";
        if (String(v).toLowerCase().includes(q)) return true;
      }
      // Visible factor columns only — match the FV label and its
      // statement subject / predicate / object so curators can find
      // samples by their curated annotation, not just by the raw
      // GEO characteristic (e.g. searching "wild" matches a sample
      // whose FV is `Wild type genotype` even when its characteristic
      // says `WT`).
      for (const { factor, index } of visibleFactors) {
        const hit = index.get(b.short_name);
        if (!hit) continue;
        const fv = factor.factor_values.find((x) => x.id === hit.fv_id);
        if (!fv) continue;
        if ((fv.free_text_label || "").toLowerCase().includes(q)) {
          return true;
        }
        for (const s of fv.statements) {
          if ((s.subject?.label || "").toLowerCase().includes(q)) return true;
          if ((s.object?.label || "").toLowerCase().includes(q)) return true;
          if ((s.predicate?.label || "").toLowerCase().includes(q)) return true;
        }
      }
      return false;
    });
  }, [design.biomaterials, filter, visibleCharKeys, visibleFactors]);

  const sorted = useMemo(
    () => sortBiomaterials(filtered, sort, fvByBmPerFactor),
    [filtered, sort, fvByBmPerFactor],
  );

  // ---------------------------------------------------------------------
  // Group BioMaterials by source-sample so single-cell datasets render
  // one row per biological sample rather than one per cell-type bucket.
  //
  // Gemma stores single-cell experiments as N BioMaterials per sample
  // (one per cell-type bucket); they all share a `source_biomaterial_id`
  // pointing at the parent BioMaterial. Bulk experiments leave the
  // field unset and get one row per BM as before.
  //
  // Aggregation rules:
  //   - characteristics: identical across siblings → show the value;
  //     differ → show top 2 distinct + "(+N more)" with full list in
  //     the tooltip. Cell-type-style differentiation columns are
  //     informative; we don't suppress them.
  //   - factor FVs: identical across siblings → show the FV; differ
  //     → mark "(mixed)". Factor values *should* apply at the
  //     source-sample level, so divergence is a curation smell.
  //   - bio_assays: union of all siblings' assays.
  //   - edits (rename / set characteristic / reassign): fan out to
  //     every sibling unconditionally.
  // ---------------------------------------------------------------------
  type RowUnit =
    | { kind: "single"; bm: Biomaterial; allShortNames: string[] }
    | {
        kind: "group";
        repr: Biomaterial;
        siblings: Biomaterial[];
        allShortNames: string[];
        sourceId: number;
      };

  const groupedRows = useMemo<RowUnit[]>(() => {
    // Walk `sorted` once. When grouping is enabled and we encounter
    // a BM with a source_biomaterial_id we haven't seen, gather
    // all sorted-order BMs sharing that id into one group anchored
    // at the first occurrence. BMs without a
    // source_biomaterial_id, and all BMs when grouping is off,
    // render as singletons. Preserves the visible sort order.
    const out: RowUnit[] = [];
    const claimed = new Set<string>();
    for (const bm of sorted) {
      if (claimed.has(bm.short_name)) continue;
      const srcId = bm.source_biomaterial_id ?? null;
      if (!collapseGroups || srcId == null) {
        out.push({
          kind: "single",
          bm,
          allShortNames: [bm.short_name],
        });
        claimed.add(bm.short_name);
        continue;
      }
      const siblings = sorted.filter(
        (b) => (b.source_biomaterial_id ?? null) === srcId,
      );
      for (const s of siblings) claimed.add(s.short_name);
      if (siblings.length === 1) {
        out.push({
          kind: "single",
          bm,
          allShortNames: [bm.short_name],
        });
      } else {
        out.push({
          kind: "group",
          repr: siblings[0],
          siblings,
          allShortNames: siblings.map((b) => b.short_name),
          sourceId: srcId,
        });
      }
    }
    return out;
  }, [sorted, collapseGroups]);

  const isCollapsedView = useMemo(
    () => groupedRows.some((r) => r.kind === "group"),
    [groupedRows],
  );

  // How many *grouped rows* are at least partially in the selection.
  // Used by the row count + bulk bar so single-cell curators see
  // their natural unit ("5 source samples selected") not the BM
  // count ("40 selected").
  const selectedGroupCount = useMemo(() => {
    let n = 0;
    for (const r of groupedRows) {
      if (r.allShortNames.some((sn) => selected.has(sn))) n++;
    }
    return n;
  }, [groupedRows, selected]);

  // Visible-row selection helpers — operate on groupedRows so
  // selecting a collapsed group selects all its sibling BMs in
  // one click. "All visible selected" considers every BM that any
  // visible row represents.
  const allVisibleShortNames = useMemo(
    () => groupedRows.flatMap((r) => r.allShortNames),
    [groupedRows],
  );
  const allVisibleSelected =
    allVisibleShortNames.length > 0 &&
    allVisibleShortNames.every((sn) => selected.has(sn));
  const someVisibleSelected =
    !allVisibleSelected &&
    allVisibleShortNames.some((sn) => selected.has(sn));

  // Anchor for shift-click range selection. Tracks the index in
  // `groupedRows` (not `sorted`) of the last regular / cmd-click;
  // shift-click extends from there to the new row inclusive,
  // selecting every BM in every group along the way.
  const anchorRef = useRef<number | null>(null);

  function clickRow(
    rowShortNames: string[],
    visibleIndex: number,
    e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  ) {
    if (e.shiftKey && anchorRef.current != null) {
      const lo = Math.min(anchorRef.current, visibleIndex);
      const hi = Math.max(anchorRef.current, visibleIndex);
      const next = new Set(selected);
      for (let i = lo; i <= hi; i++) {
        for (const sn of groupedRows[i].allShortNames) next.add(sn);
      }
      onSelectedChange(next);
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selected);
      // Toggle as a unit: if every BM in this row is selected,
      // remove them all; otherwise add them all.
      const allSelected = rowShortNames.every((sn) => next.has(sn));
      if (allSelected) {
        for (const sn of rowShortNames) next.delete(sn);
      } else {
        for (const sn of rowShortNames) next.add(sn);
      }
      onSelectedChange(next);
      anchorRef.current = visibleIndex;
      return;
    }
    // Plain click: select just this row's BMs (clear the rest). If
    // clicking the sole-selected row, deselect everything.
    const onlyThisRowSelected =
      selected.size === rowShortNames.length &&
      rowShortNames.every((sn) => selected.has(sn));
    if (onlyThisRowSelected) {
      onSelectedChange(new Set());
      anchorRef.current = null;
      return;
    }
    onSelectedChange(new Set(rowShortNames));
    anchorRef.current = visibleIndex;
  }
  function toggleVisible() {
    const next = new Set(selected);
    if (allVisibleSelected) {
      for (const sn of allVisibleShortNames) next.delete(sn);
    } else {
      for (const sn of allVisibleShortNames) next.add(sn);
    }
    onSelectedChange(next);
  }
  function clearSelection() {
    onSelectedChange(new Set());
    anchorRef.current = null;
  }

  // Esc clears selection.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && selected.size > 0) {
        // Don't steal Esc from open <select> popovers etc.
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
        clearSelection();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card relative">
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-200 flex-wrap">
        <span className="section-h">
          {isCollapsedView
            ? `Source samples · ${groupedRows.length}`
            : `Samples · ${design.biomaterials.length}`}
          {isCollapsedView ? (
            <span
              className="text-slate-500 font-normal"
              title="Single-cell datasets store one BioMaterial per cell-type bucket. Rows are collapsed by source biomaterial — design factors apply at the source-sample level."
            >
              {" "}
              · {design.biomaterials.length} cell-type buckets
            </span>
          ) : null}
          {filter ? (
            <span className="text-slate-500 font-normal">
              {" "}
              · {filtered.length} match
            </span>
          ) : null}
          {selected.size > 0 ? (
            <span className="text-slate-500 font-normal">
              {" "}
              ·{" "}
              {isCollapsedView
                ? `${selectedGroupCount} source sample${selectedGroupCount === 1 ? "" : "s"} (${selected.size} BM${selected.size === 1 ? "" : "s"}) selected`
                : `${selected.size} selected`}
            </span>
          ) : null}
        </span>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="search"
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            placeholder="filter rows by name, char, FV, GSM…"
            className="text-xs border border-slate-300 rounded px-2 py-1 w-64"
          />
          <input
            type="search"
            value={colFilter}
            onChange={(e) => setColFilter(e.target.value)}
            placeholder="filter columns…"
            className="text-xs border border-slate-300 rounded px-2 py-1 w-44"
            title="hide columns whose label doesn't contain this text"
          />
          <label
            className="text-[11px] text-slate-600 inline-flex items-center gap-1"
            title="hide any column whose value is identical across every visible row"
          >
            <input
              type="checkbox"
              checked={hideConstant}
              onChange={(e) => setHideConstant(e.target.checked)}
            />
            hide constant
          </label>
          {hasSourceIds ? (
            <label
              className="text-[11px] text-slate-600 inline-flex items-center gap-1"
              title="single-cell datasets store one BioMaterial per cell-type bucket. Collapsed view shows one row per source biological sample; turn off to inspect / edit per bucket."
            >
              <input
                type="checkbox"
                checked={collapseGroups}
                onChange={(e) => setCollapseGroups(e.target.checked)}
              />
              collapse cell-type buckets
            </label>
          ) : null}
          {hiddenColCount > 0 ? (
            <span className="text-[11px] text-slate-400">
              · {hiddenColCount} col
              {hiddenColCount === 1 ? "" : "s"} hidden
            </span>
          ) : null}
          <span
            className="text-[11px] text-slate-500 hidden md:inline"
            title="click a row's left gutter to select; shift-click for range; ⌘/ctrl-click to toggle one row"
          >
            click · shift-click · ⌘-click
          </span>
          {design.factors.length > 0 ? (
            <button
              type="button"
              className="btn ghost text-xs"
              onClick={() =>
                setBulkAssignFactor(design.factors[0] ?? null)
              }
              title="Map each distinct value of a biomaterial characteristic to a factor value in one go. Pick the target factor inside the modal."
            >
              bulk assign…
            </button>
          ) : null}
          {selected.size > 0 ? (
            <button
              type="button"
              className="btn ghost text-xs"
              onClick={clearSelection}
            >
              clear selection
            </button>
          ) : null}
        </div>
      </div>

      {/* Proposal-review banner. Visible only while the curator is
          reviewing a proposal for THIS experiment. Tells them what
          mode they're in, shows the running reassignment count, and
          gives them a "stop reviewing" out. Closing the banner just
          clears the review state — it doesn't drop the proposal,
          which still sits in the sidebar. */}
      {overlayProposal ? (
        <div className="px-3 py-1.5 border-b border-amber-300 bg-amber-50 text-[11px] text-amber-900 flex items-center justify-between gap-3 flex-wrap">
          <span>
            <span className="font-semibold">Reviewing proposal</span> ·{" "}
            {proposalFactors.length} proposed factor
            {proposalFactors.length === 1 ? "" : "s"} appended at right ·{" "}
            click any cell to reassign.
            {proposalReassignments.size > 0 ? (
              <span className="ml-2">
                {proposalReassignments.size} curator reassignment
                {proposalReassignments.size === 1 ? "" : "s"}
              </span>
            ) : null}
          </span>
          <button
            type="button"
            className="text-amber-900 hover:text-amber-700 underline underline-offset-2"
            onClick={() => setActiveProposal(null)}
          >
            stop reviewing
          </button>
        </div>
      ) : null}

      {bulkAssignFactor ? (
        <BulkAssignModal
          factors={design.factors}
          biomaterials={design.biomaterials}
          initialFactor={bulkAssignFactor}
          onApply={(factorId, plan) => {
            // Group by destination FV so each FV is one bulk
            // mutation rather than N sequential single-sample
            // apply() reductions over the whole design.
            const byFv = new Map<number, string[]>();
            for (const [shortName, toFvId] of plan) {
              const list = byFv.get(toFvId) ?? [];
              list.push(shortName);
              byFv.set(toFvId, list);
            }
            for (const [toFvId, names] of byFv) {
              onReassignBulk(names, factorId, toFvId);
            }
            setBulkAssignFactor(null);
          }}
          onCancel={() => setBulkAssignFactor(null)}
        />
      ) : null}

      {selected.size > 0 ? (
        <BulkActionBar
          factors={design.factors}
          selectedShortNames={Array.from(selected)}
          selectedGroupCount={isCollapsedView ? selectedGroupCount : null}
          fvByBmPerFactor={fvByBmPerFactor}
          onApply={(factorId, toFvId) => {
            // Single bulk reduction over the design instead of N
            // sequential ``apply()`` calls per selected sample.
            onReassignBulk(Array.from(selected), factorId, toFvId);
            // Keep selection — curator can do another bulk action.
          }}
          onClearSelection={clearSelection}
        />
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr className="border-b border-slate-200">
              <th
                className="px-2 py-2 w-7 sticky left-0 bg-slate-50 z-10 text-center"
                title={
                  allVisibleSelected
                    ? "click to deselect all visible"
                    : "click to select all visible"
                }
              >
                <button
                  type="button"
                  onClick={toggleVisible}
                  className="w-4 h-4 rounded-sm border border-slate-300 hover:border-slate-500 flex items-center justify-center text-slate-400 hover:text-slate-700 mx-auto"
                  aria-label="toggle all visible"
                >
                  {allVisibleSelected ? (
                    <span className="text-slate-700 leading-none">✓</span>
                  ) : someVisibleSelected ? (
                    <span className="text-slate-500 leading-none">–</span>
                  ) : (
                    <span className="leading-none"> </span>
                  )}
                </button>
              </th>
              <SortableTh
                label="short name"
                colKey="short_name"
                sort={sort}
                onSortChange={onSortChange}
                sticky
              />
              <SortableTh
                label="name"
                colKey="name"
                sort={sort}
                onSortChange={onSortChange}
              />
              {hasBioAssays ? (
                <SortableTh
                  label="bio_assay"
                  colKey="bio_assay"
                  sort={sort}
                  onSortChange={onSortChange}
                />
              ) : null}
              {visibleCharKeys.map((k) => (
                <SortableTh
                  key={`char-${k}`}
                  label={k}
                  colKey={`char:${k}`}
                  sort={sort}
                  onSortChange={onSortChange}
                  badge="char"
                  className="bg-slate-50 border-l border-slate-200/60"
                  title={`raw biomaterial characteristic — sourced from GEO sample metadata${
                    constantCharKeys.has(k) ? " · constant across visible rows" : ""
                  }`}
                />
              ))}
              {visibleFactors.map(({ factor }) => (
                <SortableTh
                  key={`f-${factor.id}`}
                  label={factor.name || `factor#${factor.id}`}
                  colKey={`factor:${factor.id}`}
                  sort={sort}
                  onSortChange={onSortChange}
                  badge="factor"
                  className="bg-blue-50/50 border-l-2 border-blue-200"
                  title={
                    (factor.description || `factor#${factor.id}`) +
                    (constantFactorIds.has(factor.id)
                      ? " · constant across visible rows"
                      : "")
                  }
                />
              ))}
              {/* Proposal-overlay columns. Appended after the design
                  factor columns; visually distinct (amber) so the
                  curator sees they're proposed-not-curated. Sort
                  isn't supported on these — they always render in
                  the proposal's factor order. */}
              {proposalFactors.map((pf, pfi) => (
                <th
                  key={`pf-${pfi}`}
                  className="text-left font-medium px-3 py-2 align-bottom bg-amber-50/60 border-l-2 border-amber-300"
                  title={`proposed factor (${pf.category.label || pf.name_in_design || `factor#${pfi}`}) — click a cell below to reassign`}
                >
                  <span className="inline-block text-[9px] uppercase tracking-wide font-semibold px-1 py-0 rounded mb-0.5 bg-amber-200 text-amber-900">
                    proposed
                  </span>
                  <div className="text-[11px] text-slate-700 truncate">
                    {pf.category.label ||
                      pf.name_in_design ||
                      `factor#${pfi}`}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groupedRows.map((row, idx) => {
              const allShortNames = row.allShortNames;
              const siblings =
                row.kind === "group" ? row.siblings : [row.bm];
              const repr = row.kind === "group" ? row.repr : row.bm;
              const isSelected = allShortNames.every((sn) =>
                selected.has(sn),
              );
              const isGroup = row.kind === "group";
              const groupSize = siblings.length;
              return (
                <tr
                  key={isGroup ? `grp-${row.sourceId}` : repr.short_name}
                  className={cn(
                    "border-b border-slate-100",
                    isSelected ? "bg-blue-50/60" : "hover:bg-slate-50",
                  )}
                >
                  {/*
                    Row-selection gutter. *Only* the gutter is the
                    selection click-target — clicking elsewhere on
                    the row triggers the cell's own behaviour (the
                    name / characteristic InlineTexts switch to
                    edit on double-click; factor cells open the FV
                    `<select>`; etc.). Putting a row-level click
                    handler on top of those would conflict.
                    Trade-off: shift-click for range works only
                    here, not on the row body — by design.

                    For grouped (single-cell) rows, click selects
                    every constituent BM in one go — same handler,
                    just operates on `allShortNames` instead of
                    a single short_name.

                    Modifier keys (shift / cmd / ctrl) preventDefault
                    on mousedown to stop the browser from extending
                    a text selection from a prior click point that
                    happened to be in a regular cell. Plain clicks
                    don't preventDefault so the curator can still
                    drag-select cell text.
                  */}
                  <td
                    className={cn(
                      "py-0 sticky left-0 z-10 cursor-pointer select-none w-7 min-w-[28px] max-w-[28px]",
                      isSelected
                        ? "bg-blue-50/60"
                        : "bg-white hover:bg-slate-100",
                    )}
                    onMouseDown={(e) => {
                      if (e.shiftKey || e.metaKey || e.ctrlKey) {
                        e.preventDefault();
                        window.getSelection()?.removeAllRanges();
                      }
                    }}
                    onClick={(e) =>
                      clickRow(allShortNames, idx, {
                        shiftKey: e.shiftKey,
                        metaKey: e.metaKey,
                        ctrlKey: e.ctrlKey,
                      })
                    }
                    title={
                      isGroup
                        ? `click to select all ${groupSize} cell-type buckets · shift-click for range`
                        : "click row gutter to select · shift-click for range · ⌘/ctrl-click to toggle"
                    }
                  >
                    <div className="h-full w-full flex items-center justify-center">
                      <span
                        className={cn(
                          "block w-1 h-5 rounded-full transition-colors",
                          isSelected
                            ? "bg-blue-600"
                            : "bg-slate-200 hover:bg-slate-400",
                        )}
                      />
                    </div>
                  </td>
                  <td
                    className="px-3 py-0.5 font-mono whitespace-nowrap"
                    title={
                      isGroup
                        ? `source biomaterial #${row.sourceId} · ${groupSize} buckets:\n${allShortNames.join("\n")}`
                        : repr.short_name
                    }
                  >
                    {repr.short_name}
                    {isGroup ? (
                      <span
                        className="ml-1.5 inline-flex items-center text-[10px] font-semibold uppercase tracking-wide px-1 py-0 rounded bg-violet-100 text-violet-900 border border-violet-200"
                        title={`single-cell: ${groupSize} cell-type buckets collapsed into this row`}
                      >
                        +{groupSize - 1}
                      </span>
                    ) : null}
                  </td>
                  <td
                    className="px-3 py-0.5 text-slate-700 whitespace-nowrap max-w-[16rem] truncate"
                    title={repr.name}
                  >
                    {/*
                      Editing the representative's name when the row
                      represents a group fans out to siblings —
                      keeps the source-sample identity consistent
                      across cell-type buckets. Mixed-name groups
                      are rare; we still show the representative.
                    */}
                    <InlineText
                      value={repr.name}
                      placeholder="add name"
                      onCommit={(name) => {
                        for (const sn of allShortNames) onSetName(sn, name);
                      }}
                    />
                  </td>
                  {hasBioAssays ? (
                    <td className="px-3 py-0.5 text-slate-700 whitespace-nowrap">
                      {/*
                        Bio-assay column. Submitters frequently set
                        the assay's `name` to the same string as the
                        biomaterial's `name`; suppress the duplicate.
                        For grouped rows we union all siblings'
                        assays (often one per cell-type bucket).
                      */}
                      {(() => {
                        const allAssays = siblings.flatMap(
                          (b) => b.bio_assays ?? [],
                        );
                        if (allAssays.length === 0) {
                          return <span className="text-slate-300">—</span>;
                        }
                        return allAssays.map((a, i) => {
                          const dupName = (a.name ?? "") === (repr.name ?? "");
                          return (
                            <div
                              key={`${a.short_name}-${i}`}
                              className={i > 0 ? "mt-0.5" : ""}
                              title={
                                dupName
                                  ? a.short_name
                                  : `${a.short_name} · ${a.name}`
                              }
                            >
                              <span className="font-mono text-[10px] text-slate-500">
                                {a.short_name}
                              </span>
                              {!dupName && a.name ? (
                                <span className="text-slate-700 ml-1">
                                  {a.name}
                                </span>
                              ) : null}
                            </div>
                          );
                        });
                      })()}
                    </td>
                  ) : null}
                  {visibleCharKeys.map((k) => {
                    const agg = aggregateCharValue(siblings, k);
                    const isOntology = !!agg.valueUri && !agg.isMixed;
                    // A char cell counts as dirty when ANY sibling's
                    // current value differs from the saved baseline
                    // for that biomaterial+key. Walks every sibling
                    // because grouped (single-cell) rows may share
                    // an aggregate display while individual buckets
                    // diverge from saved.
                    const isDirty =
                      !agg.isMixed &&
                      siblings.some((b) => {
                        const cur = (b.characteristics?.[k] ?? "").trim();
                        const prior = (
                          savedCharIndex.get(`${b.short_name}|${k}`) ?? ""
                        ).trim();
                        return cur !== prior;
                      });
                    const matchedFactor = categoricalFactorByCharKey.get(
                      k.toLowerCase(),
                    );
                    return (
                      <td
                        key={`${repr.short_name}-${k}`}
                        className={cn(
                          "px-3 py-0.5 border-l border-slate-100 whitespace-nowrap max-w-[16rem] truncate",
                          agg.isMixed
                            ? "italic text-slate-500"
                            : isOntology
                              ? "text-emerald-900 bg-emerald-50/60"
                              : "text-slate-700",
                        )}
                        title={
                          agg.isMixed
                            ? `${agg.distinct.length} distinct values across ${groupSize} cell-type buckets:\n${agg.distinct.join("\n")}`
                            : isOntology
                              ? `ontology term — ${agg.valueUri}`
                              : agg.display || undefined
                        }
                      >
                        {agg.isMixed ? (
                          // Mixed cells aren't directly editable —
                          // a single value would obliterate the
                          // per-bucket differentiation that's the
                          // whole point of a single-cell experiment.
                          // To edit per cell-type, expand the row
                          // (TODO: expand affordance).
                          <span>{agg.display}</span>
                        ) : matchedFactor ? (
                          <InlineFvPicker
                            value={agg.display}
                            placeholder="—"
                            options={matchedFactor.factor_values.map(
                              (fv) => fv.free_text_label,
                            )}
                            dirty={isDirty}
                            onCommit={(value) => {
                              for (const sn of allShortNames) {
                                onSetCharacteristic(sn, k, value);
                              }
                            }}
                          />
                        ) : (
                          <InlineText
                            value={agg.display}
                            placeholder="—"
                            dirty={isDirty}
                            onCommit={(value) => {
                              for (const sn of allShortNames) {
                                onSetCharacteristic(sn, k, value);
                              }
                            }}
                          />
                        )}
                      </td>
                    );
                  })}
                  {visibleFactors.map(({ factor, index }) => {
                    const agg = aggregateFvId(siblings, index);
                    return (
                      <td
                        key={`${repr.short_name}-f${factor.id}`}
                        className="px-3 py-0.5 border-l-2 border-blue-100"
                      >
                        <FvSelect
                          factor={factor}
                          currentFvId={agg.fvId}
                          isMixed={agg.isMixed}
                          onChange={(fvId) => {
                            for (const sn of allShortNames) {
                              onReassign(sn, factor.id, fvId);
                            }
                          }}
                        />
                      </td>
                    );
                  })}
                  {/* Proposal-overlay cells. One per proposal factor;
                      shows the agent's per-sample FV pick (or the
                      curator's override if reassigned), confidence-
                      colored. Click → dropdown to reassign. The
                      reassignment is keyed by ``factorIdx`` (index
                      into proposal.factors) so it round-trips
                      cleanly to ProposalCardV2's accept flow. */}
                  {proposalFactors.map((pf, pfi) => (
                    <td
                      key={`${repr.short_name}-pf${pfi}`}
                      className="px-3 py-0.5 border-l-2 border-amber-200 bg-amber-50/30"
                    >
                      <ProposalFvCell
                        factorIdx={pfi}
                        proposalFactor={pf}
                        siblings={siblings}
                        getReassignment={(sn) =>
                          getProposalReassignment(sn, pfi)
                        }
                        onReassign={(fvIdx) => {
                          for (const sn of allShortNames) {
                            setProposalReassignment(sn, pfi, fvIdx);
                          }
                        }}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
            {groupedRows.length === 0 ? (
              <tr>
                <td
                  className="px-3 py-3 text-slate-500"
                  colSpan={
                    3 +
                    (hasBioAssays ? 1 : 0) +
                    visibleCharKeys.length +
                    visibleFactors.length
                  }
                >
                  no samples match "{filter}"
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

    </div>
  );
}

function SortableTh({
  label,
  colKey,
  sort,
  onSortChange,
  className,
  title,
  sticky,
  badge,
}: {
  label: string;
  colKey: string;
  sort: SortState;
  onSortChange: (s: SortState) => void;
  className?: string;
  title?: string;
  sticky?: boolean;
  /** "char" for raw biomaterial characteristics; "factor" for
   *  curated experimental factors. Renders as a tiny pill above
   *  the label so curators can tell which is which at a glance. */
  badge?: "char" | "factor";
}) {
  const active = sort.key === colKey;
  const dir = active ? sort.dir : null;
  return (
    <th
      className={cn(
        "text-left font-medium px-3 py-2 align-bottom",
        sticky && "sticky left-8 bg-slate-50",
        className,
      )}
      title={title}
    >
      {badge ? (
        <span
          className={cn(
            "inline-block text-[9px] uppercase tracking-wide font-semibold px-1 py-0 rounded mb-0.5",
            badge === "char"
              ? "bg-slate-200 text-slate-700"
              : "bg-blue-200 text-blue-800",
          )}
          title={
            badge === "char"
              ? "raw biomaterial characteristic from GEO"
              : "curated experimental factor"
          }
        >
          {badge}
        </span>
      ) : null}
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-1 hover:text-slate-900 block",
          active ? "text-slate-900" : "text-slate-600",
        )}
        onClick={() =>
          onSortChange({
            key: colKey,
            dir: active && dir === "asc" ? "desc" : "asc",
          })
        }
      >
        {label}
        <span className="text-[10px] tabular-nums text-slate-400">
          {dir === "asc" ? "▲" : dir === "desc" ? "▼" : ""}
        </span>
      </button>
    </th>
  );
}

function FvSelect({
  factor,
  currentFvId,
  isMixed,
  onChange,
}: {
  factor: Factor;
  currentFvId: number | null;
  /** True when this row represents a collapsed group of BioMaterials
   *  whose siblings disagree on this factor. Visually flags the
   *  cell as a curation smell — design factors should apply at the
   *  source-sample level. Picking a value commits to all siblings. */
  isMixed?: boolean;
  onChange: (fvId: number) => void;
}) {
  // Three visual states: assigned (slate), unassigned (rose), or
  // mixed across siblings (amber). Mixed is its own state because
  // it's a curation warning specific to single-cell groups.
  const stateCls = isMixed
    ? "border-amber-400 text-amber-800 bg-amber-50"
    : currentFvId === null
      ? "border-rose-300 text-rose-700"
      : "border-slate-300 text-slate-800";
  const titleText = isMixed
    ? "siblings disagree on this factor — pick a value to apply to all of them"
    : currentFvId === null
      ? "unassigned — pick a value"
      : "click to reassign this sample";
  return (
    <select
      value={isMixed ? "" : (currentFvId ?? "")}
      onChange={(e) => {
        const id = Number(e.target.value);
        if (Number.isFinite(id) && (isMixed || id !== currentFvId)) onChange(id);
      }}
      className={cn(
        "text-xs border rounded px-1 py-0.5 bg-white max-w-[14rem] truncate",
        stateCls,
      )}
      title={titleText}
      onClick={(e) => e.stopPropagation()}
    >
      <option value="" disabled>
        {isMixed ? "— mixed —" : "— unassigned —"}
      </option>
      {factor.factor_values.map((fv) => (
        <option key={fv.id} value={fv.id}>
          {fv.free_text_label || `FV ${fv.id}`}
          {fv.is_baseline ? " · baseline" : ""}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Group-row aggregation helpers (single-cell grouping).

/**
 * Reduce a characteristic across the BioMaterials of one collapsed
 * row. If every sibling agrees on the value, return it as a normal
 * editable string. If they differ, summarise — the curator gets a
 * compact "top 2 + (+N more)" with the full list in the tooltip.
 *
 * Mixed cells aren't editable in this view: replacing the value
 * would erase the per-bucket differentiation that justifies a
 * single-cell experiment in the first place. (Cell type, organism
 * part when sliced per region, etc.)
 */
function aggregateCharValue(
  siblings: Biomaterial[],
  k: string,
): {
  display: string;
  isMixed: boolean;
  distinct: string[];
  /** value_uri agreed across siblings for this (key, value) — null
   *  when the characteristic has no ontology URI on any sibling, or
   *  when the row is mixed (distinct.length > 1). Mixed rows can't
   *  reliably attach a single URI. */
  valueUri: string | null;
  categoryUri: string | null;
} {
  const values = siblings.map((b) => (b.characteristics?.[k] ?? "").trim());
  const distinct = [...new Set(values.filter(Boolean))].sort();
  if (distinct.length <= 1) {
    const display = distinct[0] ?? "";
    // Pull the URI off any sibling that has it on this key (they
    // should agree when distinct.length === 1; first-non-null wins).
    let valueUri: string | null = null;
    let categoryUri: string | null = null;
    for (const b of siblings) {
      const u = b.characteristic_uris?.[k];
      if (!u) continue;
      if (!valueUri && u.value_uri) valueUri = u.value_uri;
      if (!categoryUri && u.category_uri) categoryUri = u.category_uri;
      if (valueUri && categoryUri) break;
    }
    return { display, isMixed: false, distinct, valueUri, categoryUri };
  }
  const display =
    distinct.length <= 2
      ? distinct.join(", ")
      : `${distinct.slice(0, 2).join(", ")} (+${distinct.length - 2} more)`;
  return { display, isMixed: true, distinct, valueUri: null, categoryUri: null };
}

/**
 * Reduce a factor's FV across the siblings of one collapsed row.
 * If every sibling is on the same FV, return it. If they differ,
 * return ``isMixed: true`` so the picker can render the
 * "(mixed)" warning state.
 */
function aggregateFvId(
  siblings: Biomaterial[],
  index: Map<string, { label: string; is_baseline: boolean; fv_id: number }>,
): { fvId: number | null; isMixed: boolean } {
  const ids = new Set<number | null>();
  for (const b of siblings) {
    ids.add(index.get(b.short_name)?.fv_id ?? null);
  }
  if (ids.size <= 1) {
    return { fvId: [...ids][0] ?? null, isMixed: false };
  }
  return { fvId: null, isMixed: true };
}

function BulkActionBar({
  factors,
  selectedShortNames,
  selectedGroupCount,
  fvByBmPerFactor,
  onApply,
  onClearSelection,
}: {
  factors: Factor[];
  selectedShortNames: string[];
  /** When the parent table is rendering grouped (single-cell)
   *  rows, the natural unit for the curator is "source samples",
   *  not the per-cell-type-bucket BM count. Pass a non-null value
   *  to surface "N source samples (M BMs)" instead of just "M
   *  selected". `null` reverts to the BM count. */
  selectedGroupCount?: number | null;
  /** Per-factor map sample-short-name → assigned FV id. Used to
   *  pre-fill the target dropdown with the existing value and to
   *  decide whether "apply" would actually change anything. */
  fvByBmPerFactor: {
    factor: Factor;
    index: Map<string, { label: string; is_baseline: boolean; fv_id: number }>;
  }[];
  onApply: (factorId: number, toFvId: number) => void;
  onClearSelection: () => void;
}) {
  const [factorId, setFactorId] = useState<number | null>(
    factors[0]?.id ?? null,
  );
  const factor = factors.find((f) => f.id === factorId) ?? null;
  const [fvId, setFvId] = useState<number | null>(null);

  // Index for the currently-chosen factor, so we can read each
  // selected sample's existing FV.
  const indexForFactor =
    fvByBmPerFactor.find((p) => p.factor.id === factorId)?.index ?? null;

  // Current-state summary across the selected samples for this
  // factor: distinct FV ids assigned, plus a count of how many
  // samples are currently unassigned.
  const currentFvIds = useMemo(() => {
    const set = new Set<number | null>();
    if (!indexForFactor) return set;
    for (const sn of selectedShortNames) {
      const hit = indexForFactor.get(sn);
      set.add(hit?.fv_id ?? null);
    }
    return set;
  }, [indexForFactor, selectedShortNames]);

  // Pre-fill the target dropdown: if every selected sample is on
  // the same FV, that's the resting state — show it as the
  // current value (and apply will be a no-op until the curator
  // picks something else). If they differ, leave it null and the
  // dropdown reads "(mixed)".
  useEffect(() => {
    if (currentFvIds.size === 1) {
      const only = [...currentFvIds][0];
      setFvId(only ?? null);
    } else {
      setFvId(null);
    }
  }, [factorId, currentFvIds]);

  // Target-FV options for the dropdown. The reset-when-factor-
  // changes logic lives in the effect above (deps include
  // ``factorId``); doing it here in render produced an extra render
  // pass and a StrictMode warning.
  const factorFvOptions = factor?.factor_values ?? [];

  // Defensive: when the chosen FV no longer exists in the current
  // factor's FV list (e.g. the curator deleted an FV from the
  // design while the bulk bar was open), drop the stale id. Effect-
  // not-render so we don't trigger an in-render setState warning.
  useEffect(() => {
    if (factor && fvId != null && !factor.factor_values.some((fv) => fv.id === fvId)) {
      setFvId(null);
    }
  }, [factor, fvId]);

  // How many of the selected samples would actually change if we
  // applied this assignment? Drives both the apply-button label
  // and its enabled state.
  const wouldChangeCount = useMemo(() => {
    if (fvId == null || !indexForFactor) return 0;
    let n = 0;
    for (const sn of selectedShortNames) {
      const cur = indexForFactor.get(sn)?.fv_id ?? null;
      if (cur !== fvId) n++;
    }
    return n;
  }, [fvId, indexForFactor, selectedShortNames]);

  const isMixed = currentFvIds.size > 1;

  return (
    <div className="bg-blue-50 border-b border-blue-200 px-3 py-2 flex items-center gap-3 flex-wrap text-xs">
      <span className="font-semibold text-blue-900">
        {selectedGroupCount != null
          ? `${selectedGroupCount} source sample${selectedGroupCount === 1 ? "" : "s"} (${selectedShortNames.length} BM${selectedShortNames.length === 1 ? "" : "s"})`
          : `${selectedShortNames.length} selected`}
      </span>
      <span className="text-blue-900/70">→ set</span>
      <select
        value={factorId ?? ""}
        onChange={(e) => {
          const v = e.target.value === "" ? null : Number(e.target.value);
          setFactorId(v);
        }}
        className="text-xs border border-slate-300 rounded px-1 py-0.5 bg-white"
      >
        {factors.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name || `factor#${f.id}`}
          </option>
        ))}
      </select>
      <span className="text-blue-900/70">to</span>
      <select
        value={fvId ?? ""}
        onChange={(e) =>
          setFvId(e.target.value === "" ? null : Number(e.target.value))
        }
        className="text-xs border border-slate-300 rounded px-1 py-0.5 bg-white max-w-[16rem]"
        disabled={!factor}
        title={
          isMixed
            ? "selected samples currently have different values for this factor"
            : undefined
        }
      >
        <option value="">
          {isMixed ? "— mixed; pick to set all —" : "— unassigned —"}
        </option>
        {factorFvOptions.map((fv) => (
          <option key={fv.id} value={fv.id}>
            {fv.free_text_label || `FV ${fv.id}`}
            {fv.is_baseline ? " · baseline" : ""}
          </option>
        ))}
      </select>
      {wouldChangeCount > 0 ? (
        <button
          type="button"
          className="btn primary text-xs"
          onClick={() => {
            if (factorId != null && fvId != null) onApply(factorId, fvId);
          }}
        >
          apply to {wouldChangeCount} sample
          {wouldChangeCount === 1 ? "" : "s"}
        </button>
      ) : (
        <span className="text-[11px] text-blue-900/60 italic">
          {fvId == null
            ? "pick a value to apply"
            : "all selected samples already have this value"}
        </span>
      )}
      <button
        type="button"
        className="btn ghost text-xs ml-auto"
        onClick={onClearSelection}
      >
        clear selection
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function collectCharacteristicKeys(biomaterials: Biomaterial[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of biomaterials) {
    for (const k of Object.keys(b.characteristics ?? {})) {
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
  }
  return out;
}

function indexFvByBiomaterial(
  factor: Factor,
): Map<string, { label: string; is_baseline: boolean; fv_id: number }> {
  const out = new Map<
    string,
    { label: string; is_baseline: boolean; fv_id: number }
  >();
  for (const fv of factor.factor_values) {
    for (const sn of fv.biomaterial_short_names) {
      out.set(sn, {
        label: fv.free_text_label,
        is_baseline: fv.is_baseline,
        fv_id: fv.id,
      });
    }
  }
  return out;
}

function sortBiomaterials(
  rows: Biomaterial[],
  sort: SortState,
  fvByBmPerFactor: { factor: Factor; index: Map<string, { label: string; fv_id: number }> }[],
): Biomaterial[] {
  const copy = rows.slice();
  const dir = sort.dir === "asc" ? 1 : -1;

  const cmp = (a: Biomaterial, b: Biomaterial): number => {
    const av = sortValue(a, sort.key, fvByBmPerFactor);
    const bv = sortValue(b, sort.key, fvByBmPerFactor);
    if (av === bv) return 0;
    // empty values sort last regardless of direction
    if (av === "" && bv !== "") return 1;
    if (bv === "" && av !== "") return -1;
    return av < bv ? -dir : dir;
  };

  copy.sort(cmp);
  return copy;
}

function sortValue(
  b: Biomaterial,
  key: string,
  fvByBmPerFactor: { factor: Factor; index: Map<string, { label: string; fv_id: number }> }[],
): string {
  if (key === "short_name") return b.short_name.toLowerCase();
  if (key === "name") return (b.name ?? "").toLowerCase();
  if (key === "bio_assay") {
    const a = b.bio_assays?.[0];
    return ((a?.name || a?.short_name) ?? "").toLowerCase();
  }
  if (key.startsWith("char:")) {
    const k = key.slice("char:".length);
    return (b.characteristics?.[k] ?? "").toLowerCase();
  }
  if (key.startsWith("factor:")) {
    const fid = Number(key.slice("factor:".length));
    const slot = fvByBmPerFactor.find((s) => s.factor.id === fid);
    const hit = slot?.index.get(b.short_name);
    return (hit?.label ?? "").toLowerCase();
  }
  return "";
}


// ---------------------------------------------------------------------------
// ProposalFvCell — per-cell editor for the proposal-overlay columns
// ---------------------------------------------------------------------------

/**
 * One cell of a proposal-overlay column. Reads the agent's
 * per-sample FV pick and confidence (from the proposal's
 * ``biomaterial_assignment_meta``); curator clicks to override via
 * a dropdown of the factor's FVs. Overrides land on
 * ProposalReviewContext, where the v2 ProposalCard reads them at
 * accept time.
 *
 * Single-cell groups: when several biomaterials share a
 * ``source_biomaterial_id`` (single-cell datasets), a click
 * reassigns ALL siblings together — same as the FvSelect for design
 * factors. The cell visualizes "(mixed)" when siblings disagree on
 * the proposal's pick.
 */
function ProposalFvCell({
  factorIdx,
  proposalFactor,
  siblings,
  getReassignment,
  onReassign,
}: {
  factorIdx: number;
  proposalFactor: FactorProposal;
  siblings: Biomaterial[];
  getReassignment: (shortName: string) => number | undefined;
  onReassign: (fvIdx: number) => void;
}) {
  // Resolve each sibling's FV (curator override > agent pick > unassigned).
  // Then collapse to one value-or-mixed for the row.
  const perSibling = siblings.map((b) => {
    const reassigned = getReassignment(b.short_name);
    if (reassigned !== undefined) {
      return { fvIdx: reassigned, source: "curator" as const, meta: undefined };
    }
    for (let vi = 0; vi < proposalFactor.factor_values.length; vi++) {
      const fv = proposalFactor.factor_values[vi];
      if (fv.biomaterial_short_names.includes(b.short_name)) {
        const meta = fv.biomaterial_assignment_meta?.find(
          (m: BiomaterialAssignmentMeta) =>
            m.biomaterial_short_name === b.short_name,
        );
        return { fvIdx: vi, source: "agent" as const, meta };
      }
    }
    return { fvIdx: -1, source: "unassigned" as const, meta: undefined };
  });
  const distinct = new Set(perSibling.map((p) => p.fvIdx));
  const isMixed = distinct.size > 1;
  const fvIdx = isMixed ? -1 : (perSibling[0]?.fvIdx ?? -1);
  const isReassigned = !isMixed && perSibling[0]?.source === "curator";
  const meta = isMixed ? undefined : perSibling[0]?.meta;

  // Visual state — three colours mirroring the FvSelect pattern but
  // with confidence-driven shading.
  let stateCls = "border-slate-300 text-slate-800";
  if (isMixed) {
    stateCls = "border-amber-400 text-amber-800 bg-amber-50";
  } else if (fvIdx === -1) {
    stateCls = "border-rose-300 text-rose-700";
  } else if (isReassigned) {
    stateCls = "border-amber-500 text-amber-900 bg-amber-100";
  } else if (meta?.confidence === "low") {
    stateCls = "border-rose-300 text-rose-700 bg-rose-50/40";
  } else if (meta?.confidence === "medium") {
    stateCls = "border-amber-300 text-amber-800";
  }

  const titleParts: string[] = [];
  if (isMixed) {
    titleParts.push("siblings disagree on this factor — pick a value to apply to all");
  } else if (fvIdx === -1) {
    titleParts.push("no agent assignment — pick a factor value");
  } else {
    if (isReassigned) titleParts.push("curator-reassigned");
    else if (meta?.confidence) {
      titleParts.push(`agent confidence: ${meta.confidence}`);
    }
    if (meta?.source) titleParts.push(`source: ${meta.source}`);
    if (meta?.rationale) titleParts.push(meta.rationale);
  }

  return (
    <select
      className={
        "text-xs rounded border bg-white px-1 py-0.5 max-w-full truncate " +
        stateCls
      }
      value={fvIdx === -1 ? "" : String(fvIdx)}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "") return;
        onReassign(Number(v));
      }}
      title={titleParts.join(" · ")}
    >
      {fvIdx === -1 ? <option value="">(unassigned)</option> : null}
      {isMixed ? <option value="">(mixed)</option> : null}
      {proposalFactor.factor_values.map(
        (fv: FactorValueProposal, vi: number) => (
          <option key={vi} value={vi}>
            {fv.free_text_label ||
              fv.statements?.[0]?.subject?.label ||
              `FV ${vi}`}
            {fv.is_baseline ? " · baseline" : ""}
          </option>
        ),
      )}
    </select>
  );
}

// ---------------------------------------------------------------------------
// BulkAssignModal — toolbar entry point for bulk reassignment
// ---------------------------------------------------------------------------

/**
 * Modal wrapper around BulkAssignPanel. The Sample tab needs a
 * factor picker (which factor are we mapping a characteristic to?)
 * before the panel itself can render — the Design tab's
 * SampleAssignmentPreview was always already scoped to one factor,
 * so it skipped this step. Here we surface a small dropdown at the
 * top of the modal; switching it remounts the panel with the new
 * factor's FV options.
 */
function BulkAssignModal({
  factors,
  biomaterials,
  initialFactor,
  onApply,
  onCancel,
}: {
  factors: Factor[];
  biomaterials: Biomaterial[];
  initialFactor: Factor;
  onApply: (factorId: number, plan: Map<string, number>) => void;
  onCancel: () => void;
}) {
  const [factorId, setFactorId] = useState<number>(initialFactor.id);
  const factor = factors.find((f) => f.id === factorId) ?? initialFactor;
  return (
    <div
      className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center px-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded shadow-lg max-w-2xl w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between gap-3">
          <span className="font-semibold text-slate-800 text-sm">
            Bulk assign
          </span>
          <label className="text-xs text-slate-700 inline-flex items-center gap-1">
            target factor:
            <select
              value={factorId}
              onChange={(e) => setFactorId(Number(e.target.value))}
              className="text-xs border border-slate-300 rounded px-1.5 py-0.5 bg-white"
            >
              {factors.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name || `factor#${f.id}`}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-700"
            onClick={onCancel}
            aria-label="cancel"
          >
            ×
          </button>
        </div>
        <div className="px-3 py-3">
          <BulkAssignPanel
            // Remount on factor change so suggested-plan recomputes
            // against the new FV labels.
            key={factor.id}
            factor={factor}
            biomaterials={biomaterials}
            onApply={(plan) => onApply(factor.id, plan)}
            onCancel={onCancel}
          />
        </div>
      </div>
    </div>
  );
}
