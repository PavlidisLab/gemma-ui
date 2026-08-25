/**
 * Standalone ontology lookup for the dashboard — "what's the term for
 * X?" without opening an experiment first.
 *
 * Deliberately NOT a second term picker. ``OntologyTermPicker`` exists
 * to *commit a value into a design slot*: it's an inline
 * click-to-edit control whose whole job ends in ``onCommit``. There's
 * no slot here and nothing to commit, so reusing it would mean bolting
 * a read-only mode onto a control whose every path assumes a target.
 * What this shares with the picker is everything that carries the
 * behaviour: the same ``useAnnotationSearch`` catalog query (same
 * ``rank=usage`` ordering, same usage counts), the same optional
 * agent-backed ``useFindTerm`` escape hatch, the same
 * ``CategoryPicker``, and the same ``CurieLink`` → ``CuriePopover``
 * for definition / parents / synonyms / OLS fallback. So a term reads
 * identically here and in the design editor.
 *
 * Collapsed by default — it's a convenience, not part of the curator's
 * main path, and the dashboard's job is to get them into an
 * experiment.
 */
import { useState } from "react";
import {
  useAnnotationSearch,
  annotationSearchMessage,
} from "@/api/annotations";
import { useFindTerm, type TermCandidate } from "@/api/findTerm";
import { CategoryPicker } from "@/features/design/CategoryPicker";
import { CurieLink } from "@/components/ui/CurieLink";
import { ApiError } from "@/api/client";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { cn } from "@/lib/cn";

