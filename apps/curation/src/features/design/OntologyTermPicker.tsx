import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  useAnnotationSearch,
  type AnnotationCandidate,
} from "@/api/annotations";
import { useFindTerm, type TermCandidate } from "@/api/findTerm";
import { ApiError } from "@/api/client";
import { Spinner } from "@/components/ui/Spinner";
import { useIsReadOnly } from "@/features/comparison/FlowContext";
import { cn } from "@/lib/cn";
import { shortenUri } from "@/lib/curie";
import { GeneSpeciesMark } from "@/components/ui/GeneSpeciesMark";
import { GeneLabel } from "@/components/ui/GeneLabel";
import { isGeneUri, parseGeneLabel } from "@/lib/gene";
import { taxonAbbreviation } from "@/lib/taxon";
import { useDatasetTaxon } from "./DesignDraftContext";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { useGemmaMode } from "@/lib/gemmaMode";
import type { OntologyTerm } from "@/features/experiment/types";
import { getRecentTerms, pushRecentTerm, type RecentTerm } from "./recentTerms";

/** "No row is targeted" sentinel for the dropdown's keyboard/pointer
 *  highlight. Deliberately NOT 0 — a highlight that defaults to the
 *  first candidate makes Enter bind whatever the catalog happened to
 *  return first, which is a silent ontology binding the curator never
 *  picked. That breaks the opt-in rule documented on
 *  ``commitFreeText`` (design review 2026-07-13). With the sentinel,
 *  Enter falls back to free text until the curator arrows to (or
 *  hovers) a row. */
