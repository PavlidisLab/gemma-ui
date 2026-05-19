// Gene search landing page — /genes
// Users type a symbol or NCBI ID and navigate to /gene/:id.

import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";

export function GenesPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    navigate({ to: "/gene/$id", params: { id: q } });
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

        <form onSubmit={handleSubmit} className="flex gap-2 justify-center">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Gene symbol or NCBI ID…"
            autoFocus
            className="flex-1 max-w-xs text-sm px-3 py-2 rounded-md border border-gemma-grid bg-white focus:outline-none focus:ring-2 focus:ring-gemma-accent/30 focus:border-gemma-accent text-gemma-ink placeholder:text-gemma-subtle"
          />
          <button
            type="submit"
            disabled={!query.trim()}
            className="px-4 py-2 rounded-md bg-gemma-accent text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gemma-accent/90 transition-colors"
          >
            Search
          </button>
        </form>

        <div className="text-xs text-gemma-subtle space-y-1">
          <p>
            Gene pages show GO annotations, genomic location, and differential expression
            results across all curated Gemma experiments.
          </p>
          <p>
            Gene identifiers are also linked from{" "}
            <a
              href="/platforms"
              className="text-gemma-accent hover:underline"
            >
              platform element pages
            </a>{" "}
            and dataset expression results.
          </p>
        </div>
      </div>
    </div>
  );
}
