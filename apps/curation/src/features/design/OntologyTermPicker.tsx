import { useEffect, useRef, useState } from "react";
import {
  useAnnotationSearch,
  type AnnotationCandidate,
} from "@/api/annotations";
import { cn } from "@/lib/cn";
import { shortenUri } from "@/lib/curie";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import type { OntologyTerm } from "@/features/experiment/types";

/**
 * Typeahead picker over Gemma's annotation catalog. Used for
 * **value-level** terms — Statement subjects, predicate objects,
 * and experiment tags (drugs, diseases, organism parts, cell
 * types, …) — where the curator wants both a wide search surface
 * and a "previously-used in Gemma" cue. Categories have their own
 * tight picker (`CategoryPicker`) backed by the fixed EFC enum;
 * they don't need typeahead+counts.
 *
 * Mirrors the legacy ExtJS curation typeahead's visual contract:
 *
 *   - **green text** → ontology-backed candidate (URI present)
 *   - **grey text**  → free-text fallback (no URI)
 *   - **bold + count badge** → previously used in Gemma
 *   - **regular**    → never used
 *
 * The Confluence `Using-ontologies` guide is explicit that curators
 * should prefer (a) an ontology term over free text and (b) a
 * previously-used term over a new one. The visual encoding here
 * mirrors that priority order so a curator's eye lands on the right
 * pick.
 *
 * Affordance: double-click opens edit mode (matches the InlineText
 * pattern). Enter commits; Escape cancels; arrow keys move the
 * highlighted suggestion.
 */