const HIGHLIGHT_NONE = -1;

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
 * Arrow keys move the highlighted suggestion; Enter commits the
 * highlighted row, or — when nothing is highlighted — the typed text
 * as free text; Escape cancels.
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
  // Ontology routing exception — when active, the dropdown footer
  // calls out which external host is serving annotation lookups so
  // curators can tell the typeahead's results aren't coming from the
  // same backend as the rest of the UI. Temporary; drops when local
  // Gemma 2.0 ontology coverage matches staging.
  const { ontologyHost, ontologySplit } = useGemmaMode();
  // Review-mode lock: span+role="button" widgets bypass fieldset
  // disabled. Gate the open-editor affordance directly so the
  // parent doesn't need `inert` to keep the curator out of the
  // editor.
  const readOnly = useIsReadOnly();
  // Dataset species, for the gene-species check on a bound value. The
  // explicit ``taxon`` prop wins where a caller passes one; otherwise
  // the draft on screen answers it.
  const draftTaxon = useDatasetTaxon();
  const datasetTaxon = taxon ?? draftTaxon;
  const [editing, setEditing] = useState(autoOpen && !readOnly);
  const [uriEditing, setUriEditing] = useState(false);
  const [draft, setDraft] = useState(value?.label ?? "");
  const [highlight, setHighlight] = useState(HIGHLIGHT_NONE);
  const [recent, setRecent] = useState<RecentTerm[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // The dropdown portals to <body> with a computed `fixed` position
  // instead of the plain `absolute` it used to have, because a couple
  // of call sites (StatementEditModal's tag-edit dialog) render this
  // picker inside an `overflow-auto` panel — which clips any
  // absolutely-positioned descendant that overflows the panel's
  // bounds, no matter its z-index (observed as the dropdown cutting
  // off mid-list inside the dialog). Recomputed on open
  // and on any resize/scroll (capture-phase, so it also catches the
  // modal panel's own internal scroll) so it keeps tracking the input.
  // Width/height are conservative estimates (the dropdown's own
  // CSS `min-w-[22rem] max-w-[32rem]` / `max-h-80`) rather than a
  // live measurement — good enough to keep it on-screen without a
  // second measure-then-correct render pass.
  const [dropdownPos, setDropdownPos] = useState<{
    left: number;
    top: number;
  } | null>(null);
  useEffect(() => {
    if (!editing) {
      setDropdownPos(null);
      return;
    }
    function reposition() {
      if (!inputRef.current) return;
      const anchor = inputRef.current.getBoundingClientRect();
      const margin = 8;
      const estWidth = 512; // 32rem
      const estHeight = 320; // max-h-80
      let left = anchor.left;
      if (left + estWidth > window.innerWidth - margin) {
        left = Math.max(margin, window.innerWidth - estWidth - margin);
      }
      let top = anchor.bottom + 2;
      if (
        top + estHeight > window.innerHeight - margin &&
        anchor.top - estHeight - 2 > margin
      ) {
        top = anchor.top - estHeight - 2;
      }
      setDropdownPos({ left, top });
    }
    reposition();
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
    };
  }, [editing]);

  // Refresh from localStorage each time the picker opens — another
  // instance elsewhere on the page may have recorded a pick since
  // this one last mounted.
  useEffect(() => {
    if (editing) setRecent(getRecentTerms());
  }, [editing]);

  function recordRecent(term: OntologyTerm) {
    setRecent(pushRecentTerm({ label: term.label, uri: term.uri ?? null }));
  }

  // Debounce the query to avoid spamming the endpoint on every key.
  const debounced = useDebouncedValue(draft, 150);

  const { data: candidates = [], isFetching } = useAnnotationSearch(
    debounced,
    category,
    // This dropdown is the one surface that renders the "e.g. …" rare-
    // term hint, so it's the one caller that opts into the enrichment.
    { enabled: editing, limit: 25, includeExampleUsage: true },
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

  function commitCandidate(c: AnnotationCandidate) {
    const term = { label: c.label, uri: c.uri ?? null };
    recordRecent(term);
    onCommit(term);
    setEditing(false);
  }

  function commitTermCandidate(c: TermCandidate) {
    const term = { label: c.label, uri: c.uri };
    recordRecent(term);
    onCommit(term);
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

  // Drop the targeted row whenever the curator types or the row set
  // shifts under them. Two reasons, both of which end in a URI the
  // curator never picked: a highlight held over from an older query
  // points at a different term now, and a highlight parked on the
  // free-text row slides onto an ontology row when agent results
  // arrive and push that row down. Resetting to HIGHLIGHT_NONE (not
  // 0) means the fallback is free text, never row 0.
  useEffect(
    () => setHighlight(HIGHLIGHT_NONE),
    [draft, candidates.length, findCandidates.length],
  );

  /** Commit ``text`` as free text or as a matched candidate.
   *
   * Ontology binding is **opt-in**: only selecting a candidate row
   * (or the "set URI manually" escape hatch) attaches a URI. Typing a
   * label and committing WITHOUT picking a suggestion keeps free text,
   * even when the label happens to match an ontology term — so a
   * curator who deliberately wants a bare ``mdx`` isn't force-upgraded
   * to ``mdx TGEMO:00180`` (design review 2026-07-13: "if I explicitly don't
   * click on the ontology term that comes up, it should keep it as free
   * text"). Supersedes the 2026-04-27 auto-bind-on-exact-match rule.
   *
   * - Empty text clears the term.
   * - ``text`` == current label → commit unchanged (preserves the
   *   existing URI — a no-op blur mustn't silently strip it). To
   *   deliberately drop the URI and keep the same label, use the
   *   explicit "use as free text" row (``commitExplicitFreeText``).
   * - Otherwise commit free text with ``uri = null`` — carrying the old
   *   URI under a new label would produce a label/URI mismatch.
   */
  function commitFreeText(text: string) {
    const t = text.trim();
    if (!t) {
      onCommit(null);
      setEditing(false);
      return;
    }
    const sameAsCurrent =
      (value?.label ?? "").toLowerCase() === t.toLowerCase();
    const term = {
      label: t,
      uri: sameAsCurrent ? (value?.uri ?? null) : null,
    };
    recordRecent(term);
    onCommit(term);
    setEditing(false);
  }

  /** Explicit "use as free text — no ontology link" commit. ALWAYS
   *  drops the URI, even when the label matches an ontology candidate
   *  OR the current value. This is the curator's deliberate choice to
   *  keep a bare label; the only way to strip a URI while keeping the
   *  same label. Wired to the free-text row click + Enter-on-free-text-
   *  row. Design review 2026-07-13. */
  function commitExplicitFreeText(text: string) {
    const t = text.trim();
    if (!t) {
      onCommit(null);
      setEditing(false);
      return;
    }
    const term = { label: t, uri: null };
    recordRecent(term);
    onCommit(term);
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
    // Always offer the explicit free-text row when there's draft text —
    // even when the label matches an ontology candidate — so the curator
    // can deliberately keep a bare label instead of the ontology term.
    // Design review 2026-07-13: "if I explicitly don't click on the ontology term
    // that comes up, it should keep it as free text."
    const freeTextRowVisible = !!draft.trim();
    const freeTextRowIdx = freeTextRowVisible ? totalRows : HIGHLIGHT_NONE;

    function commitHighlighted() {
      // No row targeted → the curator picked nothing, so nothing gets
      // bound. Free text is a safe landing (an ungrounded subject is
      // flagged "needs grounding" downstream); a wrong URI isn't.
      if (highlight === HIGHLIGHT_NONE) {
        commitFreeText(draft);
        return;
      }
      if (highlight < candidates.length) {
        commitCandidate(candidates[highlight]);
        return;
      }
      const findIdx = highlight - candidates.length;
      if (findIdx < findCandidates.length) {
        commitTermCandidate(findCandidates[findIdx]);
        return;
      }
      // The free-text row is highlighted → deliberate free-text pick,
      // drops any URI.
      commitExplicitFreeText(draft);
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
              // Only a row the curator deliberately targeted (arrowed
              // to, or hovered) gets committed. Enter on an untouched
              // dropdown commits the typed text, honouring the opt-in
              // binding rule on ``commitFreeText`` (design review
              // 2026-07-13).
              if (
                highlight !== HIGHLIGHT_NONE &&
                (totalRows > 0 || freeTextRowVisible)
              ) {
                commitHighlighted();
              } else {
                commitFreeText(draft);
              }
              e.preventDefault();
            } else if (e.key === "ArrowDown") {
              // ``max`` goes negative when there's nothing to land on,
              // which keeps the highlight unset rather than pointing
              // at a row that isn't rendered.
              const max = freeTextRowVisible ? totalRows : totalRows - 1;
              setHighlight((h) => Math.min(h + 1, max));
              e.preventDefault();
            } else if (e.key === "ArrowUp") {
              // Arrowing up off the first row returns to "nothing
              // targeted" — the curator can back out of a selection
              // and get free text back, instead of being stuck on
              // row 0.
              setHighlight((h) => (h <= 0 ? HIGHLIGHT_NONE : h - 1));
              e.preventDefault();
            }
          }}
          placeholder={placeholder}
          className={cn(
            "border border-blue-300 rounded px-1 py-0 text-sm bg-white min-w-[14ch]",
            className,
          )}
        />
        {dropdownPos
          ? createPortal(
              <ul
                className="fixed z-[60] bg-white border border-slate-200 rounded shadow-md min-w-[22rem] max-w-[32rem] max-h-80 overflow-auto py-1 text-xs"
                style={{ left: dropdownPos.left, top: dropdownPos.top }}
                // mousedown-based commit so blur never fires first
                onMouseDown={(e) => e.preventDefault()}
                // Hover targets a row; the pointer leaving un-targets
                // it again. Without this, a row the curator merely
                // passed over on the way somewhere else stays armed,
                // and the next Enter binds it.
                onMouseLeave={() => setHighlight(HIGHLIGHT_NONE)}
              >
          {/* Section 0: recently-selected terms — client-side MRU,
              shown only before the curator starts typing (once they
              type, catalog/agent search results take over). Click
              only, not part of the arrow-key highlight index space,
              mirroring the "keep current" row below. */}
          {!draft.trim() && recent.length > 0 ? (
            <>
              <SectionHeader
                label="Recently used"
                hint="terms you picked recently in this browser"
              />
              {recent.map((r) => (
                <RecentTermRow
                  key={`${r.label}|${r.uri ?? ""}`}
                  term={r}
                  onPick={() => {
                    onCommit({ label: r.label, uri: r.uri });
                    recordRecent(r);
                    setEditing(false);
                  }}
                />
              ))}
            </>
          ) : null}

          {/* Section 1: Gemma catalog hits (with usage counts). */}
          {candidates.length > 0 ? (
            <>
              <SectionHeader
                label="In Gemma's catalog"
                hint="terms already curated in Gemma — usage counts shown"
              />
              {/* Hovering a row counts as deliberately targeting it:
                  the pointer only reaches the list by being moved
                  there, and the row lights up under it, so an Enter
                  that follows commits what the curator can see is
                  selected. */}
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
                  ? "find-term endpoint not available"
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
              there's draft text. Sits last in the same index space as
              the search rows, so the curator can arrow down to it —
              but Enter on an untouched dropdown already commits free
              text, so reaching it by keyboard is only needed to drop
              a URI from an unchanged label. */}
          {freeTextRowVisible ? (
            <li
              className={
                "px-2 py-1 cursor-pointer border-t border-slate-100 text-slate-500 italic " +
                (highlight === freeTextRowIdx
                  ? "bg-blue-50"
                  : "hover:bg-slate-50")
              }
              onMouseEnter={() => setHighlight(freeTextRowIdx)}
              onClick={() => commitExplicitFreeText(draft)}
            >
              use free text:{" "}
              <span className="not-italic">{draft.trim()}</span>
              {hasExactCatalogMatch ? (
                <span className="ml-1 text-slate-400 not-italic">
                  (no ontology link)
                </span>
              ) : null}
              {!allowFreeText ? (
                <span className="ml-1 text-amber-700 not-italic">
                  (off-list)
                </span>
              ) : null}
            </li>
          ) : null}

          {/* Ontology-source indicator — only renders when the
              ontology routing exception is active (local-mode against
              a local stack that doesn't carry the full ontologies, so
              ``/rest/v2/annotations/{search,term}`` are routed to a
              separate host). Tells the curator the typeahead hits are
              coming from somewhere other than the main backend. */}
          {ontologySplit ? (
            <li
              className="border-t border-slate-100 px-2 py-0.5 text-[10px] text-slate-500 italic"
              title="The main Gemma backend in local mode doesn't carry the full ontology corpora, so annotation lookups are proxied to this host. Goes away once local ontology coverage lands."
            >
              ontology source:{" "}
              <span className="font-mono not-italic text-slate-600">
                {ontologyHost}
              </span>
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
              </ul>,
              document.body,
            )
          : null}
      </span>
    );
  }

  // ----- read view -----

  const label = value?.label ?? "";
  const hasUri = !!value?.uri;
  const isUnknown = !!label && !hasUri && allowFreeText === false;
  // A bound gene shows its SYMBOL here, with the species beside it and
  // the full name on hover — the same treatment the read-only ``Term``
  // chip gives it, so the statement a curator edits and the statement
  // they review look like each other. This is also the row the 2026-07-21
  // truncation was patching around ("ERBB2 [human] v-erb-b2 erythroblastic
  // leukemia viral oncogene homolog 2, …" blowing out the row): the
  // symbol is the part that identifies the gene, and the species is the
  // part that decides whether the binding is right, so those are the two
  // things that stay on screen.
  const geneValue = isGeneUri(value?.uri) ? parseGeneLabel(label) : null;
  const geneValueSpecies = geneValue?.species ?? null;
  const shownLabel = geneValue?.symbol || label;

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
      role={readOnly ? undefined : "button"}
      tabIndex={readOnly ? undefined : 0}
      onClick={readOnly ? undefined : () => setEditing(true)}
      onKeyDown={
        readOnly
          ? undefined
          : (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setEditing(true);
              }
            }
      }
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
        // Cap runaway labels — some gene "names" are the full
        // descriptive string ("ERBB2 [human] v-erb-b2 erythroblastic
        // leukemia viral oncogene homolog 2, …"), which otherwise
        // blows out the statement row. Truncate with the full text in
        // the hover title; the CURIE chip beside it still pins the
        // ontology id. Design review 2026-07-21.
        !isEmpty && "inline-block align-bottom max-w-[22rem] truncate",
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
      {geneValue ? (
        <GeneLabel
          uri={value?.uri}
          symbol={geneValue.symbol}
          labelName={geneValue.fullName}
          labelSpecies={geneValue.species}
          datasetTaxon={datasetTaxon}
        />
      ) : (
        shownLabel || placeholder || "(term)"
      )}
      {geneValue ? (
        <GeneSpeciesMark
          uri={value?.uri}
          species={geneValueSpecies}
          datasetTaxon={datasetTaxon}
        />
      ) : null}
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
  const datasetTaxon = useDatasetTaxon();
  // Gene hits carry a taxon; show the compact ``H.s.`` form so a
  // curator can tell the human KRAS from the mouse Kras. Suffix
  // follows the row's emphasis (no independent bold/dim).
  //
  // Two kinds of gene row reach this list and they carry the species
  // differently: a catalogue hit ships ``taxon_scientific_name``, while
  // a prior-usage hit ships none and writes it into the label instead
  // ("Esr1 [mouse] estrogen receptor 1 (alpha)"). Read the field first,
  // fall back to the label, so both kinds show the same suffix — and
  // the row shows the SYMBOL, with the full name in the tooltip, since
  // the name is what pushed the species off the visible end of the row.
  const isGene = isGeneUri(candidate.uri);
  const geneParts = isGene ? parseGeneLabel(candidate.label) : null;
  const geneSpecies = isGene
    ? candidate.taxon_scientific_name || geneParts?.species || null
    : null;
  return (
    <li
      onMouseEnter={onHover}
      onClick={onPick}
      title={candidateTooltip(candidate)}
      className={cn(
        "px-2 py-1 cursor-pointer flex items-center gap-2",
        highlighted ? "bg-blue-50" : "hover:bg-slate-50",
      )}
    >
      <span
        className={cn(
          "truncate min-w-0",
          ontology ? "text-emerald-800" : "text-slate-700 italic",
          used ? "font-semibold" : "font-normal",
        )}
      >
        {geneParts?.symbol || candidate.label}
      </span>
      {isGene ? (
        // No ``uri`` here on purpose: a search row's species comes from
        // the hit itself (catalogue rows carry the taxon fields,
        // prior-usage rows carry it in the label), and handing the mark
        // a URI would fan a catalogue lookup out across every row of a
        // list that redraws on each keystroke.
        <GeneSpeciesMark
          species={geneSpecies}
          datasetTaxon={datasetTaxon}
          taxonId={candidate.taxon_id}
        />
      ) : taxonAbbreviation(candidate.taxon_scientific_name) ? (
        <span
          className="text-[10px] text-slate-500 shrink-0"
          title={`${candidate.taxon_scientific_name}${
            candidate.taxon_id ? ` · NCBI Taxon ${candidate.taxon_id}` : ""
          }`}
        >
          {taxonAbbreviation(candidate.taxon_scientific_name)}
        </span>
      ) : null}
      {/* Spacer pushes the URI / category / usage metadata to the
          right while the symbol + taxon suffix stay grouped left. */}
      <span className="flex-1" />
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
        <span className="text-[10px] tabular-nums text-slate-500 shrink-0">
          ×{formatCount(candidate.usage_count)}
        </span>
      ) : (
        <span className="text-[10px] text-slate-400 shrink-0 italic">new</span>
      )}
    </li>
  );
}

