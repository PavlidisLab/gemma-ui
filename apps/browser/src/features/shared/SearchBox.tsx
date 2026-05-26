/**
 * Shared search input. Submit (Enter or Search-button click) takes
 * the user to ``/browser/q/<query>`` — the canonical search-results
 * route. Empty submission goes to ``/browser`` (un-queried browse).
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

export function SearchBox({
  variant = "compact",
  placeholder,
}: {
  variant?: "compact" | "hero";
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = q.trim();
    navigate({
      to: v ? `/browser/q/${encodeURIComponent(v)}` : "/browser",
    });
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
