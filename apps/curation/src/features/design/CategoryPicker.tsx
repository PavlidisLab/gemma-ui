import { useEffect, useMemo, useRef, useState } from "react";
import { useCategories } from "@/api/categories";
import { cn } from "@/lib/cn";
import { shortenUri } from "@/lib/curie";
import type { OntologyTerm } from "@/features/experiment/types";

/**
 * Inline-editable category cell — a small fixed picker over the
 * canonical EFC list (28 entries from
 * `EFO.factor.categories.txt`), *not* a usage-ranked typeahead.
 * Categories are a constrained vocabulary; the curator wants to
 * pick from the list, not search across thousands of terms with
 * usage counts. The annotation-search typeahead
 * (`OntologyTermPicker`) is reserved for value-level terms
 * (subjects, objects, tags) where the "previously used in Gemma"
 * cue actually guides curator consistency.
 *
 * Affordance: span by default; double-click opens an `<input>`
 * with a custom dropdown that lists all categories on focus and
 * substring-filters as the curator types. Free-text entries are
 * still permitted but flagged with a thin amber outline so
 * curators can spot non-canonical labels.
 *
 * Why a custom popup instead of `<datalist>`: native `<datalist>`
 * doesn't show options on focus in most browsers — the curator
 * has to type a character first, which makes the picker feel
 * broken even when it isn't.
 */
