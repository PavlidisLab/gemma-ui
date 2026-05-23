import { useEffect, useRef, useState } from "react";
import {
  useAnnotationSearch,
  type AnnotationCandidate,
} from "@/api/annotations";
import { useFindTerm, type TermCandidate } from "@/api/findTerm";
import { ApiError } from "@/api/client";
import { Spinner } from "@/components/ui/Spinner";
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
 * Affordance: single-click opens edit mode and shows the typeahead.
 * Enter commits; Escape cancels; arrow keys move the highlighted
 * suggestion.
 */
export function OntologyTermPicker({
  value,
  category,
  searchCategory,
  searchContext,
  experimentId,
  taxon,
  placeholder,
  className,
  onCommit,
  allowFreeText = true,
  autoOpen = false,
}: {
  value: OntologyTerm | null;
  /** Restrict the local-catalog typeahead to this category_label.
   *  ``null`` means no filter. Independent from ``searchCategory``
   *  — some surfaces want broad local results but a category-scoped
   *  agent-side ontology search. */
  category: string | null;
  /** Category to scope the agent-side ontology search
   *  (``POST /find-term``). Required by that endpoint to pick the
   *  right ontology bucket; when ``null`` the "Search ontologies"
   *  affordance is hidden. Typically the parent statement's or
   *  factor's category label. */
  searchCategory?: string | null;
  /** Slot hint forwarded to the find-term agent so it can prefer
   *  category-appropriate ontology classes (e.g. ``subject`` of a
   *  Statement vs. ``object``). Optional — agent works without it. */
  searchContext?: "subject" | "object";
  /** Experiment id forwarded to the find-term agent for additional
   *  context-aware ranking. Optional. */
  experimentId?: number;
  /** Taxon forwarded to the find-term agent (taxon-scoped ontologies
   *  like NCBITaxon / Gene-symbol lookups). Optional. */
  taxon?: string;
  placeholder?: string;
  className?: string;
  onCommit: (next: OntologyTerm | null) => void;
  /** When false, free-text entries are still permitted at the
   *  schema level but the picker visibly warns. */
  allowFreeText?: boolean;
  /** When true, start in editing mode (input focused, typeahead
   *  ready). Used by the audit editor's edit-mode where the
   *  curator already clicked "edit…" — the click should land
   *  them in the search input, not on a click-to-edit chip. */
  autoOpen?: boolean;
}) {
  const [editing, setEditing] = useState(autoOpen);
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

  // Agent-side ontology search. Fires only when the curator clicks
  // the "Search ontologies for …" trigger inside the dropdown —
  // each call hits an LLM-backed pipeline and isn't cheap, so we
  // never auto-fire on keystroke. Results render inside the same
  // dropdown alongside catalog hits; ``findTermQuery`` captures the
  // exact query the agent was asked, so we can show a "stale"
  // indicator if the curator keeps typing after firing.
  const find = useFindTerm();
  const [findTermQuery, setFindTermQuery] = useState<string | null>(null);

  // Reset the agent results whenever the curator commits, cancels,
  // or the value changes from outside — stale results would mislead.
  useEffect(() => {
    if (!editing) {
      find.reset();
      setFindTermQuery(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

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

  function commitTermCandidate(c: TermCandidate) {
    onCommit({ label: c.label, uri: c.uri });
    setEditing(false);
  }

  function runFindTerm() {
    const q = draft.trim();
    if (!q || !searchCategory) return;
    setFindTermQuery(q);
    find.mutate({
      free_text: q,
      category: searchCategory,
      experiment_id: experimentId,
      taxon,
      context: searchContext,
    });
  }

  // Dedupe agent results against catalog rows already shown — same
  // URI → don't render twice. Catalog hits carry usage_count and
  // win the visual slot.
  const catalogUris = new Set(
    candidates.map((c) => c.uri).filter((u): u is string => !!u),
  );
  const findCandidates: TermCandidate[] =
    find.data?.candidates.filter((c) => !catalogUris.has(c.uri)) ?? [];
  const findStale =
    !!findTermQuery && findTermQuery !== draft.trim() && find.data != null;

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
    // Single combined keyboard-nav index space: ``[catalog rows...,
    // find-term rows..., free-text row?]``. The trigger / "set URI"
    // footer rows are click-only — they're escape hatches, not part
    // of the picking flow.
    const totalRows = candidates.length + findCandidates.length;
    const hasExactCatalogMatch = candidates.some(
      (c) => c.label.toLowerCase() === draft.trim().toLowerCase(),
    );
    const freeTextRowVisible = !!draft.trim() && !hasExactCatalogMatch;
    const freeTextRowIdx = freeTextRowVisible ? totalRows : -1;

    function commitHighlighted() {
      if (highlight < candidates.length) {
        commitCandidate(candidates[highlight]);
        return;
      }
      const findIdx = highlight - candidates.length;
      if (findIdx < findCandidates.length) {
        commitTermCandidate(findCandidates[findIdx]);
        return;
      }
      commitFreeText(draft);
    }

    const showKeepCurrent =
      !!value?.uri &&
      !!draft.trim() &&
      draft.trim().toLowerCase() ===
        (value.label ?? "").trim().toLowerCase() &&
      candidates.length === 0 &&
      findCandidates.length === 0 &&
      !find.isPending;

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
              if (totalRows > 0 || freeTextRowVisible) {
                commitHighlighted();
              } else {
                commitFreeText(draft);
              }
              e.preventDefault();
            } else if (e.key === "ArrowDown") {
              const max =
                freeTextRowVisible ? totalRows : Math.max(0, totalRows - 1);
              setHighlight((h) => Math.min(h + 1, max));
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
        <ul
          className="absolute left-0 top-full mt-0.5 z-20 bg-white border border-slate-200 rounded shadow-md min-w-[22rem] max-w-[32rem] max-h-80 overflow-auto py-1 text-xs"
          // mousedown-based commit so blur never fires first
          onMouseDown={(e) => e.preventDefault()}
        >
          {/* Section 1: Gemma catalog hits (with usage counts). */}
          {candidates.length > 0 ? (
            <>
              <SectionHeader
                label="In Gemma's catalog"
                hint="terms already curated in Gemma — usage counts shown"
              />
              {candidates.map((c, i) => (
                <CandidateRow
                  key={`${c.label}|${c.uri ?? ""}`}
                  candidate={c}
                  highlighted={i === highlight}
                  onPick={() => commitCandidate(c)}
                  onHover={() => setHighlight(i)}
                />
              ))}
            </>
          ) : isFetching ? (
            <li className="px-2 py-1 text-slate-400 italic">
              searching catalog…
            </li>
          ) : draft.trim() && !showKeepCurrent ? (
            <li className="px-2 py-1 text-slate-500 italic">
              no catalog matches for "{draft.trim()}"
            </li>
          ) : null}

          {/* "Keep current" — draft equals the already-resolved value
              and the catalog didn't echo it back. Stops the picker
              from coercing the curator into the "free text" path on
              what was already a valid term. */}
          {showKeepCurrent ? (
            <li
              className="px-2 py-1 cursor-pointer text-emerald-800 hover:bg-slate-50"
              onClick={() => setEditing(false)}
              title={`keep ${value!.label} (${value!.uri})`}
            >
              keep current:{" "}
              <span className="font-medium">{value!.label}</span>
              <span className="ml-1 text-slate-400 font-mono">
                {shortenUri(value!.uri!)}
              </span>
            </li>
          ) : null}

          {/* Section 2: ontology-agent hits. Only renders after the
              curator explicitly fires "Search ontologies" — the
              agent endpoint runs an LLM and is too expensive to
              auto-fire on each keystroke. */}
          {findCandidates.length > 0 ? (
            <>
              <SectionHeader
                label={
                  findStale
                    ? `From ontology search (for "${findTermQuery}")`
                    : "From ontology search"
                }
                hint={
                  findStale
                    ? "agent results for a previous query — re-search to refresh"
                    : "agent-resolved candidates from EFO / MONDO / UBERON / CL / CHEBI etc."
                }
                muted={findStale}
              />
              {findCandidates.map((c, i) => {
                const idx = candidates.length + i;
                return (
                  <FindTermRow
                    key={`${c.uri}|${c.source}`}
                    candidate={c}
                    requestedCategory={searchCategory ?? null}
                    highlighted={idx === highlight}
                    stale={findStale}
                    onPick={() => commitTermCandidate(c)}
                    onHover={() => setHighlight(idx)}
                  />
                );
              })}
            </>
          ) : null}

          {/* Section 3: find-term status / trigger. Renders only when
              ``searchCategory`` is provided — the agent requires it
              to scope the ontology bucket. */}
          {searchCategory && draft.trim() ? (
            find.isPending ? (
              <li className="px-2 py-1 text-slate-500 inline-flex items-center gap-1.5">
                <Spinner />
                searching ontologies for "{draft.trim()}"…
              </li>
            ) : find.error ? (
              <li className="px-2 py-1 text-amber-800 border-t border-slate-100">
                {find.error instanceof ApiError && find.error.status === 404
                  ? "find-term endpoint not available — see FIND-TERM-HANDOFF.md"
                  : find.error instanceof ApiError
                    ? find.error.detail || find.error.message
                    : (find.error as Error).message}
                <button
                  type="button"
                  className="ml-2 text-blue-700 hover:underline"
                  onClick={runFindTerm}
                >
                  retry
                </button>
              </li>
            ) : findCandidates.length === 0 && find.data && !findStale ? (
              // Agent returned (or filtered to) zero candidates. Show
              // the note so the curator sees why instead of a silent
              // dead-end.
              <li className="px-2 py-1 text-slate-500 italic border-t border-slate-100">
                {find.data.note ||
                  `no ontology candidates found for "${findTermQuery}"`}
                <button
                  type="button"
                  className="ml-2 text-blue-700 hover:underline not-italic"
                  onClick={runFindTerm}
                >
                  ↻ re-search
                </button>
              </li>
            ) : (
              <li
                className="px-2 py-1 cursor-pointer text-blue-700 hover:bg-blue-50 border-t border-slate-100 inline-flex items-center gap-1"
                onClick={runFindTerm}
                title={`look up ontology candidates for "${draft.trim()}" — runs the find-term agent`}
              >
                <span>↻</span>
                <span>
                  {find.data ? "Re-search ontologies" : "Search ontologies"}{" "}
                  for "{draft.trim()}"
                </span>
                <span className="ml-1 text-[10px] text-slate-500">
                  ({searchCategory})
                </span>
              </li>
            )
          ) : null}

          {/* Section 4: explicit free-text commit. Visible whenever
              the curator's draft isn't already mirrored by a catalog
              candidate. Highlighted via the same index space as
              search rows so Enter still lands here on an empty
              search. */}
          {freeTextRowVisible ? (
            <li
              className={
                "px-2 py-1 cursor-pointer border-t border-slate-100 text-slate-500 italic " +
                (highlight === freeTextRowIdx
                  ? "bg-blue-50"
                  : "hover:bg-slate-50")
              }
              onMouseEnter={() => setHighlight(freeTextRowIdx)}
              onClick={() => commitFreeText(draft)}
            >
              use free text:{" "}
              <span className="not-italic">{draft.trim()}</span>
              {!allowFreeText ? (
                <span className="ml-1 text-amber-700 not-italic">
                  (off-list)
                </span>
              ) : null}
            </li>
          ) : null}

          {/* Footer escape-hatch: paste a URI directly. */}
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
      onClick={() => setEditing(true)}
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
        // by the separate ``▂ baseline`` pill.
        "rounded px-1 -mx-1 select-none font-medium",
        // Empty slot with a placeholder reads as "fill this in" —
        // give it a dashed border + cursor-pointer so the curator
        // sees an affordance instead of just an italic-grey
        // placeholder. Populated terms keep the lighter
        // hover-only chrome so they don't visually shout.
        isEmpty
          ? "cursor-pointer border border-dashed border-slate-400 bg-slate-50 text-slate-500 italic font-normal hover:bg-slate-100 hover:border-slate-500 hover:text-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
          : "cursor-text hover:bg-blue-50 dark:hover:bg-blue-900/30",
        label && hasUri && "text-emerald-700 dark:text-emerald-400",
        label && !hasUri && "text-slate-800 border-b border-sky-500 dark:text-sky-200 dark:border-sky-600",
        isUnknown && "outline outline-1 outline-amber-300",
        className,
      )}
      title={
        hasUri
          ? `${label} — ${value!.uri} (click to edit; URI override inside the picker)`
          : label
            ? `${label} — free text (click to edit)`
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

/** Compact section divider inside the dropdown. Distinguishes the
 *  catalog-hits block from the ontology-agent-hits block so the
 *  curator can read the two as separate evidence sources. */
function SectionHeader({
  label,
  hint,
  muted,
}: {
  label: string;
  hint?: string;
  muted?: boolean;
}) {
  return (
    <li
      className={cn(
        "px-2 py-0.5 text-[10px] uppercase tracking-wide font-semibold border-t border-slate-100 first:border-t-0 bg-slate-50",
        muted ? "text-slate-400" : "text-slate-500",
      )}
      title={hint}
    >
      {label}
    </li>
  );
}

/** One ontology-agent candidate. Carries more shape than a catalog
 *  row: source (catalog / ontology_lookup / llm_match), definition,
 *  parent label, optional category. Renders without a usage count
 *  (the agent isn't pulling those — that's a catalog-only signal). */
function FindTermRow({
  candidate,
  requestedCategory,
  highlighted,
  stale,
  onPick,
  onHover,
}: {
  candidate: TermCandidate;
  /** Slot category the agent was asked to scope to — used to flag
   *  candidates whose own category disagrees. */
  requestedCategory: string | null;
  highlighted: boolean;
  stale?: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  const catMismatch =
    !!candidate.category &&
    !!requestedCategory &&
    candidate.category.trim().toLowerCase() !==
      requestedCategory.trim().toLowerCase();
  return (
    <li
      onMouseEnter={onHover}
      onClick={onPick}
      className={cn(
        "px-2 py-1 cursor-pointer flex items-start gap-2",
        highlighted ? "bg-blue-50" : "hover:bg-slate-50",
        stale && "opacity-60",
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 flex-wrap">
          <span
            className="text-emerald-800 font-medium truncate"
            title={candidate.uri}
          >
            {candidate.label}
          </span>
          <span className="text-[10px] text-slate-400 font-mono shrink-0">
            {shortenUri(candidate.uri) || candidate.ontology}
          </span>
          <SourceBadge source={candidate.source} />
          {candidate.category ? (
            <span
              className={cn(
                "text-[9px] uppercase tracking-wide font-semibold px-1 py-0 rounded border shrink-0",
                catMismatch
                  ? "bg-amber-50 text-amber-800 border-amber-200"
                  : "bg-slate-50 text-slate-600 border-slate-200",
              )}
              title={
                catMismatch
                  ? `category mismatch — searched ${requestedCategory}, this candidate is ${candidate.category}`
                  : `category: ${candidate.category}`
              }
            >
              {candidate.category}
            </span>
          ) : null}
        </div>
        {candidate.definition ? (
          <div className="text-[11px] text-slate-600 leading-snug line-clamp-2 mt-0.5">
            {candidate.definition}
          </div>
        ) : null}
        {candidate.parent_label ? (
          <div className="text-[10px] text-slate-500 truncate">
            parent: {candidate.parent_label}
          </div>
        ) : null}
        {candidate.rationale ? (
          <div className="text-[10px] text-slate-500 italic truncate">
            {candidate.rationale}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function SourceBadge({ source }: { source: TermCandidate["source"] }) {
  const cls =
    source === "annotation_search"
      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
      : source === "ontology_lookup"
        ? "bg-slate-50 text-slate-600 border-slate-200"
        : "bg-amber-50 text-amber-800 border-amber-200";
  const label =
    source === "annotation_search"
      ? "catalog"
      : source === "ontology_lookup"
        ? "ontology"
        : "llm";
  return (
    <span
      className={cn(
        "text-[9px] uppercase tracking-wide font-semibold px-1 py-0 rounded border shrink-0",
        cls,
      )}
      title={`source: ${source}`}
    >
      {label}
    </span>
  );
}
