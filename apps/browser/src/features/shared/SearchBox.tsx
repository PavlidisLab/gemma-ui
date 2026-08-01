/**
 * Shared search input. Submit (Enter or Search-button click) takes
 * the user to ``/browser/q/<query>`` — the canonical search-results
 * route. Empty submission goes to ``/browser`` (un-queried browse).
 *
 * Shortname shortcut: if the query is a single token that resolves to
 * a dataset whose shortName matches exactly (case-insensitive) — e.g.
 * ``GSE12345`` — we skip search and land straight on that dataset's
 * page. Anything else (free text, gene symbols, non-matching tokens)
 * falls through to the normal search route.
 *
 * Two visual variants:
 *   - ``compact`` — slim inline input for the AppBar nav strip.
 *   - ``hero``    — large prominent input for the home page.
 *
 * Stateless w.r.t. the URL — the input is uncontrolled-after-mount.
 * Pages that need to seed from URL params (BrowserPage) read via
 * ``useUrlInitial()`` separately.
 */

import { useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { getDatasetById } from "@/api/endpoints";

export function SearchBox({
  variant = "compact",
  placeholder,
}: {
  variant?: "compact" | "hero";
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = q.trim();
    if (!v) {
      navigate({ to: "/browser" });
      return;
    }

    // Single-token queries might be a dataset shortname/accession —
    // try a direct resolve and jump to the dataset page on an exact
    // shortName match. Multi-word queries can't be a shortname, so we
    // skip the extra request. Any failure or non-match falls through
    // to the normal search route.
    if (!/\s/.test(v)) {
      try {
        const ds = await getDatasetById(v);
        if (ds && ds.shortName?.toLowerCase() === v.toLowerCase()) {
          navigate({ to: `/dataset/${encodeURIComponent(ds.shortName)}` });
          return;
        }
      } catch {
        // fall through to search
      }
    }

    navigate({ to: `/browser/q/${encodeURIComponent(v)}` });
  };

  if (variant === "hero") {
    return (
      <form onSubmit={submit} className="w-full" role="search">
        <div className="flex items-stretch border border-stone-900 bg-stone-50">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={placeholder ?? "Search datasets, genes, terms…"}
            aria-label="Search Gemma"
            className="flex-1 px-4 py-3 text-base bg-transparent text-stone-900 placeholder-stone-500 focus:outline-none"
          />
          <button
            type="submit"
            className="px-5 py-3 text-sm font-semibold bg-stone-900 text-stone-50 hover:bg-stone-800"
          >
            Search →
          </button>
        </div>
      </form>
    );
  }

  // compact
  return (
    <form onSubmit={submit} className="flex items-stretch" role="search">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder ?? "Search Gemma…"}
        aria-label="Search Gemma"
        className="px-2 py-1 text-sm bg-stone-50 border border-stone-300 text-stone-900 placeholder-stone-500 focus:outline-none focus:border-stone-900 min-w-[16ch] max-w-[28ch]"
      />
      <button
        type="submit"
        className="px-2.5 py-1 text-sm bg-stone-900 text-stone-50 border border-stone-900 hover:bg-stone-800"
        aria-label="Submit search"
      >
        →
      </button>
    </form>
  );
}