export function OntologyTermPicker({
  value,
  category,
  placeholder,
  className,
  onCommit,
  allowFreeText = true,
}: {
  value: OntologyTerm | null;
  /** Restrict typeahead candidates to this category_label. ``null``
   *  means no filter. */
  category: string | null;
  placeholder?: string;
  className?: string;
  onCommit: (next: OntologyTerm | null) => void;
  /** When false, free-text entries are still permitted at the
   *  schema level but the picker visibly warns. */
  allowFreeText?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [uriEditing, setUriEditing] = useState(false);
  const [draft, setDraft] = useState(value?.label ?? "");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce the query to avoid spamming the endpoint on every key.
  const debounced = useDebouncedValue(draft, 150);

  const { data: candidates = [], isFetching } = useAnnotationSearch(
    debounced,
    category,
    { enabled: editing, limit: 10 },
  );

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => {
    if (!editing) setDraft(value?.label ?? "");
  }, [editing, value]);

  // Reset the highlighted row whenever the candidate list shifts.
  useEffect(() => setHighlight(0), [debounced, candidates.length]);

  function commitCandidate(c: AnnotationCandidate) {
    onCommit({ label: c.label, uri: c.uri ?? null });
    setEditing(false);
  }

  /** Commit ``text`` as free text or as a matched candidate.
   *
   * Behaviour matches the design decision (2026-04-27):
   * - If ``text`` exactly matches a candidate label (case-insensitive),
   *   commit that candidate so the URI sticks.
   * - Else if ``text`` differs from the current value's label, commit
   *   as free text with ``uri = null`` — preserving the old URI under
   *   a new label silently produces a label/URI mismatch.
   * - Else (text == current label, no candidate match), commit
   *   unchanged (preserves existing URI).
   * - Empty text clears the term.
   */
  function commitFreeText(text: string) {
    const t = text.trim();
    if (!t) {
      onCommit(null);
      setEditing(false);
      return;
    }
    const exact = candidates.find(
      (c) => c.label.toLowerCase() === t.toLowerCase(),
    );
    if (exact) {
      commitCandidate(exact);
      return;
    }
    const sameAsCurrent =
      (value?.label ?? "").toLowerCase() === t.toLowerCase();
    onCommit({
      label: t,
      uri: sameAsCurrent ? (value?.uri ?? null) : null,
    });
    setEditing(false);
  }

  if (editing) {
    return (
      <span className="relative inline-block">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            // Defer so that an in-flight onMouseDown on a candidate
            // can commit before the popup closes. ``commitFreeText``
            // itself handles the candidate-exact-match case so a
            // typed-then-tab-out workflow lands on the right URI
            // instead of stripping or carrying-forward the wrong one.
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
              if (candidates[highlight]) {
                commitCandidate(candidates[highlight]);
              } else {
                commitFreeText(draft);
              }
              e.preventDefault();
            } else if (e.key === "ArrowDown") {
              setHighlight((h) =>
                Math.min(h + 1, Math.max(0, candidates.length - 1)),
              );
              e.preventDefault();
            } else if (e.key === "ArrowUp") {
              setHighlight((h) => Math.max(0, h - 1));
              e.preventDefault();
            }
          }}
          placeholder={placeholder}
          className={cn(
            "border border-blue-300 rounded px-1 py-0 text-sm bg-white min-w-[14ch]",
            className,
          )}
        />
        {candidates.length > 0 ? (
          <ul
            className="absolute left-0 top-full mt-0.5 z-20 bg-white border border-slate-200 rounded shadow-md min-w-[18rem] max-w-[28rem] max-h-72 overflow-auto py-1 text-xs"
            // mousedown-based commit so blur never fires first
            onMouseDown={(e) => e.preventDefault()}
          >
            {candidates.map((c, i) => (
              <CandidateRow
                key={`${c.label}|${c.uri ?? ""}`}
                candidate={c}
                highlighted={i === highlight}
                onPick={() => commitCandidate(c)}
                onHover={() => setHighlight(i)}
              />
            ))}
            {/* Free-text row — only when the user has typed something
                that isn't an exact-label match. Lets them commit
                non-ontology values explicitly. */}
            {draft.trim() &&
            !candidates.some(
              (c) => c.label.toLowerCase() === draft.trim().toLowerCase(),
            ) ? (
              <li
                className={
                  "px-2 py-1 cursor-pointer border-t border-slate-100 text-slate-500 italic " +
                  (highlight === candidates.length ? "bg-blue-50" : "hover:bg-slate-50")
                }
                onMouseEnter={() => setHighlight(candidates.length)}
                onClick={() => commitFreeText(draft)}
              >
                use free text: <span className="not-italic">{draft.trim()}</span>
                {!allowFreeText ? (
                  <span className="ml-1 text-amber-700 not-italic">
                    (off-list)
                  </span>
                ) : null}
              </li>
            ) : null}
            {/* Footer escape-hatch: switch to the URI-override form
                for the rare case the typeahead's catalog doesn't have
                the right URI for the label the curator wants. Sits
                inside the same edit flow so we don't need a second
                pencil affordance on the read view. */}
            <li
              className="border-t border-slate-100 px-2 py-1 text-[11px] text-blue-700 hover:underline cursor-pointer"
              onClick={() => {
                setEditing(false);
                setUriEditing(true);
              }}
            >
              set URI manually…
            </li>
          </ul>
        ) : isFetching ? (
          <ul
            className="absolute left-0 top-full mt-0.5 z-20 bg-white border border-slate-200 rounded shadow-md min-w-[18rem] py-1 text-xs"
            onMouseDown={(e) => e.preventDefault()}
          >
            <li className="px-2 py-1 text-slate-400">searching…</li>
            <li
              className="border-t border-slate-100 px-2 py-1 text-[11px] text-blue-700 hover:underline cursor-pointer"
              onClick={() => {
                setEditing(false);
                setUriEditing(true);
              }}
            >
              set URI manually…
            </li>
          </ul>
        ) : draft.trim() ? (
          <ul
            className="absolute left-0 top-full mt-0.5 z-20 bg-white border border-slate-200 rounded shadow-md min-w-[18rem] py-1 text-xs"
            onMouseDown={(e) => e.preventDefault()}
          >
            {/*
              Edit-open with no typed change yet: draft still equals
              the current resolved label. Don't lie that there's "no
              ontology match" — the term IS resolved (has a URI), the
              live catalog query just didn't echo it back. Show a
              "keep current term" option so the curator can confirm
              and dismiss the picker without nudging into free text.
            */}
            {value?.uri &&
            draft.trim().toLowerCase() ===
              (value.label ?? "").trim().toLowerCase() ? (
              <li
                className="px-2 py-1 cursor-pointer text-emerald-800 hover:bg-slate-50"
                onClick={() => setEditing(false)}
                title={`keep ${value.label} (${value.uri})`}
              >
                keep current:{" "}
                <span className="font-medium">{value.label}</span>
                <span className="ml-1 text-slate-400 font-mono">
                  {shortenUri(value.uri)}
                </span>
              </li>
            ) : (
              <li
                className="px-2 py-1 cursor-pointer text-slate-500 italic hover:bg-slate-50"
                onClick={() => commitFreeText(draft)}
              >
                no ontology match — use free text:{" "}
                <span className="not-italic">{draft.trim()}</span>
              </li>
            )}
            <li
              className="border-t border-slate-100 px-2 py-1 text-[11px] text-blue-700 hover:underline cursor-pointer"
              onClick={() => {
                setEditing(false);
                setUriEditing(true);
              }}
            >
              set URI manually…
            </li>
          </ul>
        ) : null}
      </span>
    );
  }

  // ----- read view -----

  const label = value?.label ?? "";
  const hasUri = !!value?.uri;
  const isUnknown = !!label && !hasUri && allowFreeText === false;

  if (uriEditing) {
    return (
      <UriOverrideForm
        value={value}
        onCommit={(next) => {
          onCommit(next);
          setUriEditing(false);
        }}
        onCancel={() => setUriEditing(false)}
      />
    );
  }

  const isEmpty = !label;
  return (
    <span
      role="button"
      tabIndex={0}
      // Single-click opens the picker on an empty slot — curators
      // need to fill it, so requiring a double-click is friction
      // (and the placeholder text reads as a label, not a
      // control). Populated terms keep the double-click guard so
      // hovering / text-selecting on resolved labels doesn't open
      // edit mode by mistake.
      onClick={isEmpty ? () => setEditing(true) : undefined}
      onDoubleClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setEditing(true);
        }
      }}
      className={cn(
        // Subject/object are the primary content of a statement.
        // Lifted to font-medium + a darker tone so they read as
        // "the answer", with the category chip and predicate
        // select stepping back as connecting tissue.
        // Note: baseline-FV terms intentionally do NOT get a
        // bespoke colour. Green is the house signal for
        // "ontology-resolved"; reusing it for baseline conflated
        // two distinct states. Baseline status is signalled only
        // by the separate ``★ baseline`` pill.
        "rounded px-1 -mx-1 select-none font-medium",
        // Empty slot with a placeholder reads as "fill this in" —
        // give it a dashed border + cursor-pointer so the curator
        // sees an affordance instead of just an italic-grey
        // placeholder. Populated terms keep the lighter
        // hover-only chrome so they don't visually shout.
        isEmpty
          ? "cursor-pointer border border-dashed border-slate-400 bg-slate-50 text-slate-500 italic font-normal hover:bg-slate-100 hover:border-slate-500 hover:text-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
          : "cursor-text hover:bg-blue-50",
        label && hasUri && "text-emerald-800",
        label && !hasUri && "text-slate-900 italic",
        isUnknown && "outline outline-1 outline-amber-300",
        className,
      )}
      title={
        hasUri
          ? `${label} — ${value!.uri} (double-click to edit; URI override inside the picker)`
          : label
            ? `${label} — free text (double-click to edit)`
            : `click to pick a term`
      }
    >
      {label || placeholder || "(term)"}
    </span>
  );
}