export function OntologyLookup() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);

  const debounced = useDebouncedValue(query, 150);
  const {
    data: candidates = [],
    isFetching,
    error: searchError,
  } = useAnnotationSearch(
    debounced,
    category,
    // No ``includeExampleUsage``: that enrichment is a batched reverse
    // lookup on Gemma's side and the picker's dropdown is the one
    // surface that renders the "e.g. …" hint. A lookup box doesn't.
    { enabled: open, limit: 25 },
  );

  // Agent-backed ontology search — LLM-backed and not cheap, so it
  // only ever fires on an explicit click, never on a keystroke. It
  // also needs a category to search within, so it stays disabled
  // until one is set.
  const find = useFindTerm();
  const [findQuery, setFindQuery] = useState<string | null>(null);
  const canFind = !!query.trim() && !!category;
  function runFind() {
    const q = query.trim();
    if (!q || !category) return;
    setFindQuery(q);
    find.mutate({ free_text: q, category });
  }

  // Same rule as the picker: catalog hits carry usage counts and win
  // the visual slot, so drop agent results that echo a URI already
  // shown above.
  const catalogUris = new Set(
    candidates.map((c) => c.uri).filter((u): u is string => !!u),
  );
  const findCandidates: TermCandidate[] =
    find.data?.candidates.filter((c) => !catalogUris.has(c.uri)) ?? [];
  const findStale = !!findQuery && findQuery !== query.trim() && !!find.data;

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-baseline gap-1.5 text-sm text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
      >
        <span className="text-[10px] leading-none text-slate-400" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        Ontology lookup
        <span className="text-xs text-slate-400 dark:text-slate-500">
          — find a term without opening an experiment
        </span>
      </button>

      {open ? (
        <div className="mt-2 border border-slate-200 dark:border-slate-700 rounded p-3 space-y-2 bg-white dark:bg-slate-900">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Term or label — e.g. astrocyte, vemurafenib, WM266-4…"
              aria-label="Look up an ontology term"
              className="flex-1 min-w-[18rem] text-sm border border-slate-300 dark:border-slate-700 rounded px-3 py-2 bg-white dark:bg-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span
              className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border bg-slate-50 border-slate-200 text-slate-600 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300"
              // Deliberately does NOT promise to narrow the catalog list:
              // Gemma's /annotations/search accepts the param and returns
              // the same rows with or without it (verified 2026-08-08).
              // The category is still passed — a server that honours it
              // gets the benefit — but its real job here is the ontology
              // search below, which can't run without one.
              title="optional — sets the category the ontology search runs in (Gemma's catalog search ignores it)"
            >
              <CategoryPicker
                value={category ? { label: category, uri: null } : null}
                placeholder="any category"
                onCommit={(next) => setCategory(next?.label || null)}
              />
            </span>
            {category ? (
              <button
                type="button"
                onClick={() => setCategory(null)}
                className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                title="clear the category filter"
              >
                clear
              </button>
            ) : null}
          </div>

          {/* Catalog hits — terms already curated in Gemma, ranked by
              how often they've actually been used. */}
          <div>
            <SectionHeader
              label="In Gemma's catalog"
              hint="terms already curated in Gemma — usage counts shown"
            />
            {candidates.length > 0 ? (
              // Capped + scrolled, mirroring the picker dropdown's
              // ``max-h-80 overflow-auto``. 25 rows unrolled push the
              // ontology-search trigger below the fold, which defeats
              // the point of a quick lookup.
              <ul className="divide-y divide-slate-100 dark:divide-slate-800 max-h-80 overflow-auto">
                {candidates.map((c) => (
                  <li
                    key={`${c.label}|${c.uri ?? ""}`}
                    className="py-1 flex items-baseline gap-2 flex-wrap"
                  >
                    <span
                      className={cn(
                        "min-w-0",
                        c.uri
                          ? "text-emerald-800 dark:text-emerald-400"
                          : "text-slate-700 dark:text-slate-300 italic",
                        c.usage_count > 0 ? "font-semibold" : "font-normal",
                      )}
                    >
                      {c.label}
                    </span>
                    <CurieLink uri={c.uri} />
                    {c.category_label ? (
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">
                        {c.category_label}
                      </span>
                    ) : null}
                    <span className="ml-auto text-[10px] tabular-nums text-slate-400 dark:text-slate-500 shrink-0">
                      {c.usage_count > 0
                        ? `used ${c.usage_count}×`
                        : "not yet used"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : isFetching ? (
              <p className="text-xs text-slate-400 italic py-1">searching…</p>
            ) : searchError ? (
              /* A failed search is not an absent term — same ordering
                 as OntologyTermPicker's dropdown. */
              <p className="text-xs text-amber-800 dark:text-amber-300 py-1">
                {annotationSearchMessage(searchError)}
              </p>
            ) : query.trim() ? (
              <p className="text-xs text-slate-500 italic py-1">
                no catalog matches for "{query.trim()}"
              </p>
            ) : (
              <p className="text-xs text-slate-400 italic py-1">
                start typing to search
              </p>
            )}
          </div>

          {/* Agent-backed ontology search — the escape hatch for terms
              Gemma has never curated. */}
          <div className="pt-1 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-baseline gap-2 flex-wrap">
              <button
                type="button"
                onClick={runFind}
                disabled={!canFind || find.isPending}
                title={
                  category
                    ? "search the ontologies directly (slower — runs the agent)"
                    : "pick a category first — the ontology search needs one"
                }
                className="text-xs px-2 py-1 rounded border border-blue-300 text-blue-800 hover:bg-blue-50 disabled:opacity-40 disabled:hover:bg-transparent dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-950/40"
              >
                {find.isPending ? "Searching ontologies…" : "Search ontologies"}
              </button>
              {!category ? (
                <span className="text-[11px] text-slate-400 dark:text-slate-500">
                  needs a category
                </span>
              ) : findStale ? (
                <span className="text-[11px] text-amber-700 dark:text-amber-400">
                  results are for "{findQuery}"
                </span>
              ) : null}
            </div>

            {find.error ? (
              <p className="text-xs text-rose-700 dark:text-rose-400 py-1">
                {find.error instanceof ApiError
                  ? find.error.status === 404
                    ? "ontology search isn't available on this server"
                    : find.error.detail || find.error.message
                  : (find.error as Error).message}
              </p>
            ) : findCandidates.length > 0 ? (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800 mt-1">
                {findCandidates.map((c) => (
                  <li key={c.uri} className="py-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-emerald-800 dark:text-emerald-400">
                        {c.label}
                      </span>
                      <CurieLink uri={c.uri} />
                      <span className="ml-auto text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
                        {c.ontology}
                      </span>
                    </div>
                    {c.definition ? (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {c.definition}
                      </p>
                    ) : null}
                    {c.rationale ? (
                      <p className="text-[11px] italic text-slate-500 dark:text-slate-400 mt-0.5">
                        {c.rationale}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : find.data && !findStale ? (
              <p className="text-xs text-slate-500 italic py-1">
                {find.data.note || "no additional terms found"}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SectionHeader({ label, hint }: { label: string; hint: string }) {
  return (
    <div
      className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 pb-0.5"
      title={hint}
    >
      {label}
    </div>
  );
}