/** How rare a term must be (``usage_count``) before its tooltip earns
 *  an "e.g. …" example line. Common terms don't need one — a curator
 *  looking at something used 400 times already knows what it means;
 *  the example is for the handful-of-uses case where seeing a real
 *  prior usage helps them judge the match. Gating is entirely
 *  client-side by design — Gemma attaches the example whenever it has
 *  one and leaves the "is this worth showing" call to us. */
const RARE_USAGE_THRESHOLD = 3;

/** Maps ``exampleUsage.level`` to the short label curators actually
 *  want — "was this used as a tag or a factor value?" (a tooltip that
 *  only surfaced usage count without this distinction wasn't useful
 *  enough on its own). ``ExperimentTag`` and ``BioMaterial`` match
 *  Gemma's documented enum directly. ``ExperimentalDesign`` doesn't —
 *  observed on obviously FV-shaped hits (e.g. a genotype value used
 *  thousands of times under a ``genotype`` factor), reading as Gemma
 *  reporting the FV's owning grandparent entity instead of
 *  ``FactorValue``. Mapped here defensively so the UI is correct
 *  either way regardless of which string the server actually sends. */
function levelLabel(level: string): string {
  switch (level) {
    case "ExperimentTag":
      return "tag";
    case "FactorValue":
    case "ExperimentalDesign":
      return "factor value";
    case "BioMaterial":
      return "sample";
    case "ExpressionExperimentSubSet":
      return "sample subset";
    default:
      return level;
  }
}

