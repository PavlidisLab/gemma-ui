/**
 * Library-catalog variant — physical card-catalog aesthetic.
 *
 * Design intent:
 *   - Tan/cream paper background. Typewriter / monospaced display
 *     type, sans body for readability.
 *   - The page is a set of index cards: rounded corners, "punched
 *     hole" affordance at the bottom of each card, dotted borders to
 *     suggest perforation.
 *   - Faux Dewey-decimal-style classification slugs in the corner of
 *     each surface card (purely decorative — they're consistent IDs
 *     mapped from surface name, not a real classification).
 *   - Reads like a humanities-department index drawer. The look is
 *     anti-modern on purpose; "library not Linear."
 */

import { Link } from "@tanstack/react-router";
import { COPY, SURFACES } from "../copy";
import { useGemmaSummary, fmtCount } from "../useGemmaSummary";

const TYPEWRITER = '"IBM Plex Mono", "Courier New", Menlo, monospace';

export function HomeLibraryCatalog() {
  const s = useGemmaSummary();
  return (
    <div
      className="h-full overflow-y-auto bg-[#f3ead2] text-stone-900"
      style={{ fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif' }}
    >
      <div className="max-w-5xl mx-auto px-8 py-10 space-y-8">
        {/* Drawer label */}
        <header className="flex items-baseline justify-between border-b-2 border-stone-700 pb-2">
          <div className="flex items-baseline gap-3">
            <span
              className="inline-flex items-center px-2 py-0.5 bg-stone-900 text-[#f3ead2] text-[10px] uppercase tracking-[0.2em]"
              style={{ fontFamily: TYPEWRITER }}
            >
              Drawer 01 · A–Z
            </span>
            <span
              className="text-2xl font-bold tracking-tight"
              style={{ fontFamily: TYPEWRITER }}
            >
              gemma
            </span>
          </div>
          <span
            className="text-[10px] uppercase tracking-[0.2em] text-stone-600"
            style={{ fontFamily: TYPEWRITER }}
          >
            classified · re-analyzed · accessioned
          </span>
        </header>

        {/* Hero card */}
        <article className="bg-[#faf3df] border border-stone-700 rounded-md shadow-[3px_3px_0_0_#1c1917] p-6">
          <div
            className="text-[10px] uppercase tracking-[0.2em] text-stone-600 mb-2"
            style={{ fontFamily: TYPEWRITER }}
          >
            Subject heading
          </div>
          <h1 className="text-3xl leading-snug tracking-tight text-stone-900">
            {COPY.tagline}
          </h1>
          <p className="text-sm text-stone-700 leading-relaxed mt-3 max-w-3xl">
            {COPY.about}
          </p>
          {/* Punched holes */}
          <div className="flex items-center justify-center gap-12 mt-5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#f3ead2] border border-stone-600" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#f3ead2] border border-stone-600" />
          </div>
        </article>

        {/* Counts card */}
        <article className="bg-[#faf3df] border border-stone-700 rounded-md shadow-[3px_3px_0_0_#1c1917] p-6">
          <div className="flex items-baseline justify-between mb-4">
            <div
              className="text-[10px] uppercase tracking-[0.2em] text-stone-600"
              style={{ fontFamily: TYPEWRITER }}
            >
              Inventory · {new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </div>
            <div
              className="text-[10px] text-stone-600"
              style={{ fontFamily: TYPEWRITER }}
            >
              CALL NO. INV-001
            </div>
          </div>
          <dl className="grid grid-cols-3 gap-6 border-t border-dashed border-stone-500 pt-4">
            <Inventory label="Datasets" v={fmtCount(s.datasets)} />
            <Inventory label="Platforms" v={fmtCount(s.platforms)} />
            <Inventory label="Samples" v={fmtCount(s.samples)} />
          </dl>
          <div className="flex items-center justify-center gap-12 mt-5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#f3ead2] border border-stone-600" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#f3ead2] border border-stone-600" />
          </div>
        </article>

        {/* Section cards — mini catalog entries */}
        <section>
          <div
            className="text-[10px] uppercase tracking-[0.2em] text-stone-600 mb-2 px-1"
            style={{ fontFamily: TYPEWRITER }}
          >
            Cross-references
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {SURFACES.map((surf, i) => (
              <CatalogCard key={surf.label} surface={surf} dewey={callNumber(surf.label, i)} />
            ))}
          </div>
        </section>

        {/* Acquisitions strip */}
        <footer
          className="text-[10px] text-stone-600 leading-relaxed border-t-2 border-stone-700 pt-3"
          style={{ fontFamily: TYPEWRITER }}
        >
          ACQUISITIONS · {COPY.citation} ·{" "}
          <a href={COPY.links.github} target="_blank" rel="noreferrer" className="underline hover:text-stone-900">
            github
          </a>{" "}
          ·{" "}
          <a href={COPY.links.docs} target="_blank" rel="noreferrer" className="underline hover:text-stone-900">
            docs
          </a>
        </footer>
      </div>
    </div>
  );
}

function Inventory({ label, v }: { label: string; v: string }) {
  return (
    <div>
      <div
        className="text-[10px] uppercase tracking-[0.2em] text-stone-700 mb-1"
        style={{ fontFamily: TYPEWRITER }}
      >
        {label}
      </div>
      <div
        className="text-3xl text-stone-900 tabular-nums font-bold"
        style={{ fontFamily: TYPEWRITER }}
      >
        {v}
      </div>
    </div>
  );
}

function CatalogCard({
  surface,
  dewey,
}: {
  surface: (typeof SURFACES)[number];
  dewey: string;
}) {
  const inner = (
    <article
      className={
        "bg-[#faf3df] border border-stone-700 rounded-md shadow-[2px_2px_0_0_#1c1917] p-5 h-full " +
        (surface.to ? "hover:shadow-[3px_3px_0_0_#1c1917] hover:-translate-x-px hover:-translate-y-px transition-transform" : "opacity-50")
      }
    >
      <div className="flex items-baseline justify-between mb-2">
        <span
          className="text-[10px] uppercase tracking-[0.2em] text-stone-600"
          style={{ fontFamily: TYPEWRITER }}
        >
          {dewey}
        </span>
        {surface.to ? null : (
          <span
            className="text-[9px] uppercase tracking-[0.2em] text-stone-500"
            style={{ fontFamily: TYPEWRITER }}
          >
            on order
          </span>
        )}
      </div>
      <h3
        className="text-2xl tracking-tight text-stone-900"
        style={{ fontFamily: TYPEWRITER }}
      >
        {surface.label.toUpperCase()}
      </h3>
      <p className="text-xs text-stone-700 leading-snug mt-2">
        {surface.blurb}
      </p>
    </article>
  );
  if (!surface.to) return inner;
  return (
    <Link to={surface.to} className="block hover:no-underline">
      {inner}
    </Link>
  );
}

/** Decorative pseudo-Dewey number — stable per label so the eye
 *  catches "I've seen this card before" between visits. */
function callNumber(label: string, idx: number): string {
  const major = 500 + idx * 30;
  const minor = (label.charCodeAt(0) % 90) + 10;
  return `${major}.${String(minor).padStart(2, "0")} · ${label.slice(0, 3).toUpperCase()}`;
}
