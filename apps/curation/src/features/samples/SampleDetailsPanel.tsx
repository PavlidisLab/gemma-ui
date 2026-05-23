import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import {
  addCategoricalFactorFromCharacteristic,
  addContinuousFactorFromCharacteristic,
  isContinuousCharacteristic,
  reassignSample,
  reassignSamples,
  setBiomaterialCharacteristic,
  setBiomaterialName,
} from "@/features/design/mutations";
import { useToast } from "@/components/ui/Toast";
import { InlineText } from "@/components/ui/InlineText";
import { sampleExternalUrl } from "@/lib/gemmaUrls";
import { InlineFvPicker } from "@/components/ui/InlineFvPicker";
import { useStickyState } from "@/lib/useStickyState";
import { useEscape } from "@/lib/useEscape";
import type {
  Biomaterial,
  Design,
  Factor,
  Statement,
} from "@/features/experiment/types";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/Tooltip";
import { Fragment } from "react";
import { BulkAssignPanel } from "@/features/samples/BulkAssignPanel";
import { useProposalReview } from "@/features/proposal/ProposalReviewContext";
import {
  parseAgentProposalPayload,
  useProposalsAutoShape,
} from "@/api/agentProposals";
import { AuditDot } from "@/features/audit/AuditDot";
import { assignmentTarget } from "@/features/audit/targetIds";
import { onSamplesScrollRow } from "@/lib/scrollToSample";
import { BiomaterialMetaPopover } from "./BiomaterialMetaPopover";
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
  const toast = useToast();
  // After a "+ promote to factor" click, the new factor appears as
  // the rightmost column in the sample table — frequently outside
  // the viewport. Track the just-promoted id and scroll its column
  // header into view once React has committed the new design.
  // Cleared after scroll so subsequent renders don't re-scroll.
  const [scrollToFactorId, setScrollToFactorId] = useState<number | null>(null);
  useEffect(() => {
    if (scrollToFactorId == null) return;
    // requestAnimationFrame so the layout has settled (the new
    // column has been inserted in the DOM) before we measure +
    // scroll. Without it the scroll lands a frame too early on
    // wider tables and ends up short of target.
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-factor-id="${scrollToFactorId}"]`,
      );
      if (el) {
        el.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center",
        });
      }
      setScrollToFactorId(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollToFactorId]);
  // Cross-tab "jump to this sample" — listener now lives in
  // SampleTable so it has access to the row virtualizer (rows
  // outside the current overscan window aren't in the DOM; the
  // virtualizer's scrollToIndex puts them there before the DOM
  // querySelector runs). See SampleTable for the implementation.
  // ``filter`` (the search box) stays ephemeral — re-typing on a
  // new experiment is fine, and a stale filter from a different
  // experiment would just hide rows confusingly. Sort preference
  // is sticky: curators tend to want one sort across experiments.
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useStickyState<SortState>(
    "samples.sort",
    { key: "short_name", dir: "asc" },
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Order matters: a transient ``draft === null`` post-reset would
  // otherwise show as a bogus error (react-query reports
  // ``isFetching`` not ``isLoading`` on a refetch).
  if (loadError) {
    return (
      <div className="card p-4 text-sm text-rose-700">
        couldn't load samples for experiment {experimentId}: {loadError}
      </div>
    );
  }
  if (isLoading || !draft) {
    return (
      <div className="card p-4 text-sm text-slate-500">loading samples…</div>
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
      onPromoteCharacteristic={(key) => {
        // Lift a BM characteristic into a first-class Factor. Kind
        // is auto-detected: numeric → continuous (one FV per sample,
        // measurement as label); otherwise categorical (one FV per
        // distinct value, BMs grouped). Single composed apply so the
        // FactorList reflects the new factor on the next render;
        // capture the factor id and queue a horizontal scroll so the
        // freshly-added column doesn't sit off-screen.
        apply((d) => {
          const isContinuous = isContinuousCharacteristic(d.biomaterials, key);
          if (isContinuous) {
            const { design: next, sampleCount, factorId } =
              addContinuousFactorFromCharacteristic(d, key);
            toast.show(
              `Promoted "${key}" to continuous factor (${sampleCount} sample${sampleCount === 1 ? "" : "s"}).`,
              "success",
            );
            setScrollToFactorId(factorId);
            return next;
          }
          const { design: next, sampleCount, fvCount, factorId } =
            addCategoricalFactorFromCharacteristic(d, key);
          toast.show(
            `Promoted "${key}" to categorical factor (${fvCount} value${fvCount === 1 ? "" : "s"} · ${sampleCount} sample${sampleCount === 1 ? "" : "s"}).`,
            "success",
          );
          setScrollToFactorId(factorId);
          return next;
        });
      }}
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
  onPromoteCharacteristic,
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
  onPromoteCharacteristic: (key: string) => void;
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
  // Char keys whose values are mostly numeric — eligible for the
  // "promote to continuous factor" affordance in the column header.
  // Computed once across the whole cohort so flipping the threshold
  // doesn't fan out to per-row work.
  const continuousCharKeys = useMemo(() => {
    const s = new Set<string>();
    for (const k of charKeys) {
      if (isContinuousCharacteristic(design.biomaterials, k)) s.add(k);
    }
    return s;
  }, [charKeys, design.biomaterials]);
  // Skip the affordance when a Factor with the same category label
  // already exists (avoid double-promotion). Lower-cased for
  // case-insensitive match against the char key.
  const factorCategoryLabels = useMemo(() => {
    const s = new Set<string>();
    for (const f of design.factors) {
      const k = (f.category.label || "").trim().toLowerCase();
      if (k) s.add(k);
    }
    return s;
  }, [design.factors]);
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

  // For the inline per-cell confidence ⚠ markers we don't want to
  // require the curator to have activated a proposal — the iffy-
  // assignment signal is useful any time there's a pending agent
  // proposal for this experiment, even when the overlay column
  // isn't being rendered. Fall back to the latest pending proposal
  // via ``useProposalsAutoShape``, which transparently handles both
  // the legacy ``{items, total}`` envelope and the new-shape flat
  // list of ``AgentProposal`` rows that ``local_api/server.py`` now
  // returns by default when an ``agent_proposal`` row exists for
  // the dataset (``shape=auto``).
  const { data: pendingProposalsAuto } = useProposalsAutoShape(
    design.experiment_id,
  );

  // ``confidenceRows`` is the data the maps below consume —
  // ``{category, biomaterial_short_name, confidence}`` triples from
  // whatever proposal shape we ended up with. Normalising at the
  // boundary keeps the existing ``confBySampleAndFactor`` /
  // ``worstConfBySample`` loops shape-agnostic.
  const confidenceRows = useMemo(() => {
    const rows: Array<{
      category: string;
      biomaterial_short_name: string;
      confidence: string;
    }> = [];
    const pushFromFactorProposals = (factors: FactorProposal[]) => {
      for (const f of factors) {
        const cat = (f.category?.label || "").toLowerCase();
        if (!cat) continue;
        for (const fv of f.factor_values) {
          for (const m of fv.biomaterial_assignment_meta ?? []) {
            rows.push({
              category: cat,
              biomaterial_short_name: m.biomaterial_short_name,
              confidence: (m.confidence || "").toLowerCase(),
            });
          }
        }
      }
    };
    // 1. Activated proposal (the overlay column) — highest priority,
    //    matches the column the curator's already looking at.
    if (proposalFactors.length > 0) {
      pushFromFactorProposals(proposalFactors);
      return rows;
    }
    // 2. Auto-shape fetch: handle both new (array of AgentProposal
    //    rows with payload_json) and legacy ({items: Proposal[]})
    //    shapes the endpoint can return.
    if (!pendingProposalsAuto) return rows;
    if (pendingProposalsAuto.kind === "new") {
      // Newest first. ``ran_at`` is the agent run timestamp — ISO,
      // lexically chronological.
      const sorted = [...pendingProposalsAuto.items].sort((a, b) =>
        (b.ran_at || "").localeCompare(a.ran_at || ""),
      );
      for (const ap of sorted) {
        const payload = parseAgentProposalPayload(ap.payload_json);
        if (!payload?.design?.proposed_factors?.length) continue;
        for (const af of payload.design.proposed_factors) {
          const cat = (af.category || "").toLowerCase();
          if (!cat) continue;
          for (const fv of af.factor_values) {
            for (const m of fv.biomaterial_assignment_meta ?? []) {
              rows.push({
                category: cat,
                biomaterial_short_name: m.biomaterial_short_name,
                confidence: (m.confidence || "").toLowerCase(),
              });
            }
          }
        }
        if (rows.length > 0) return rows; // first proposal with meta wins
      }
      return rows;
    }
    // Legacy envelope.
    const items = pendingProposalsAuto.items;
    const sorted = [...items].sort((a, b) =>
      (b.submitted_at || "").localeCompare(a.submitted_at || ""),
    );
    for (const p of sorted) {
      if (p.factors && p.factors.length > 0) {
        pushFromFactorProposals(p.factors);
        if (rows.length > 0) return rows;
      }
    }
    return rows;
  }, [proposalFactors, pendingProposalsAuto]);

  // Per-sample worst-confidence summary across all proposal factors.
  // A sample is flagged when ANY of its FV assignments has
  // ``confidence != "high"``; "low" wins over "medium" wins over
  // "high". Powers a small dot in the short_name column so the
  // curator can scan the table for iffy assignments without opening
  // every FV cell's tooltip.
  const worstConfBySample = useMemo(() => {
    const out = new Map<string, "low" | "medium">();
    const rank = (c: string) => (c === "low" ? 2 : c === "medium" ? 1 : 0);
    for (const r of confidenceRows) {
      if (r.confidence !== "low" && r.confidence !== "medium") continue;
      const prev = out.get(r.biomaterial_short_name);
      if (!prev || rank(r.confidence) > rank(prev)) {
        out.set(r.biomaterial_short_name, r.confidence as "low" | "medium");
      }
    }
    return out;
  }, [confidenceRows]);

  // Same signal as ``worstConfBySample`` but keyed by
  // ``${short_name}|${category_label_lower}`` so the per-factor FV
  // cells can render an inline ⚠ for the specific column that's
  // iffy. The factor-id isn't stable across proposal vs design
  // factor objects, so we key on the lowercased category label
  // (the shape both sides share).
  const confBySampleAndFactor = useMemo(() => {
    const out = new Map<string, "low" | "medium">();
    const rank = (c: string) => (c === "low" ? 2 : c === "medium" ? 1 : 0);
    for (const r of confidenceRows) {
      if (r.confidence !== "low" && r.confidence !== "medium") continue;
      const key = `${r.biomaterial_short_name}|${r.category}`;
      const prev = out.get(key);
      if (!prev || rank(r.confidence) > rank(prev)) {
        out.set(key, r.confidence as "low" | "medium");
      }
    }
    return out;
  }, [confidenceRows]);
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
  // across every visible row. ``hideConstant`` is sticky across
  // experiments — curators consistently want or don't want
  // constant columns; the column-filter substring is ephemeral.
  const [colFilter, setColFilter] = useState("");
  const [hideConstant, setHideConstant] = useStickyState<boolean>(
    "samples.hideConstant",
    false,
  );
  // Per-column widths the curator has dragged. Keyed by `colKey` (same
  // value passed to SortableTh), persisted across experiments — a wide
  // "name" column is wide because *names* tend to be long, regardless
  // of dataset, so the preference travels. Empty entries fall back to
  // browser auto-sizing. Cleared per-column by double-clicking the
  // drag handle.
  const [colWidths, setColWidths] = useStickyState<Record<string, number>>(
    "samples.colWidths",
    {},
  );
  const setColWidth = (colKey: string, width: number | null) => {
    setColWidths((prev) => {
      if (width == null) {
        if (!(colKey in prev)) return prev;
        const { [colKey]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [colKey]: Math.round(width) };
    });
  };
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
  const [collapseGroups, setCollapseGroups] = useStickyState<boolean>(
    "samples.collapseGroups",
    true,
  );

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

  // Push nuisance (block / batch) factors to the right end of the
  // factor cluster so the biological factors a curator is iterating
  // on stay closest to the row identifiers. The check matches how
  // the rest of the codebase identifies nuisance factors (Overview's
  // confound chip, PrePublishChecklist, ProposalCardV2): category
  // label is exactly "block" or "batch", case-insensitive. Order
  // among nuisance factors mirrors their original order; same for
  // biological factors. A stable sort keeps both sides predictable.
  const orderedFactors = useMemo(() => {
    const list = [...visibleFactors];
    list.sort((a, b) => {
      const aN = isNuisanceFactor(a.factor);
      const bN = isNuisanceFactor(b.factor);
      if (aN === bN) return 0;
      return aN ? 1 : -1;
    });
    return list;
  }, [visibleFactors]);

  // Row filter — searches every searchable field on the BM, regardless
  // of which columns the curator has hidden. The constancy / column-
  // filter toggles only affect what's *displayed*; an accession typed
  // into the search box should always find its row even if the column
  // it lives in is currently off-screen (e.g. a `geo_accession`
  // characteristic the curator collapsed via "hide constant", or a
  // bio_assay column auto-suppressed because it duplicates the BM's
  // short_name).
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return design.biomaterials;
    return design.biomaterials.filter((b) => {
      if (b.short_name.toLowerCase().includes(q)) return true;
      if (b.name.toLowerCase().includes(q)) return true;
      for (const a of b.bio_assays ?? []) {
        if (a.short_name.toLowerCase().includes(q)) return true;
        if ((a.name ?? "").toLowerCase().includes(q)) return true;
      }
      // All characteristics, not just visible ones — accessions
      // hiding in a constant column still need to be findable.
      for (const k of charKeys) {
        const v = b.characteristics?.[k] ?? "";
        if (String(v).toLowerCase().includes(q)) return true;
      }
      // All factors, including constant / off-screen ones.
      for (const { factor, index } of fvByBmPerFactor) {
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
  }, [design.biomaterials, filter, charKeys, fvByBmPerFactor]);

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

  // --- Row virtualization --------------------------------------------
  // Big experiments (1000+ samples) and single-cell datasets pre-
  // collapse can put thousands of <tr>s in the DOM on tab change.
  // Synchronous render time scales linearly; Chrome flags it as a
  // 500ms+ long task. We virtualize the body so only the visible
  // window + a small overscan ring renders.
  //
  // Mechanics:
  //  - `scrollRef` is the scrolling <div> that wraps the <table>.
  //  - `useVirtualizer` measures it and reports which `groupedRows`
  //    indices fall in/near the viewport.
  //  - We render two spacer <tr>s with `height: paddingTop /
  //    paddingBottom` (single empty <td colSpan>) flanking the
  //    visible rows. This keeps a single <table> + sticky <thead>;
  //    column widths set by the resize handle on <th> still apply.
  //  - `estimateSize` matches the dense `py-0.5` rows (~26px).
  //    `measureElement` corrects per-row drift so multi-line cells
  //    (long names, multi-assay BMs) measure right.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: groupedRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 26,
    overscan: 10,
    // The <tr>'s own offsetHeight is what we want; default
    // measureElement reads getBoundingClientRect on the
    // ref'd element, which works fine on a table row.
  });

  // Cross-tab "jump to this sample" — see scrollToSample.ts. When
  // the target row's index is currently outside the virtualized
  // window we ask the virtualizer to scroll to it first, then on
  // the next frame the <tr data-bm-shortname=…> exists and we can
  // ring-highlight it.
  useEffect(() => {
    return onSamplesScrollRow(({ shortName }) => {
      const idx = groupedRows.findIndex((r) =>
        r.allShortNames.includes(shortName),
      );
      if (idx < 0) return;
      // Virtualizer scrollToIndex (centre alignment matches the
      // pre-virtualization scrollIntoView({block:"center"})).
      rowVirtualizer.scrollToIndex(idx, { align: "center" });
      // Two RAFs: first lets the virtualizer mount the row, second
      // lets layout settle so getBoundingClientRect on the ring
      // matches.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const safe =
            typeof CSS !== "undefined" && typeof CSS.escape === "function"
              ? CSS.escape(shortName)
              : shortName.replace(/"/g, '\\"');
          const el = document.querySelector<HTMLTableRowElement>(
            `tr[data-bm-shortname="${safe}"]`,
          );
          if (!el) return;
          el.classList.add("ring-2", "ring-blue-400", "ring-inset");
          window.setTimeout(() => {
            el.classList.remove("ring-2", "ring-blue-400", "ring-inset");
          }, 1800);
        });
      });
    });
  }, [groupedRows, rowVirtualizer]);

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? totalSize - virtualItems[virtualItems.length - 1].end
      : 0;
  // Number of columns the spacer <td colSpan> needs to cover so the
  // spacer rows don't visually collapse on narrow tables.
  const totalColCount =
    1 /* gutter */ +
    2 /* short_name, name */ +
    (hasBioAssays ? 1 : 0) +
    orderedFactors.length +
    visibleCharKeys.length +
    proposalFactors.length;

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

      {/* The table itself is the vertical scroll container. Capping at
          `100vh - 15rem` leaves room for the top bar + experiment
          banner + the panel's own filter row above without the table
          ever pushing the proposals/audit sidebar off-screen. The
          thead is sticky against this same scroll context, so column
          headers stay visible while the curator scans down. */}
      <div
        ref={scrollRef}
        className="overflow-auto max-h-[calc(100vh-15rem)]"
      >
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600 sticky top-0 z-20">
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
                width={colWidths["short_name"]}
                onResize={(w) => setColWidth("short_name", w)}
              />
              <SortableTh
                label="name"
                colKey="name"
                sort={sort}
                onSortChange={onSortChange}
                width={colWidths["name"]}
                onResize={(w) => setColWidth("name", w)}
              />
              {hasBioAssays ? (
                <SortableTh
                  label="bio_assay"
                  colKey="bio_assay"
                  sort={sort}
                  onSortChange={onSortChange}
                  width={colWidths["bio_assay"]}
                  onResize={(w) => setColWidth("bio_assay", w)}
                />
              ) : null}
              {/* Factor columns sit immediately after the row-identifier
                  columns so curators don't have to scroll past a wide
                  block of characteristics to reach the curated
                  annotations. Characteristics follow. */}
              {orderedFactors.map(({ factor }) => {
                const colKey = `factor:${factor.id}`;
                const nuisance = isNuisanceFactor(factor);
                return (
                  <SortableTh
                    key={`f-${factor.id}`}
                    label={factor.name || `factor#${factor.id}`}
                    colKey={colKey}
                    sort={sort}
                    onSortChange={onSortChange}
                    badge="factor"
                    className="bg-blue-50/50 border-l-2 border-blue-200"
                    title={
                      (factor.description || `factor#${factor.id}`) +
                      (nuisance ? " · nuisance factor (batch / block)" : "") +
                      (constantFactorIds.has(factor.id)
                        ? " · constant across visible rows"
                        : "")
                    }
                    dataFactorId={factor.id}
                    width={colWidths[colKey]}
                    onResize={(w) => setColWidth(colKey, w)}
                  />
                );
              })}
              {visibleCharKeys.map((k) => {
                const colKey = `char:${k}`;
                const isContinuous = continuousCharKeys.has(k);
                const alreadyAFactor = factorCategoryLabels.has(
                  k.trim().toLowerCase(),
                );
                // Constant-across-cohort characteristics shouldn't
                // be promoted — a single-FV factor has nothing to
                // partition. Show promote on every other non-factor
                // column; the parent's onPromoteCharacteristic
                // dispatches to the continuous or categorical
                // mutation based on the values' shape.
                // Continuous numberlike chars stay promote-eligible
                // even when a factor with the same category label
                // already exists (the existing one may be
                // categorical / curator-built, and the char's
                // numeric distribution is its own first-class
                // factor worth surfacing). Categorical chars
                // still hide the button when a like-named factor
                // is already present. Per Paul 2026-05-21.
                const showPromote = isContinuous
                  ? !constantCharKeys.has(k)
                  : !alreadyAFactor && !constantCharKeys.has(k);
                const promoteTooltip = isContinuous
                  ? `Promote "${k}" to a continuous factor — one FV per sample, with the measurement as the value`
                  : `Promote "${k}" to a categorical factor — one FV per distinct value, samples assigned automatically`;
                return (
                  <SortableTh
                    key={`char-${k}`}
                    label={k}
                    colKey={colKey}
                    sort={sort}
                    onSortChange={onSortChange}
                    badge="char"
                    className="bg-slate-50 border-l border-slate-200/60"
                    title={`raw biomaterial characteristic — sourced from GEO sample metadata${
                      constantCharKeys.has(k) ? " · constant across visible rows" : ""
                    }${isContinuous ? " · numeric" : ""}`}
                    extra={
                      showPromote ? (
                        <button
                          type="button"
                          className="text-[10px] text-blue-700 hover:text-blue-900 underline underline-offset-2 mt-0.5"
                          onClick={(e) => {
                            e.stopPropagation();
                            onPromoteCharacteristic(k);
                          }}
                          title={promoteTooltip}
                        >
                          + promote to factor
                        </button>
                      ) : undefined
                    }
                    width={colWidths[colKey]}
                    onResize={(w) => setColWidth(colKey, w)}
                  />
                );
              })}
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
            {paddingTop > 0 ? (
              <tr aria-hidden="true" style={{ height: paddingTop }}>
                <td colSpan={totalColCount} />
              </tr>
            ) : null}
            {virtualItems.map((vi) => {
              const idx = vi.index;
              const row = groupedRows[idx];
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
                  ref={rowVirtualizer.measureElement}
                  data-index={idx}
                  // Stable hooks for the cross-tab "scroll to sample"
                  // jump (see scrollToSample.ts). The first attribute
                  // is the representative short_name; the second is a
                  // comma-joined list of every constituent BM in this
                  // row, so a grouped (single-cell) row matches a
                  // request that names a child bucket. Selector form
                  // for the latter:
                  // tr[data-bm-all-shortnames~="…"] — not currently
                  // used by the panel itself but available to future
                  // callers that want exact-bucket matches.
                  data-bm-shortname={repr.short_name}
                  data-bm-all-shortnames={allShortNames.join(",")}
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
                    {(() => {
                      // Link out to the source-database page when the
                      // biomaterial's short_name matches a known per-
                      // sample accession scheme (GSM on GEO today).
                      // Falls back to plain text otherwise — internal
                      // aliases / CELLxGENE / etc. don't have a stable
                      // public URL.
                      const url = sampleExternalUrl(
                        design.external_source?.database,
                        repr.short_name,
                      );
                      if (!url) return repr.short_name;
                      return (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-700 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                          title={`open ${repr.short_name} in source database`}
                        >
                          {repr.short_name}
                        </a>
                      );
                    })()}
                    {isGroup ? (
                      <span
                        className="ml-1.5 inline-flex items-center text-[10px] font-semibold uppercase tracking-wide px-1 py-0 rounded bg-violet-100 text-violet-900 border border-violet-200"
                        title={`single-cell: ${groupSize} cell-type buckets collapsed into this row`}
                      >
                        +{groupSize - 1}
                      </span>
                    ) : null}
                    {(() => {
                      // Confidence flag — surfaces a small dot next
                      // to the short_name when ANY proposal factor's
                      // FV assigned this sample with low/medium
                      // confidence. Lets a curator scan the table
                      // for iffy assignments without expanding each
                      // factor cell's tooltip. For grouped (single-
                      // cell) rows we take the worst across siblings.
                      let worst: "low" | "medium" | undefined;
                      for (const sn of allShortNames) {
                        const c = worstConfBySample.get(sn);
                        if (c === "low") {
                          worst = "low";
                          break;
                        }
                        if (c === "medium") worst = "medium";
                      }
                      if (!worst) return null;
                      const dotCls =
                        worst === "low"
                          ? "bg-rose-500"
                          : "bg-amber-500";
                      const tip =
                        worst === "low"
                          ? "low-confidence assignment on this sample — verify before retaining"
                          : "medium-confidence assignment on this sample — spot-check before retaining";
                      return (
                        <span
                          className={cn(
                            "ml-1.5 inline-block align-middle w-1.5 h-1.5 rounded-full",
                            dotCls,
                          )}
                          title={tip}
                        />
                      );
                    })()}
                    {/* Inline audit indicator anchored to this
                        biomaterial's assignment finding (if any).
                        For grouped (single-cell) rows, the dot
                        anchors to the representative's short_name —
                        consistent with how the dropdown / per-row
                        edits already fan out across the bucket. */}
                    <span className="ml-1 align-baseline">
                      <AuditDot
                        targetId={assignmentTarget(repr.short_name)}
                      />
                    </span>
                    {/* "i" chip — reveals every per-BM field, including
                        characteristics the curator has hidden via
                        column-filter / hide-constant. Click-to-open
                        popover; click-outside / Esc closes. */}
                    <BiomaterialMetaPopover
                      bm={repr}
                      source={design.external_source}
                      groupSize={groupSize}
                    />
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
                          const url = sampleExternalUrl(
                            design.external_source?.database,
                            a.short_name,
                          );
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
                              {url ? (
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-mono text-[10px] text-blue-700 hover:underline"
                                  onClick={(e) => e.stopPropagation()}
                                  title={`open ${a.short_name} in source database`}
                                >
                                  {a.short_name}
                                </a>
                              ) : (
                                <span className="font-mono text-[10px] text-slate-500">
                                  {a.short_name}
                                </span>
                              )}
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
                  {orderedFactors.map(({ factor, index }) => {
                    const agg = aggregateFvId(siblings, index);
                    // Per-cell confidence — worst across the row's
                    // siblings for this specific factor. Lights up a
                    // small ⚠ next to the dropdown when the agent's
                    // assignment came in below high confidence, so
                    // the curator can scan the table column-by-
                    // column and spot which (sample, factor) pairs
                    // need a second look.
                    const factorCat = (
                      factor.category?.label || ""
                    ).toLowerCase();
                    let cellConf: "low" | "medium" | undefined;
                    if (factorCat) {
                      for (const sn of allShortNames) {
                        const c = confBySampleAndFactor.get(
                          `${sn}|${factorCat}`,
                        );
                        if (c === "low") {
                          cellConf = "low";
                          break;
                        }
                        if (c === "medium") cellConf = "medium";
                      }
                    }
                    return (
                      <td
                        key={`${repr.short_name}-f${factor.id}`}
                        className="px-3 py-0.5 border-l-2 border-blue-100"
                      >
                        <span className="inline-flex items-center gap-1">
                          {cellConf ? (
                            <span
                              className={cn(
                                "text-[11px] leading-none shrink-0 cursor-help",
                                cellConf === "low"
                                  ? "text-rose-600 dark:text-rose-400"
                                  : "text-amber-600 dark:text-amber-400",
                              )}
                              title={
                                cellConf === "low"
                                  ? "low-confidence agent assignment on this sample for this factor — verify before retaining"
                                  : "medium-confidence agent assignment on this sample for this factor — spot-check before retaining"
                              }
                              aria-label={`${cellConf}-confidence assignment`}
                            >
                              ⚠
                            </span>
                          ) : null}
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
                        </span>
                      </td>
                    );
                  })}
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
            {paddingBottom > 0 ? (
              <tr aria-hidden="true" style={{ height: paddingBottom }}>
                <td colSpan={totalColCount} />
              </tr>
            ) : null}
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

/** True when a factor is a technical nuisance variable (batch effect
 *  bookkeeping rather than a biological condition). Mirrors the
 *  detection used by OverviewPanel's confound chip and
 *  PrePublishChecklist. The samples table treats these specially:
 *  pushed to the right end of the factor cluster + amber-tinted
 *  header so they stand out from biological factors. */
function isNuisanceFactor(factor: Factor): boolean {
  const cat = (factor.category?.label || "").trim().toLowerCase();
  return cat === "block" || cat === "batch";
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
  extra,
  dataFactorId,
  width,
  onResize,
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
  /** Optional extra slot below the sortable label — used by char
   *  columns to surface a "+ promote to factor" link when the
   *  characteristic looks continuous. Hidden by default to keep
   *  unrelated columns visually quiet. */
  extra?: React.ReactNode;
  /** Stamp ``data-factor-id`` on the rendered ``<th>`` so the
   *  parent panel can ``scrollIntoView`` after promoting a
   *  characteristic — keeps the new column visible without forcing
   *  the curator to hunt for it. */
  dataFactorId?: number;
  /** Curator-set width in px. Undefined → browser auto-size. When
   *  set, hard-pins the column via min/max-width so content with
   *  ``whitespace-nowrap`` doesn't blow it back out. */
  width?: number;
  /** Resize callback. Pass `null` to clear the override (curator
   *  double-clicks the handle to reset to auto-sized). */
  onResize?: (width: number | null) => void;
}) {
  const active = sort.key === colKey;
  const dir = active ? sort.dir : null;
  const widthStyle = width
    ? {
        width: `${width}px`,
        minWidth: `${width}px`,
        maxWidth: `${width}px`,
      }
    : undefined;
  return (
    <th
      className={cn(
        "text-left font-medium px-3 py-2 align-bottom relative group",
        sticky && "sticky left-8 bg-slate-50",
        className,
      )}
      style={widthStyle}
      title={title}
      data-factor-id={dataFactorId}
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
      {extra ? <div className="block">{extra}</div> : null}
      {onResize ? <ColumnResizeHandle onCommit={onResize} /> : null}
    </th>
  );
}

/** Thin drag handle pinned to the right edge of a `<th>`. Lets the
 *  curator size the column to taste; double-click clears any prior
 *  override (column falls back to browser auto-sizing).
 *
 *  The handle paints itself live during drag by mutating the parent
 *  `<th>`'s inline style — calling React on every mousemove would
 *  fight the table layout pass. The committed width is forwarded to
 *  the caller's onCommit on mouseup, which persists it via
 *  ``useStickyState``; the next React render reapplies the same
 *  width through the normal `width` prop and the inline override
 *  becomes redundant.
 *
 *  Min width is 40 px — anything smaller hides the column header. */
function ColumnResizeHandle({
  onCommit,
}: {
  onCommit: (width: number | null) => void;
}) {
  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    const th = handle.parentElement as HTMLElement | null;
    if (!th) return;
    const startX = e.clientX;
    const startWidth = th.getBoundingClientRect().width;
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(40, startWidth + (ev.clientX - startX));
      th.style.width = `${next}px`;
      th.style.minWidth = `${next}px`;
      th.style.maxWidth = `${next}px`;
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const next = Math.max(40, startWidth + (ev.clientX - startX));
      onCommit(next);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title="drag to resize · double-click to reset"
      onMouseDown={onMouseDown}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const th = (e.currentTarget.parentElement as HTMLElement | null);
        if (th) {
          th.style.width = "";
          th.style.minWidth = "";
          th.style.maxWidth = "";
        }
        onCommit(null);
      }}
      className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-300 active:bg-blue-500 group-hover:bg-slate-200"
    />
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
  // Four visual states: ontology-backed (emerald — matches the
  // codebase-wide "green = ontology-backed" cue), free-text-assigned
  // (slate), unassigned (rose), or mixed across siblings (amber).
  // An FV counts as ontology-backed when every statement carries a
  // non-null subject URI; that mirrors the StatementRow / proposal-
  // card check and means a partially-mapped combo FV stays neutral.
  const currentFv =
    currentFvId != null
      ? factor.factor_values.find((fv) => fv.id === currentFvId) ?? null
      : null;
  const isOntologyBacked =
    !!currentFv &&
    currentFv.statements.length > 0 &&
    currentFv.statements.every((s) => !!s.subject.uri);
  const stateCls = isMixed
    ? "border-amber-400 text-amber-800 bg-amber-50"
    : currentFvId === null
      ? "border-rose-300 text-rose-700"
      : isOntologyBacked
        ? "border-emerald-300 text-emerald-900 bg-emerald-50"
        : "border-slate-300 text-slate-800";
  // For unassigned / mixed cells there's no FV with statements to
  // unpack; a plain native ``title`` is fine. For populated cells
  // (ontology-backed OR free-text-assigned) we render a rich
  // ``Tooltip`` showing the FV's statements as S-P-O rows so
  // curators can read the underlying semantics without opening the
  // factor. Subject column blanked on subsequent rows when it
  // matches the row above (Paul 2026-05-23 — "redundant subjects
  // omitted").
  const fallbackTitle = isMixed
    ? "siblings disagree on this factor — pick a value to apply to all of them"
    : currentFvId === null
      ? "unassigned — pick a value"
      : "click to reassign this sample";

  const selectEl = (
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
      // Native ``title`` only on cells without statements to surface —
      // the rich tooltip below replaces it on populated cells.
      title={currentFv && currentFv.statements.length > 0 ? undefined : fallbackTitle}
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

  if (!currentFv || currentFv.statements.length === 0) return selectEl;
  return (
    <Tooltip label={<FvStatementsTooltipBody fv={currentFv} />}>
      {selectEl}
    </Tooltip>
  );
}

/** Mini S-P-O rendering for an FV's statements, intended to live
 *  inside a ``Tooltip`` label. CURIEs hidden (the FV label already
 *  shows what's resolved; the curator can drill into the factor
 *  for full URIs). Subject column blanks on subsequent rows whose
 *  subject matches the previous row, so a chain of statements on
 *  the same subject reads as a single block. Colours flipped for
 *  the dark slate-800 tooltip background:
 *    - URI-backed term → emerald-300
 *    - free-text term → slate-100 italic
 *    - predicate → slate-300 italic
 *  Statement count line lives at the top for >1-statement FVs so
 *  the curator can see how many rows to expect at a glance. */
function FvStatementsTooltipBody({
  fv,
}: {
  fv: { free_text_label?: string; statements: Statement[] };
}) {
  const sameSubject = (
    a: Statement | null | undefined,
    b: Statement,
  ): boolean => {
    if (!a) return false;
    return (
      (a.subject?.label ?? "") === (b.subject?.label ?? "") &&
      (a.subject?.uri ?? null) === (b.subject?.uri ?? null)
    );
  };
  return (
    <div className="space-y-1">
      {fv.free_text_label ? (
        <div className="text-slate-100 text-[10px] uppercase tracking-wider font-semibold">
          {fv.free_text_label}
        </div>
      ) : null}
      <div className="grid grid-cols-[max-content_max-content_max-content] gap-x-2 gap-y-0.5 items-baseline">
        {fv.statements.map((s, i) => {
          const subjectSame = sameSubject(fv.statements[i - 1], s);
          const subj = s.subject?.label ?? "";
          const subjUri = s.subject?.uri ?? null;
          const pred = s.predicate?.label ?? "";
          const obj = s.object?.label ?? "";
          const objUri = s.object?.uri ?? null;
          return (
            <Fragment key={i}>
              <span
                className={cn(
                  "whitespace-nowrap text-[11px]",
                  subjectSame
                    ? ""
                    : subjUri
                      ? "text-emerald-200 font-semibold"
                      : "text-slate-50 italic font-medium",
                )}
              >
                {subjectSame ? "" : subj}
              </span>
              <span className="whitespace-nowrap text-[11px] text-slate-200 italic">
                {pred}
              </span>
              <span
                className={cn(
                  "whitespace-nowrap text-[11px]",
                  obj
                    ? objUri
                      ? "text-emerald-200 font-semibold"
                      : "text-slate-50 italic font-medium"
                    : "text-slate-400",
                )}
              >
                {obj || "—"}
              </span>
            </Fragment>
          );
        })}
      </div>
    </div>
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
  factorIdx: _factorIdx,
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
  useEscape(true, onCancel);
  return (
    <div
      className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center px-4 py-4"
      onClick={onCancel}
    >
      {/* Cap the modal at 90vh and turn the body into a flex-grow
          scroll region. Without this, a large bucket list (e.g.
          GSE45642.2's ~30 subject ids) blows past the viewport top
          and bottom and the action buttons become unreachable. */}
      <div
        className="bg-white rounded shadow-lg max-w-2xl w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
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
        <div className="px-3 py-3 overflow-y-auto flex-1 min-h-0">
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
