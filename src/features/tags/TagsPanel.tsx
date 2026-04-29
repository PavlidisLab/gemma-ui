import { useEffect, useRef, useState } from "react";
import { CategoryPicker } from "@/features/design/CategoryPicker";
import { OntologyTermPicker } from "@/features/design/OntologyTermPicker";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { GuidelinePopup } from "@/components/ui/GuidelinePopup";
import {
  addTag,
  deleteTag,
  setTagCategory,
  setTagValue,
} from "@/features/design/mutations";
import { TAGS_GUIDELINE } from "@/lib/guidelines";
import type { OntologyTerm, Tag } from "@/features/experiment/types";

/**
 * Experiment-level tags. Compact two-row chip cloud — direct
 * (curator-attached, green) and inferred (bubbled up from FVs /
 * sample characteristics, yellow). Click a green chip to edit;
 * × on hover deletes. The "+ tag" button opens an inline editor.
 *
 * Inferred chips group by category and expand on click when there
 * are >1 values per category. They're read-only: to remove an
 * inferred annotation, remove the underlying FV / sample value.
 *
 * Per Confluence `Curate-the-Experimental-Tags`: tags fill GAPS
 * in the design — don't add a green tag for something already
 * inferred from a FV / BioMaterial.
 */
export function TagsPanel({ experimentId }: { experimentId: number }) {
  const { draft, diff, apply, isLoading, loadError } = useDesignDraft();

  if (isLoading) {
    return (
      <div className="card p-4 text-sm text-slate-500">loading tags…</div>
    );
  }
  if (loadError || !draft) {
    return (
      <div className="card p-4 text-sm text-rose-700">
        couldn't load design for experiment {experimentId}:{" "}
        {loadError ?? "unknown"}
      </div>
    );
  }

  const addedIds = new Set(diff.tags.added.map((t) => t.id));
  const modifiedIds = new Set(diff.tags.modified.map((m) => m.after.id));
  const tombstones = diff.tags.removed;

  const directTags = draft.tags.filter((t) => !t.inferred);
  const inferredTags = draft.tags.filter((t) => t.inferred);
  const [adding, setAdding] = useState(false);

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-200 flex-wrap">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="section-h">Experiment tags</span>
          <GuidelinePopup snippet={TAGS_GUIDELINE} size="md" />
          <span className="text-xs text-slate-400">
            {directTags.length} direct
            {inferredTags.length > 0
              ? ` · ${inferredTags.length} inferred`
              : ""}
          </span>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => setAdding(true)}
          disabled={adding}
        >
          + tag
        </button>
      </div>

      <div className="px-3 py-2.5 flex items-baseline gap-1.5 flex-wrap">
        {directTags.length === 0 && tombstones.length === 0 && !adding ? (
          <span className="text-xs text-slate-400 italic">
            No direct tags — fill gaps not covered by inferred annotations below.
          </span>
        ) : null}

        {/*
          Render direct tags grouped by category. Categories with
          ≤ TAG_GROUP_THRESHOLD tags render flat (each a normal
          editable chip). Beyond that, the category collapses into
          a single expanding chip — common in single-cell datasets
          where one experiment may carry many cell-type tags.
          Grouping is per-source: direct and inferred are already
          on separate rows, so they never mix.
        */}
        {groupByCategory(directTags).map((g) =>
          g.tags.length > TAG_GROUP_THRESHOLD ? (
            <DirectCategoryGroup
              key={`grp-${g.category.uri || g.category.label}`}
              category={g.category}
              tags={g.tags}
              addedIds={addedIds}
              modifiedIds={modifiedIds}
              onCategoryChange={(id, category) => {
                if (category) apply(setTagCategory(draft, id, category));
              }}
              onValueChange={(id, value) => {
                if (value) apply(setTagValue(draft, id, value));
              }}
              onDelete={(id) => apply(deleteTag(draft, id))}
            />
          ) : (
            g.tags.map((tag) => (
              <DirectTagChip
                key={tag.id}
                tag={tag}
                kind={
                  addedIds.has(tag.id)
                    ? "added"
                    : modifiedIds.has(tag.id)
                      ? "modified"
                      : null
                }
                onCategoryChange={(category) => {
                  if (category) apply(setTagCategory(draft, tag.id, category));
                }}
                onValueChange={(value) => {
                  if (value) apply(setTagValue(draft, tag.id, value));
                }}
                onDelete={() => apply(deleteTag(draft, tag.id))}
              />
            ))
          ),
        )}

        {tombstones.map((tag) => (
          <TombstoneChip key={`tomb-${tag.id}`} tag={tag} />
        ))}

        {adding ? (
          <NewTagEditor
            onCancel={() => setAdding(false)}
            onCommit={(category, value) => {
              const { design: next, tagId } = addTag(draft);
              const withCat = setTagCategory(next, tagId, category);
              const withVal = setTagValue(withCat, tagId, value);
              apply(withVal);
              setAdding(false);
            }}
          />
        ) : null}
      </div>

      {inferredTags.length > 0 ? (
        <div className="px-3 py-2 border-t border-slate-100 bg-violet-50/40">
          <div className="flex items-baseline gap-2 flex-wrap text-xs">
            <span className="text-[11px] uppercase tracking-wide font-semibold text-violet-900">
              inferred
            </span>
            <InferredTagGroups tags={inferredTags} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Group tags into expanding chips once a single category has more
 * than this many entries in one source bucket. Tuned for
 * single-cell experiments, which often carry one tag per cell
 * type — without grouping, the panel sprawls into dozens of
 * cell-type chips that drown out everything else.
 *
 * Threshold is intentionally low (3): four cell types is enough
 * to want a grouping. Below that, the chips read more cleanly
 * laid out flat than collapsed.
 */
const TAG_GROUP_THRESHOLD = 3;

function groupByCategory(
  tags: Tag[],
): { category: Tag["category"]; tags: Tag[] }[] {
  const groups = new Map<string, { category: Tag["category"]; tags: Tag[] }>();
  for (const t of tags) {
    const k = (t.category.uri || t.category.label || "").toLowerCase();
    if (!groups.has(k)) groups.set(k, { category: t.category, tags: [] });
    groups.get(k)!.tags.push(t);
  }
  // Map preserves insertion order, which matches the order the
  // tags first appeared in the design — stable enough for UI.
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// Direct tag chip — green pill, click to edit, hover for ×.

function DirectTagChip({
  tag,
  kind,
  onCategoryChange,
  onValueChange,
  onDelete,
}: {
  tag: Tag;
  kind: "added" | "modified" | null;
  onCategoryChange: (category: OntologyTerm | null) => void;
  onValueChange: (value: OntologyTerm | null) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);

  // Auto-edit blank tags: a freshly-added empty tag opens straight
  // into edit mode so the curator doesn't see "(blank): (blank)".
  useEffect(() => {
    if (!tag.category.label && !tag.value.label) setEditing(true);
  }, [tag.category.label, tag.value.label]);

  if (editing) {
    return (
      <ChipEditor
        category={tag.category}
        value={tag.value}
        onCancel={() => setEditing(false)}
        onCommit={(cat, val) => {
          onCategoryChange(cat);
          onValueChange(val);
          setEditing(false);
        }}
        onDelete={onDelete}
      />
    );
  }

  const ringCls =
    kind === "added"
      ? "ring-1 ring-emerald-400"
      : kind === "modified"
        ? "ring-1 ring-amber-400"
        : "";

  return (
    <span
      className={`group inline-flex items-baseline gap-1 text-[11px] px-1.5 py-0.5 rounded border bg-emerald-100 border-emerald-300 text-emerald-900 cursor-pointer hover:bg-emerald-200/60 ${ringCls}`}
      onClick={() => setEditing(true)}
      title={
        kind === "added"
          ? "uncommitted new tag · click to edit"
          : kind === "modified"
            ? "uncommitted change · click to edit"
            : "click to edit"
      }
    >
      <span className="opacity-70">
        {tag.category.label || <em className="not-italic">no category</em>}
      </span>
      <span className="font-medium">
        {tag.value.label || <em className="not-italic">no value</em>}
      </span>
      <button
        type="button"
        className="ml-1 text-emerald-700/60 hover:text-rose-700 opacity-0 group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="delete tag"
        aria-label="delete tag"
      >
        ×
      </button>
    </span>
  );
}

/**
 * Direct-tag analogue of `InferredCategoryGroup`. Renders as a
 * single green chip when collapsed; click to expand into the full
 * editable list of `DirectTagChip`s. Each child chip retains all
 * of its normal behaviour (click to edit, × to delete).
 */
function DirectCategoryGroup({
  category,
  tags,
  addedIds,
  modifiedIds,
  onCategoryChange,
  onValueChange,
  onDelete,
}: {
  category: Tag["category"];
  tags: Tag[];
  addedIds: Set<number>;
  modifiedIds: Set<number>;
  onCategoryChange: (id: number, category: OntologyTerm | null) => void;
  onValueChange: (id: number, value: OntologyTerm | null) => void;
  onDelete: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const dirtyCount = tags.filter(
    (t) => addedIds.has(t.id) || modifiedIds.has(t.id),
  ).length;
  return (
    <span className="inline-flex items-baseline gap-1 text-[11px] rounded bg-emerald-100 border border-emerald-300 text-emerald-900 px-1.5 py-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-baseline gap-1 hover:underline underline-offset-2"
        title={
          open
            ? "click to collapse"
            : `click to expand ${tags.length} ${category.label} tags`
        }
      >
        <span className="opacity-70">
          {category.label || <em className="not-italic">no category</em>}
        </span>
        <span className="font-medium">
          {tags.length} value{tags.length === 1 ? "" : "s"}
        </span>
        {dirtyCount > 0 ? (
          <span
            className="text-amber-700/90"
            title={`${dirtyCount} uncommitted change${dirtyCount === 1 ? "" : "s"}`}
          >
            •
          </span>
        ) : null}
        <span className="opacity-60">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <span className="inline-flex items-baseline gap-1 flex-wrap ml-1 pl-1 border-l border-emerald-300/60">
          {tags.map((tag) => (
            <DirectTagChip
              key={tag.id}
              tag={tag}
              kind={
                addedIds.has(tag.id)
                  ? "added"
                  : modifiedIds.has(tag.id)
                    ? "modified"
                    : null
              }
              onCategoryChange={(cat) => onCategoryChange(tag.id, cat)}
              onValueChange={(val) => onValueChange(tag.id, val)}
              onDelete={() => onDelete(tag.id)}
            />
          ))}
        </span>
      ) : (
        <span className="text-emerald-900/60 italic ml-1 truncate max-w-[24ch]">
          {tags
            .slice(0, 2)
            .map((t) => t.value.label || "(blank)")
            .join(", ")}
          {tags.length > 2 ? "…" : ""}
        </span>
      )}
    </span>
  );
}

function TombstoneChip({ tag }: { tag: Tag }) {
  return (
    <span
      className="inline-flex items-baseline gap-1 text-[11px] px-1.5 py-0.5 rounded border bg-rose-50 border-rose-200 text-rose-700 line-through"
      title="deleted (uncommitted)"
    >
      <span className="opacity-70">{tag.category.label || "(blank)"}</span>
      <span className="font-medium">{tag.value.label || "(blank)"}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Edit / new-tag inline form. Same layout for both — pickers
// stacked horizontally, save / cancel on the right. Click outside
// or Esc cancels; Enter saves when both fields are filled.

function ChipEditor({
  category,
  value,
  onCommit,
  onCancel,
  onDelete,
}: {
  category: OntologyTerm;
  value: OntologyTerm;
  onCommit: (category: OntologyTerm, value: OntologyTerm) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [cat, setCat] = useState<OntologyTerm | null>(category);
  const [val, setVal] = useState<OntologyTerm | null>(value);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) {
        // Auto-commit on outside click if both fields are populated;
        // otherwise cancel.
        if (cat && cat.label && val && val.label) {
          onCommit(cat, val);
        } else {
          onCancel();
        }
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [cat, val, onCommit, onCancel]);

  const canSave = !!(cat && cat.label && val && val.label);

  return (
    <span
      ref={ref}
      className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border bg-emerald-50 border-emerald-300 text-emerald-900"
      onClick={(e) => e.stopPropagation()}
    >
      <CategoryPicker
        value={cat}
        placeholder="category"
        onCommit={(next) => setCat(next ?? null)}
      />
      <span className="text-emerald-700/70">:</span>
      <OntologyTermPicker
        value={val}
        category={cat?.label || null}
        placeholder="value"
        onCommit={(next) => setVal(next ?? null)}
      />
      <button
        type="button"
        className="ml-1 px-1 text-emerald-800 hover:text-emerald-950 disabled:opacity-40"
        onClick={() => canSave && onCommit(cat!, val!)}
        disabled={!canSave}
        title={canSave ? "save" : "fill category and value first"}
      >
        ✓
      </button>
      <button
        type="button"
        className="px-1 text-slate-500 hover:text-slate-800"
        onClick={onCancel}
        title="cancel"
      >
        ✕
      </button>
      {onDelete ? (
        <button
          type="button"
          className="px-1 text-rose-700 hover:text-rose-900"
          onClick={onDelete}
          title="delete tag"
        >
          🗑
        </button>
      ) : null}
    </span>
  );
}

function NewTagEditor({
  onCommit,
  onCancel,
}: {
  onCommit: (category: OntologyTerm, value: OntologyTerm) => void;
  onCancel: () => void;
}) {
  return (
    <ChipEditor
      category={{ label: "" }}
      value={{ label: "" }}
      onCommit={onCommit}
      onCancel={onCancel}
    />
  );
}

// ---------------------------------------------------------------------------
// Inferred tag chips — yellow, read-only. Single-value categories
// render inline; multi-value collapse under one expanding chip.

function InferredTagGroups({ tags }: { tags: Tag[] }) {
  // Group by category, then collapse only categories that exceed
  // the threshold. Below the threshold we render each tag flat so
  // the curator can scan them at a glance.
  return (
    <span className="inline-flex items-baseline gap-1 flex-wrap">
      {groupByCategory(tags).map((g) =>
        g.tags.length > TAG_GROUP_THRESHOLD ? (
          <InferredCategoryGroup
            key={`grp-${g.category.uri || g.category.label}`}
            category={g.category}
            tags={g.tags}
          />
        ) : (
          g.tags.map((t) => (
            <InferredTagChip key={t.id} category={g.category} tag={t} />
          ))
        ),
      )}
    </span>
  );
}

function InferredTagChip({
  category,
  tag,
}: {
  category: Tag["category"];
  tag: Tag;
}) {
  const sourceLabel = tag.inferred_source
    ? `inferred from ${tag.inferred_source}`
    : "inferred";
  return (
    <span
      className="inline-flex items-baseline gap-1 text-[11px] px-1.5 py-0.5 rounded bg-amber-100 border border-amber-200 text-amber-900"
      title={`${category.label}: ${tag.value.label} (${sourceLabel})`}
    >
      <span className="text-amber-700/70">{category.label}</span>
      <span className="font-medium">{tag.value.label}</span>
    </span>
  );
}

function InferredCategoryGroup({
  category,
  tags,
}: {
  category: Tag["category"];
  tags: Tag[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="inline-flex items-baseline gap-1 text-[11px] rounded bg-amber-100 border border-amber-200 text-amber-900 px-1.5 py-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-baseline gap-1 hover:underline underline-offset-2"
        title={
          open
            ? "click to collapse"
            : `click to expand ${tags.length} ${category.label} values`
        }
      >
        <span className="text-amber-700/70">{category.label}</span>
        <span className="font-medium">
          {tags.length} value{tags.length === 1 ? "" : "s"}
        </span>
        <span className="opacity-60">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <span className="inline-flex items-baseline gap-1 flex-wrap ml-1 pl-1 border-l border-amber-300/60">
          {tags.map((t) => (
            <span
              key={t.id}
              className="inline-block px-1 rounded bg-amber-50 border border-amber-200/70"
              title={
                t.inferred_source
                  ? `inferred from ${t.inferred_source}`
                  : "inferred"
              }
            >
              {t.value.label}
            </span>
          ))}
        </span>
      ) : (
        <span className="text-amber-900/60 italic ml-1 truncate max-w-[20ch]">
          {tags
            .slice(0, 2)
            .map((t) => t.value.label)
            .join(", ")}
          {tags.length > 2 ? "…" : ""}
        </span>
      )}
    </span>
  );
}
