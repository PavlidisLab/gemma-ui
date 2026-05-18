/**
 * Cards variant — the first-pass layout, kept as a reference point.
 *
 * Design intent (light revision of the original):
 *   - Centred hero, search input as the primary interactive element.
 *   - A compact stats strip above the cards so curators see corpus
 *     scale at a glance without diving into the dashboard variant.
 *   - Four nav cards in a responsive grid (Datasets / Platforms +
 *     two placeholder slots).
 *   - System sans-serif. Generic enough to read as "no aesthetic
 *     committed yet" — useful as the v0 baseline.
 */

import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Database, LayoutGrid, FlaskConical, Info } from "lucide-react";
import { COPY, SURFACES } from "../copy";
import { useGemmaSummary, fmtCount } from "../useGemmaSummary";

const ICONS: Record<string, React.ReactNode> = {
  Datasets: <Database className="w-5 h-5" />,
  Platforms: <LayoutGrid className="w-5 h-5" />,
  Genes: <FlaskConical className="w-5 h-5" />,
  About: <Info className="w-5 h-5" />,
};

export function HomeCards() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const s = useGemmaSummary();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) {
      navigate({ to: "/browser" });
      return;
    }
    navigate({ to: "/browser/q/$query", params: { query: q } });
  }

  return (
    <div className="h-full overflow-y-auto bg-gemma-bg">
      <div className="max-w-5xl mx-auto px-6 py-12 space-y-10">
        {/* Hero */}
        <section className="text-center space-y-5">
          <div className="inline-flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-gemma-accent" />
            <span className="text-sm font-medium tracking-tight text-gemma-ink">
              Gemma
            </span>
          </div>
          <h1 className="text-4xl font-semibold tracking-tight text-gemma-ink">
            {COPY.tagline}
          </h1>
          <p className="text-sm text-gemma-subtle max-w-xl mx-auto leading-relaxed">
            {COPY.about}
          </p>

          <form onSubmit={onSubmit} className="mx-auto max-w-xl flex items-stretch gap-2 pt-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search datasets — keyword, accession, GSE…"
              className="flex-1 px-3 py-2 rounded border border-gemma-grid bg-white text-gemma-ink placeholder:text-gemma-subtle focus:outline-none focus:ring-2 focus:ring-gemma-accent/40 focus:border-gemma-accent"
              aria-label="Search Gemma datasets"
            />
            <button
              type="submit"
              className="px-4 py-2 rounded bg-gemma-accent text-white font-medium hover:bg-gemma-accent/90"
            >
              Search
            </button>
          </form>
        </section>

        {/* Stats strip */}
        <section className="grid grid-cols-3 gap-3 text-center">
          <Stat label="Datasets" value={fmtCount(s.datasets)} />
          <Stat label="Platforms" value={fmtCount(s.platforms)} />
          <Stat label="Samples" value={fmtCount(s.samples)} />
        </section>

        {/* Nav cards */}
        <section>
          <h2 className="text-xs uppercase tracking-wide font-semibold text-gemma-subtle mb-3">
            Explore
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {SURFACES.map((surf) => (
              <NavCard key={surf.label} surface={surf} icon={ICONS[surf.label]} />
            ))}
          </div>
        </section>

        {/* Footer */}
        <section className="border-t border-gemma-grid pt-6 text-xs text-gemma-subtle space-y-1">
          <p>
            Developed by the{" "}
            <a href={COPY.links.lab} target="_blank" rel="noreferrer" className="text-gemma-accent hover:underline">
              Pavlidis Lab
            </a>{" "}
            at UBC. Source on{" "}
            <a href={COPY.links.github} target="_blank" rel="noreferrer" className="text-gemma-accent hover:underline">
              GitHub
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-gemma-grid rounded px-4 py-3">
      <div className="text-2xl font-semibold tabular-nums text-gemma-ink">
        {value}
      </div>
      <div className="text-xs text-gemma-subtle mt-0.5">{label}</div>
    </div>
  );
}

function NavCard({
  surface,
  icon,
}: {
  surface: (typeof SURFACES)[number];
  icon: React.ReactNode;
}) {
  const body = (
    <div className="flex items-start gap-3 p-4 h-full">
      <div className={surface.to ? "text-gemma-accent" : "text-gemma-subtle/60"}>{icon}</div>
      <div className="min-w-0">
        <div className={"font-medium text-sm " + (surface.to ? "text-gemma-ink" : "text-gemma-subtle")}>
          {surface.label}
        </div>
        <div className="text-xs text-gemma-subtle leading-snug mt-0.5">
          {surface.blurb}
        </div>
      </div>
    </div>
  );
  if (!surface.to) {
    return (
      <div className="block rounded border border-dashed border-gemma-grid bg-white/40 cursor-not-allowed">
        {body}
      </div>
    );
  }
  return (
    <Link
      to={surface.to}
      className="block rounded border border-gemma-grid bg-white hover:border-gemma-accent hover:shadow-sm transition-shadow"
    >
      {body}
    </Link>
  );
}