/** Inline 2-field override form. Used when the typeahead's
 *  resolver picks the wrong URI and the curator wants to fix it
 *  without retyping the label. */
function UriOverrideForm({
  value,
  onCommit,
  onCancel,
}: {
  value: OntologyTerm | null;
  onCommit: (next: OntologyTerm | null) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(value?.label ?? "");
  const [uri, setUri] = useState(value?.uri ?? "");
  return (
    <span className="inline-flex items-center gap-1 border border-blue-300 rounded px-1 py-0.5 bg-white">
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="label"
        className="text-sm border border-slate-200 rounded px-1 py-0 min-w-[10ch]"
      />
      <input
        value={uri}
        onChange={(e) => setUri(e.target.value)}
        placeholder="URI (e.g. http://purl.obolibrary.org/obo/MONDO_0004975)"
        className="text-xs font-mono border border-slate-200 rounded px-1 py-0 min-w-[18ch]"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onCancel();
            e.preventDefault();
          }
          if (e.key === "Enter") {
            const l = label.trim();
            const u = uri.trim() || null;
            onCommit(l || u ? { label: l, uri: u } : null);
            e.preventDefault();
          }
        }}
      />
      <button
        type="button"
        className="btn primary !px-1.5 !py-0 text-[10px]"
        onClick={() => {
          const l = label.trim();
          const u = uri.trim() || null;
          onCommit(l || u ? { label: l, uri: u } : null);
        }}
      >
        save
      </button>
      <button
        type="button"
        className="btn ghost !px-1 !py-0 text-[10px]"
        onClick={onCancel}
      >
        cancel
      </button>
    </span>
  );
}

function CandidateRow({
  candidate,
  highlighted,
  onPick,
  onHover,
}: {
  candidate: AnnotationCandidate;
  highlighted: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  const used = candidate.usage_count > 0;
  const ontology = !!candidate.uri;
  return (
    <li
      onMouseEnter={onHover}
      onClick={onPick}
      className={cn(
        "px-2 py-1 cursor-pointer flex items-center gap-2",
        highlighted ? "bg-blue-50" : "hover:bg-slate-50",
      )}
    >
      <span
        className={cn(
          "truncate flex-1",
          ontology ? "text-emerald-800" : "text-slate-700 italic",
          used ? "font-semibold" : "font-normal",
        )}
        title={ontology ? candidate.uri ?? "" : "free text"}
      >
        {candidate.label}
      </span>
      {ontology ? (
        <span className="text-[10px] text-slate-400 font-mono shrink-0">
          {shortenUri(candidate.uri!)}
        </span>
      ) : null}
      {candidate.category_label ? (
        <span className="text-[10px] text-slate-500 shrink-0">
          {candidate.category_label}
        </span>
      ) : null}
      {used ? (
        <span
          className="text-[10px] tabular-nums text-slate-500 shrink-0"
          title={`used in ${candidate.usage_count} place${
            candidate.usage_count === 1 ? "" : "s"
          } in Gemma`}
        >
          ×{formatCount(candidate.usage_count)}
        </span>
      ) : (
        <span
          className="text-[10px] text-slate-400 shrink-0 italic"
          title="never used in Gemma"
        >
          new
        </span>
      )}
    </li>
  );
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

