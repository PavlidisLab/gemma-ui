import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { InlineText } from "@/components/ui/InlineText";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { GuidelinePopup } from "@/components/ui/GuidelinePopup";
import { CategoryPicker } from "./CategoryPicker";
import { guidelineForCategory } from "@/lib/guidelines";
import { FACTOR_TEMPLATES, type FactorTemplate } from "./factorTemplates";
import { AuditDot, GemmaMatchDot } from "@/features/audit/AuditDot";
import { factorTarget } from "@/features/audit/targetIds";
import { useIsReadOnly } from "@/features/comparison/FlowContext";
import type {
  Factor,
  FactorType,
  OntologyTerm,
} from "@/features/experiment/types";

/**
 * Compact factors table at the top of the design tab.
 *
 * Single-click selects a row (the FactorValueList renders for the
 * selected factor). Double-click on an editable cell starts inline
 * edit; the Type column uses a `<select>` since it's a small enum.
 *
 * Per-row "modified" badge fires when any factor field differs from
 * the saved server state — see DesignEditor → diff.factorsChanged.
 */
export function FactorList({
  factors,
  selectedId,
  modifiedFactorIds,
  addedFactorIds,
  dirtyFactorIds,
  onSelect,
  onFactorFieldsChange,
  onAddFactor,
  onAddFactorFromTemplate,
  onDeleteFactor,
  onRevertFactor,
}: {
  factors: Factor[];
  selectedId: number | null;
  /** Factor IDs whose name / category / description / type differ from
   *  the saved server state. Used only for the modified badge — the
   *  per-FV diff is shown elsewhere. */
  modifiedFactorIds: Set<number>;
  /** Factor IDs the curator has added in this draft (not yet in
   *  saved). Surfaced as a "new" badge. */
  addedFactorIds: Set<number>;
  /** Factor IDs that have ANY uncommitted change — factor-field
   *  edits, added-in-draft, OR an added/modified/removed FV under
   *  this factor. Drives the per-row "revert factor" affordance.
   *  Superset of `modifiedFactorIds` ∪ `addedFactorIds`. */
  dirtyFactorIds: Set<number>;
  onSelect: (id: number) => void;
  onFactorFieldsChange: (
    factorId: number,
    patch: Partial<{
      name: string;
      description: string;
      type: FactorType;
      category: OntologyTerm;
    }>,
  ) => void;
  onAddFactor: () => void;
  onAddFactorFromTemplate: (template: FactorTemplate) => void;
  onDeleteFactor: (factorId: number) => void;
  /** Atomic per-Factor revert. Restores name / category / type /
   *  description AND every FV under this factor to saved baseline.
   *  For added-in-draft factors the parent passes the appropriate
   *  saved=null so revert reduces to "drop the factor". */
  onRevertFactor: (factorId: number) => void;
}) {
  // Tracks which factor (if any) the curator is in the process of
  // deleting — set when they click the per-row trash icon, cleared
  // on confirm / cancel. Replaces the old toolbar-scoped boolean
  // since deletion now targets the clicked row, not the selected
  // one.
  const [factorPendingDelete, setFactorPendingDelete] =
    useState<Factor | null>(null);
  // Revert is atomic per-Factor (name/category/type/description AND
  // every FV, in one shot — see onRevertFactor doc below) and for a
  // draft-only factor it deletes the row outright. A curator who
  // just finished editing the name and reaches for "revert" reading
  // it as "undo my last edit" can otherwise lose an added treatment
  // (or the whole factor) in one click with no way back. Confirm
  // first, same as delete.
  const [factorPendingRevert, setFactorPendingRevert] =
    useState<Factor | null>(null);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const templateMenuRef = useRef<HTMLDivElement | null>(null);
  // Review-mode lock: only the mutating buttons + the type ``<select>``
  // get disabled. Row-select (navigation), GuidelinePopup triggers
  // (read-only help), and InlineText / CategoryPicker (which self-gate
  // their open-editor affordance) stay clickable so the curator can
  // navigate + read.
  const readOnly = useIsReadOnly();

  // Convention: nuisance factors (block / batch) sort to the bottom
  // of the factor list, after biological factors. Mirrors the
  // SampleDetailsPanel's "nuisance factors to the right end" rule
  // so curators see the load-bearing biological factors first
  // whether they're scanning rows (here) or columns (samples tab).
  // Stable within each band — original order preserved.
  const sortedFactors = useMemo(() => {
    const bio: Factor[] = [];
    const nuisance: Factor[] = [];
    for (const f of factors) {
      const cat = (f.category?.label || "").trim().toLowerCase();
      if (cat === "block" || cat === "batch") nuisance.push(f);
      else bio.push(f);
    }
    return [...bio, ...nuisance];
  }, [factors]);

  // Close on outside click. Cheaper than a full Popper / floating-ui
  // dance for a 8-row menu.
  useEffect(() => {
    if (!templateMenuOpen) return;
    function onDoc(e: MouseEvent) {
      if (
        templateMenuRef.current &&
        !templateMenuRef.current.contains(e.target as Node)
      ) {
        setTemplateMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [templateMenuOpen]);
  return (
    <div className="card">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <span className="section-h">Experimental factors</span>
          <span className="text-xs text-slate-400">
            {factors.length} factors · double-click a cell to edit
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn ghost"
            onClick={onAddFactor}
            disabled={readOnly}
            title="Add a blank factor (you'll need to set its category)"
          >
            + factor
          </button>
          <div className="relative" ref={templateMenuRef}>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setTemplateMenuOpen((o) => !o)}
              disabled={readOnly}
              title="Insert a factor pre-filled for a common case (treatment, genotype, disease, …) — saves the category + predicate hunt"
              aria-haspopup="menu"
              aria-expanded={templateMenuOpen}
            >
              + from template ▾
            </button>
            {templateMenuOpen ? (
              <div
                role="menu"
                className="absolute right-0 z-30 mt-1 w-72 max-h-96 overflow-auto bg-white border border-slate-200 rounded-md shadow-lg py-1"
              >
                {FACTOR_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    role="menuitem"
                    className="w-full text-left px-3 py-1.5 hover:bg-slate-50 focus:bg-slate-100 focus:outline-none"
                    onClick={() => {
                      setTemplateMenuOpen(false);
                      onAddFactorFromTemplate(tpl);
                    }}
                  >
                    <div className="text-sm text-slate-900">{tpl.label}</div>
                    <div className="text-[11px] text-slate-500">
                      {tpl.description}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-600 uppercase tracking-wide">
          <tr>
            {/* 6px selection indicator column. Empty header. */}
            <th className="w-1.5 p-0" aria-hidden />
            <th className="text-left px-3 py-1.5 w-1/4">Name</th>
            <th className="text-left px-3 py-1.5 w-1/4">Category</th>
            <th className="text-left px-3 py-1.5">Description</th>
            <th className="text-left px-3 py-1.5 w-32">Type</th>
            <th className="text-left px-3 py-1.5 w-20">Factor ID</th>
            <th className="px-2 py-1.5 w-10" aria-label="actions" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sortedFactors.map((f) => {
            const selected = f.id === selectedId;
            const isAdded = addedFactorIds.has(f.id);
            const modified = !isAdded && modifiedFactorIds.has(f.id);
            return (
              <tr
                key={f.id}
                onClick={() => onSelect(f.id)}
                // Audit focus hook — Apply & focus on a factor finding
                // resolves the matching tr via this attribute and
                // ring-flashes it. target_id format mirrors the agent
                // contract (factor:<category-slug>); divergence breaks
                // the dot resolver too, so they're locked in tandem.
                data-audit-target={factorTarget(f.category?.label || "", f.id)}
                className={cn(
                  "cursor-pointer transition-colors",
                  selected
                    ? "bg-blue-100 hover:bg-blue-100"
                    : isAdded
                      ? // Mirror tag-chip "amber ring" convention for
                        // uncommitted additions — soft amber wash so
                        // the curator can see at a glance which rows
                        // came from an Agree → add audit action and
                        // are awaiting commit.
                        "bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/20 dark:hover:bg-amber-900/30"
                      : "hover:bg-slate-50",
                )}
              >
                {/* Left-edge indicator strip. Selection (blue)
                    trumps added-in-draft (amber): the curator
                    actively clicked this row, so the panel below is
                    showing its FVs — the amber-new state demotes to
                    background context until they click off. */}
                <td
                  className={cn(
                    "p-0 w-1",
                    selected
                      ? "bg-blue-600"
                      : isAdded
                        ? "bg-amber-400"
                        : "bg-transparent",
                  )}
                  aria-hidden
                />
                <td className="px-3 py-2 font-medium align-top">
                  <div className="flex items-center gap-2">
                    {selected ? (
                      <span className="text-blue-600 font-bold select-none shrink-0" aria-hidden>›</span>
                    ) : null}
                    <InlineText
                      value={f.name || f.category?.label || ""}
                      placeholder="factor name"
                      onCommit={(name) => onFactorFieldsChange(f.id, { name })}
                    />
                    {/* Inline audit indicator. Resolves against
                        AuditContext; renders nothing when no audit
                        is loaded or this factor isn't flagged. The
                        agent contract pins target_id to the factor's
                        *category* slug — name is intentionally not
                        a fallback so we don't silently match findings
                        against a renamed factor. */}
                    <AuditDot
                      targetId={factorTarget(f.category?.label || "", f.id)}
                    />
                    <GemmaMatchDot factorLabel={f.category?.label || ""} />
                    {isAdded ? <NewBadge /> : null}
                    {modified ? <ModifiedBadge /> : null}
                  </div>
                </td>
                <td className="px-3 py-2 align-top">
                  <span className="inline-flex items-center gap-1.5">
                    <CategoryPicker
                      value={f.category}
                      placeholder="category"
                      onCommit={(next) => {
                        if (next) {
                          onFactorFieldsChange(f.id, { category: next });
                        }
                        // Disallow null category on a Factor — every
                        // factor must have one. Picker returning null
                        // (empty input) is a no-op here.
                      }}
                    />
                    {(() => {
                      const g = f.category
                        ? guidelineForCategory(f.category.label)
                        : null;
                      return g ? <GuidelinePopup snippet={g} /> : null;
                    })()}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-700 align-top">
                  <InlineText
                    value={f.description}
                    placeholder="add description"
                    onCommit={(description) =>
                      onFactorFieldsChange(f.id, { description })
                    }
                  />
                </td>
                <td
                  className="px-3 py-2 text-slate-600 align-top"
                  // The select handles its own click; stop propagation
                  // so opening the dropdown doesn't also toggle the
                  // row selection (it would, but harmlessly).
                  onClick={(e) => e.stopPropagation()}
                >
                  <select
                    value={f.type}
                    onChange={(e) =>
                      onFactorFieldsChange(f.id, {
                        type: e.target.value as FactorType,
                      })
                    }
                    disabled={readOnly}
                    className="text-xs border border-slate-300 rounded px-1 py-0.5 bg-white"
                  >
                    <option value="categorical">categorical</option>
                    <option value="continuous">continuous</option>
                  </select>
                </td>
                <td className="px-3 py-2 text-slate-400 font-mono text-xs align-top">
                  {isAdded ? (
                    <span
                      className="text-slate-500 italic font-sans"
                      title="draft — this factor doesn't have a server id until you commit"
                    >
                      —
                    </span>
                  ) : (
                    f.id
                  )}
                </td>
                <td
                  className="px-2 py-2 align-top"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-1">
                    {/* Atomic revert. Visible whenever this factor or
                        any of its FVs has uncommitted edits. Restores
                        factor metadata + every FV to saved in one shot
                        (or drops the whole factor for added-in-draft
                        factors). */}
                    {dirtyFactorIds.has(f.id) ? (
                      <button
                        type="button"
                        onClick={() => setFactorPendingRevert(f)}
                        disabled={readOnly}
                        title={
                          isAdded
                            ? "discard this factor — it didn't exist on the saved baseline"
                            : "discard every uncommitted edit on this factor (name, category, type, description, all FVs) and restore from saved"
                        }
                        className="text-[11px] text-slate-500 hover:text-rose-700 underline-offset-2 hover:underline px-1 disabled:hover:no-underline disabled:hover:text-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isAdded ? "discard" : "revert"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setFactorPendingDelete(f)}
                      disabled={readOnly}
                      title={`Delete "${f.name || "(unnamed)"}"`}
                      aria-label={`Delete "${f.name || "(unnamed)"}"`}
                      className="text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded p-1 transition-colors disabled:hover:bg-transparent disabled:hover:text-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <ConfirmModal
        open={factorPendingDelete !== null}
        title={`Delete factor "${factorPendingDelete?.name || "(unnamed)"}"`}
        body={
          (factorPendingDelete?.factor_values.length ?? 0) > 0
            ? `Removes ${factorPendingDelete!.factor_values.length} factor value${
                factorPendingDelete!.factor_values.length === 1 ? "" : "s"
              } and any sample assignments under this factor.\n\nNothing is committed until you click Commit at the bottom.`
            : "This factor has no values yet — safe to delete.\n\nNothing is committed until you click Commit at the bottom."
        }
        confirmLabel="delete factor"
        onConfirm={() => {
          if (factorPendingDelete) onDeleteFactor(factorPendingDelete.id);
          setFactorPendingDelete(null);
        }}
        onCancel={() => setFactorPendingDelete(null)}
      />

      <ConfirmModal
        open={factorPendingRevert !== null}
        title={
          factorPendingRevert && addedFactorIds.has(factorPendingRevert.id)
            ? `Discard factor "${factorPendingRevert.name || "(unnamed)"}"`
            : `Revert factor "${factorPendingRevert?.name || "(unnamed)"}"`
        }
        body={
          factorPendingRevert && addedFactorIds.has(factorPendingRevert.id)
            ? "This factor doesn't exist on the saved design yet — reverting removes it entirely, including its name and any factor values you've added under it.\n\nNothing is committed until you click Commit at the bottom."
            : "This restores the factor's name, category, type, and description to the saved version, AND undoes any factor values you've added, edited, or removed under it — not just the field you last touched.\n\nNothing is committed until you click Commit at the bottom."
        }
        confirmLabel={
          factorPendingRevert && addedFactorIds.has(factorPendingRevert.id)
            ? "discard factor"
            : "revert factor"
        }
        onConfirm={() => {
          if (factorPendingRevert) onRevertFactor(factorPendingRevert.id);
          setFactorPendingRevert(null);
        }}
        onCancel={() => setFactorPendingRevert(null)}
      />
    </div>
  );
}

function ModifiedBadge() {
  return (
    <span
      className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800"
      title="factor fields differ from saved"
    >
      modified
    </span>
  );
}

function NewBadge() {
  return (
    <span
      className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700"
      title="added in this draft, not yet committed"
    >
      new
    </span>
  );
}