/** Single consolidated tooltip for a dropdown row — label/URI-or-
 *  free-text, usage count, AND (for a rare term with an attached
 *  example) whether the prior usage was a tag or a factor value, the
 *  owning factor, the full S · P · O triple when the example came
 *  from a Statement, and which dataset it's from. A separate visible
 *  "e.g. …" line under the row proved too little information for the
 *  space it took, and once folded into the tooltip it still didn't
 *  say whether the example was a tag or an FV — the single most
 *  useful fact for judging relevance. */
function candidateTooltip(candidate: AnnotationCandidate): string {
  const lines: string[] = [
    candidate.uri ? `${candidate.label} — ${candidate.uri}` : `${candidate.label} — free text`,
    candidate.usage_count > 0
      ? `used in ${candidate.usage_count} place${candidate.usage_count === 1 ? "" : "s"} in Gemma`
      : "never used in Gemma",
  ];
  const example = candidate.example_usage;
  if (
    example &&
    candidate.usage_count > 0 &&
    candidate.usage_count <= RARE_USAGE_THRESHOLD
  ) {
    const bits: string[] = [
      example.parent_of_parent_name
        ? `${levelLabel(example.level)} (${example.parent_of_parent_name})`
        : levelLabel(example.level),
    ];
    if (example.predicate || example.object) {
      bits.push(
        [candidate.label, example.predicate, example.object].filter(Boolean).join(" · "),
      );
    } else if (
      example.parent_name &&
      example.parent_name.trim().toLowerCase() !== candidate.label.trim().toLowerCase()
    ) {
      // Rare shape (multi-characteristic FV whose overall value reads
      // differently from this one term) — usually parent_name just
      // echoes the candidate's own label, which isn't worth repeating.
      bits.push(`FV: ${example.parent_name}`);
    }
    // Deliberately NOT showing `source_experiment_id` — a bare
    // internal numeric id means nothing to a curator in plain tooltip
    // text (no accession, no link). Revisit once an accession is
    // available and this can become an actual link instead of dead
    // text.
    lines.push(`e.g. ${bits.join(" — ")}`);
  }
  return lines.join("\n");
}

/** One "recently used" row — same colour convention as
 *  ``CandidateRow`` (green = ontology-backed, grey italic = free
 *  text) but no usage count / taxon / category, since those aren't
 *  known client-side for an MRU entry. */
function RecentTermRow({
  term,
  onPick,
}: {
  term: RecentTerm;
  onPick: () => void;
}) {
  const ontology = !!term.uri;
  return (
    <li
      onClick={onPick}
      className="px-2 py-1 cursor-pointer flex items-center gap-2 hover:bg-slate-50"
    >
      <span
        className={cn(
          "truncate min-w-0",
          ontology ? "text-emerald-800" : "text-slate-700 italic",
        )}
        title={ontology ? term.uri ?? "" : "free text"}
      >
        {term.label}
      </span>
      <span className="flex-1" />
      {ontology ? (
        <span className="text-[10px] text-slate-400 font-mono shrink-0">
          {shortenUri(term.uri!)}
        </span>
      ) : null}
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
