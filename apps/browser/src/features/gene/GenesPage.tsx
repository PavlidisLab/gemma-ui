// Gene search landing page — /genes
// Users type a symbol, official name, or NCBI id. Because symbols collide
// across taxa (human ENO2 / mouse Eno2 / rat Eno2), a typeahead dropdown
// surfaces the matching alternatives so the visitor picks the exact gene;
// each row navigates to the id-keyed page /gene/ncbi/$ncbiId. Plain submit
// (Enter with nothing highlighted) still resolves the top-ranked match.

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { resolveGeneNcbiId, searchGenes } from "@/api/endpoints";
import type { Gene } from "@/api/endpoints";
import { useDebounced } from "@/lib/useDebounced";

export function GenesPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Dropdown state. `open` gates visibility; `activeIndex` is the
  // keyboard-highlighted row (-1 = none / input itself).
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const debounced = useDebounced(query, 150);
  const trimmed = debounced.trim();

  // Cross-taxon typeahead — NO taxon filter, since surfacing the
  // per-organism alternatives is the whole point here.
  const results = useQuery({
    queryKey: ["gene-search", trimmed],
    queryFn: ({ signal }) => searchGenes(trimmed, { limit: 10, signal }),
    enabled: trimmed.length >= 2,
    staleTime: 5 * 60_000,
  });

  // Only rows we can route to (the page is NCBI-id-keyed); drop any hit
  // without an NCBI id rather than offer a dead link.
  const candidates = (results.data ?? []).filter(
    (g): g is Gene & { ncbiId: number } => g.ncbiId != null,
  );

  const showDropdown = open && trimmed.length >= 2;

  // Keep the highlighted row scrolled into view during keyboard nav.
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `#gene-opt-${activeIndex}`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Close the dropdown on outside click.
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  function goToGene(g: { ncbiId: number }) {
    setOpen(false);
    navigate({
      to: "/gene/ncbi/$ncbiId",
      params: { ncbiId: String(g.ncbiId) },
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    // A keyboard-highlighted row wins.
    if (showDropdown && activeIndex >= 0 && candidates[activeIndex]) {
      goToGene(candidates[activeIndex]);
      return;
    }
    // Otherwise go to the FIRST row the visitor sees. We must reuse the
    // dropdown's own results rather than re-resolve: the search service's
    // top-ranked hit varies with `limit` (limit=1 and limit=10 can return
    // different genes first), so a separate single-shot resolve could land
    // on a different gene than row 1. Only trust the list when it matches
    // the current input (debounce has caught up).
    if (candidates.length > 0 && trimmed === q) {
      goToGene(candidates[0]);
      return;
    }
    // No dropdown matches yet (bare NCBI id, or results still loading) —
    // fall back to the single-shot resolver.
    if (!q || resolving) return;
    setResolving(true);
    setError(null);
    try {
      const ncbiId = await resolveGeneNcbiId(q);
      if (ncbiId == null) {
        setError(`No gene matched "${q}".`);
        return;
      }
      navigate({ to: "/gene/ncbi/$ncbiId", params: { ncbiId: String(ncbiId) } });
    } catch {
      setError("Search failed — please try again.");
    } finally {
      setResolving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      if (!showDropdown || candidates.length === 0) return;
      e.preventDefault();
      setActiveIndex((i) => Math.min(candidates.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      if (!showDropdown || candidates.length === 0) return;
      e.preventDefault();
      setActiveIndex((i) => Math.max(-1, i - 1));
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
    // Enter is handled by the form's onSubmit (which honours activeIndex).
  }

  return (
    <div className="h-full overflow-y-auto bg-gemma-bg">
      <div className="max-w-2xl mx-auto px-6 py-16 space-y-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gemma-ink">
            Gene search
          </h1>
          <p className="mt-2 text-sm text-gemma-subtle">
            Enter a gene symbol (e.g. <code className="font-mono text-gemma-ink">BRCA1</code>),
            official name, or NCBI gene ID to view expression data across Gemma datasets.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex justify-center">
          <div ref={boxRef} className="relative w-full max-w-xs text-left">
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
                setActiveIndex(-1);
                if (error) setError(null);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={handleKeyDown}
              placeholder="Gene symbol or NCBI ID…"
              autoFocus
              role="combobox"
              aria-expanded={showDropdown}
              aria-controls="gene-matches"
              aria-autocomplete="list"
              aria-activedescendant={
                activeIndex >= 0 ? `gene-opt-${activeIndex}` : undefined
              }
              className="w-full text-sm px-3 py-2 rounded-md border border-gemma-grid bg-white focus:outline-none focus:ring-2 focus:ring-gemma-accent/30 focus:border-gemma-accent text-gemma-ink placeholder:text-gemma-subtle"
            />

            {showDropdown ? (
              <ul
                id="gene-matches"
                ref={listRef}
                role="listbox"
                className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-md border border-gemma-grid bg-white shadow-lg text-left divide-y divide-gemma-grid/60"
              >
                {results.isFetching && candidates.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-gemma-subtle italic">
                    searching…
                  </li>
                ) : candidates.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-gemma-subtle italic">
                    no matches
                  </li>
                ) : (
                  candidates.map((g, i) => (
                    <li
                      key={g.id}
                      id={`gene-opt-${i}`}
                      role="option"
                      aria-selected={i === activeIndex}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => goToGene(g)}
                      className={
                        "px-3 py-1.5 cursor-pointer flex items-baseline gap-2 " +
                        (i === activeIndex ? "bg-gemma-accent/10" : "")
                      }
                    >
                      <span className="font-mono font-semibold text-xs text-gemma-ink shrink-0">
                        {g.officialSymbol ?? `#${g.id}`}
                      </span>
                      {g.taxon?.commonName ? (
                        <span className="text-[10px] uppercase tracking-wide text-gemma-subtle shrink-0">
                          {g.taxon.commonName}
                        </span>
                      ) : null}
                      {g.officialName ? (
                        <span className="text-[11px] text-gemma-subtle truncate">
                          {g.officialName}
                        </span>
                      ) : null}
                      <span className="ml-auto text-[10px] font-mono text-gemma-subtle shrink-0">
                        {g.ncbiId}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </div>
        </form>

        {error ? (
          <p className="text-sm text-rose-600" role="alert">
            {error}
          </p>
        ) : null}

        <div className="text-xs text-gemma-subtle space-y-1">
          <p>
            Gene pages show GO annotations, genomic location, and differential expression
            results across all curated Gemma experiments.
          </p>
          <p>
            Gene identifiers are also linked from{" "}
            <Link
              to="/platforms"
              className="text-gemma-accent hover:underline"
            >
              platform element pages
            </Link>{" "}
            and dataset expression results.
          </p>
        </div>
      </div>
    </div>
  );
}