export function CategoryPicker({
  value,
  placeholder,
  className,
  onCommit,
}: {
  value: OntologyTerm | null;
  placeholder?: string;
  className?: string;
  onCommit: (next: OntologyTerm | null) => void;
}) {
  const { data: categories } = useCategories();
  const list = categories ?? [];

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value?.label ?? "");
  // ``pristine`` means the input still holds the existing value,
  // selected and untouched. While pristine the popup shows the
  // *full* category list (28 entries) instead of substring-filtering
  // by the existing label — otherwise opening the picker on a
  // populated cell only shows the one self-match, which feels
  // broken. First keystroke flips pristine → false and the
  // substring filter takes over.
  const [pristine, setPristine] = useState(true);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => {
    if (!editing) {
      setDraft(value?.label ?? "");
      setPristine(true);
    }
  }, [editing, value]);

  const filtered = useMemo(() => {
    if (pristine) return list;
    const q = draft.trim().toLowerCase();
    if (!q) return list;
    const starts: typeof list = [];
    const contains: typeof list = [];
    for (const c of list) {
      const l = c.label.toLowerCase();
      if (l.startsWith(q)) starts.push(c);
      else if (l.includes(q)) contains.push(c);
    }
    return [...starts, ...contains];
  }, [draft, list, pristine]);

  useEffect(() => setHighlight(0), [filtered.length]);

  function commitTerm(c: { label: string; uri: string | null }) {
    onCommit({ label: c.label, uri: c.uri ?? null });
    setEditing(false);
  }

  function commitFreeText(rawLabel: string) {
    const label = rawLabel.trim();
    if (!label) {
      onCommit(null);
      setEditing(false);
      return;
    }
    const hit = list.find(
      (c) => c.label.trim().toLowerCase() === label.toLowerCase(),
    );
    if (hit) {
      commitTerm({ label: hit.label, uri: hit.uri ?? null });
      return;
    }
    // Free-text branch: clear the URI when the label diverges from
    // the current value. Carrying the old URI forward under a new
    // label silently produces a label/URI mismatch that no
    // validator catches. Same-label-as-current keeps URI for
    // ergonomics (no-op edits).
    const sameAsCurrent =
      (value?.label ?? "").trim().toLowerCase() === label.toLowerCase();
    onCommit({ label, uri: sameAsCurrent ? (value?.uri ?? null) : null });
    setEditing(false);
  }

  if (editing) {
    return (
      <span className="relative inline-block">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setPristine(false);
          }}
          onBlur={() => {
            // Defer so an in-flight onMouseDown on a popup row commits first.
            window.setTimeout(() => {
              if (draft !== (value?.label ?? "")) commitFreeText(draft);
              else setEditing(false);
            }, 100);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setDraft(value?.label ?? "");
              setEditing(false);
              e.preventDefault();
            } else if (e.key === "Enter") {
              if (filtered[highlight]) {
                commitTerm({
                  label: filtered[highlight].label,
                  uri: filtered[highlight].uri ?? null,
                });
              } else {
                commitFreeText(draft);
              }
              e.preventDefault();
            } else if (e.key === "ArrowDown") {
              setHighlight((h) =>
                Math.min(h + 1, Math.max(0, filtered.length - 1)),
              );
              e.preventDefault();
            } else if (e.key === "ArrowUp") {
              setHighlight((h) => Math.max(0, h - 1));
              e.preventDefault();
            }
          }}
          placeholder={placeholder}
          className={cn(
            "border border-blue-300 rounded px-1 py-0 text-sm bg-white min-w-[12ch]",
            className,
          )}
        />
        <ul
          className="absolute left-0 top-full mt-0.5 z-20 bg-white border border-slate-200 rounded shadow-md min-w-[16rem] max-h-72 overflow-auto py-1 text-xs"
          onMouseDown={(e) => e.preventDefault()}
        >
          {filtered.map((c, i) => (
            <li
              key={`${c.label}|${c.uri ?? ""}`}
              onMouseEnter={() => setHighlight(i)}
              onClick={() =>
                commitTerm({ label: c.label, uri: c.uri ?? null })
              }
              className={cn(
                "px-2 py-1 cursor-pointer flex items-center gap-2",
                i === highlight ? "bg-blue-50" : "hover:bg-slate-50",
              )}
            >
              <span
                className={cn(
                  "truncate flex-1",
                  c.uri ? "text-emerald-800" : "text-slate-700 italic",
                )}
                title={c.uri ?? "free text"}
              >
                {c.label}
              </span>
              {c.uri ? (
                <span className="text-[10px] text-slate-400 font-mono shrink-0">
                  {shortenUri(c.uri)}
                </span>
              ) : null}
            </li>
          ))}
          {draft.trim() &&
          !filtered.some(
            (c) => c.label.toLowerCase() === draft.trim().toLowerCase(),
          ) ? (
            <li
              className={cn(
                "px-2 py-1 cursor-pointer border-t border-slate-100 text-slate-500 italic",
                highlight === filtered.length
                  ? "bg-blue-50"
                  : "hover:bg-slate-50",
              )}
              onMouseEnter={() => setHighlight(filtered.length)}
              onClick={() => commitFreeText(draft)}
            >
              use free text:{" "}
              <span className="not-italic">{draft.trim()}</span>
              <span className="ml-1 text-amber-700 not-italic">(off-list)</span>
            </li>
          ) : null}
        </ul>
      </span>
    );
  }

  // ----- read view -----

  const label = value?.label ?? "";
  const hasUri = !!value?.uri;
  const isUnknown =
    !!label &&
    list.length > 0 &&
    !list.some(
      (c) => c.label.trim().toLowerCase() === label.trim().toLowerCase(),
    );

  return (
    <span className="inline-flex items-center gap-1">
      <span
        role="button"
        tabIndex={0}
        onDoubleClick={() => setEditing(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
          }
        }}
        className={cn(
          "cursor-text hover:bg-blue-50 rounded px-1 -mx-1 select-none",
          // Green when URI-backed (matches Statement subject/object
          // pickers); slate when free-text; muted when blank.
          !label && "text-slate-400 italic",
          label && hasUri && "text-emerald-800",
          label && !hasUri && "text-slate-700 italic",
          isUnknown && "outline outline-1 outline-amber-300",
          className,
        )}
        title={
          isUnknown
            ? "not in the canonical category list — double-click to edit"
            : hasUri
              ? `${label} — ${value!.uri} (double-click to edit)`
              : "double-click to edit"
        }
      >
        {label || placeholder || "(category)"}
      </span>
      {/* Category URI dropped from inline render 2026-05-17 — curators
       *  don't read the category's own ontology id (e.g.
       *  "OBI:0000070" for the "assay" category itself); only the
       *  value's URI matters. Full URI still in the title-tooltip
       *  above. */}
    </span>
  );
}

