/**
 * Academic conference-poster variant.
 *
 * Design intent:
 *   - 3-column layout that reads like a scientific poster session:
 *     bold title strip across the top, an "Abstract" lede, then
 *     parallel METHODS / RESULTS / DISCUSSION-style columns.
 *   - Tabular figure blocks instead of decorative imagery; the
 *     "figures" are real corpus counts and a small bar plot of
 *     dataset-by-taxon (rendered in inline SVG with no library).
 *   - Helvetica / sans-serif body, serif italic captions ("Figure 1:
 *     ..."). Hairline rules, no shadows.
 *   - Author / affiliation strip at the bottom mimics the poster
 *     authorship block; doubles as a citation.
 *   - The home page reads as a Gemma "abstract poster" — defensible
 *     in a lab-page register without slipping into clipart territory.
 */

import { Link } from "@tanstack/react-router";
import { COPY, SURFACES } from "../copy";
import { useGemmaSummary, fmtCount } from "../useGemmaSummary";

export function HomeAcademicPoster() {
  const s = useGemmaSummary();
  return (
    <div
      className="h-full overflow-y-auto bg-[#fbfbf7] text-stone-900"
      style={{ fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif' }}
    >
      <div className="max-w-7xl mx-auto px-8 py-8 space-y-6">
        {/* Title strip — poster header */}
        <header className="border-y-4 border-stone-900 py-5">
          <div className="text-[10px] uppercase tracking-[0.3em] text-stone-600 mb-2">
            Pavlidis Lab · University of British Columbia · Poster No. 01
          </div>
          <h1 className="text-5xl leading-[1.0] tracking-tight font-bold text-stone-900 max-w-5xl">
            {COPY.tagline}
          </h1>
          <div
            className="text-sm text-stone-700 mt-3 italic"
            style={{ fontFamily: "Georgia, serif" }}
          >
            N. Lim, S. Tesar, M. Belmadani, et al. <span className="not-italic text-stone-500">— University of British Columbia, Department of Psychiatry</span>
          </div>
        </header>

        {/* Abstract */}
        <section className="border border-stone-300 bg-white p-5">
          <div className="text-[10px] uppercase tracking-[0.25em] text-stone-600 font-bold mb-2">
            Abstract
          </div>
          <p className="text-sm leading-relaxed text-stone-800 columns-1 md:columns-2 gap-8">
            {COPY.about} {COPY.whoFor}
          </p>
        </section>

        {/* 3-column body: Corpus / Surfaces / Methods */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Col 1: Corpus figures */}
          <article className="border border-stone-300 bg-white p-5">
            <div className="text-[10px] uppercase tracking-[0.25em] text-stone-600 font-bold border-b border-stone-300 pb-2 mb-3">
              1. Corpus
            </div>
            <FigureNumber n={1} caption="Live counts as of page load. Dashes indicate metrics awaiting backend support.">
              <dl className="space-y-2">
                <PosterRow k="Datasets" v={fmtCount(s.datasets)} />
                <PosterRow k="Platforms" v={fmtCount(s.platforms)} />
                <PosterRow k="Samples" v={fmtCount(s.samples)} />
              </dl>
            </FigureNumber>

            <div className="mt-6">
              <FigureNumber
                n={2}
                caption="Coverage by organism, normalized to the largest taxon (placeholder bars; live data pending the per-taxon endpoint)."
              >
                <TaxonBars
                  data={[
                    { label: "Human", value: 0.45 },
                    { label: "Mouse", value: 1.0 },
                    { label: "Rat", value: 0.13 },
                    { label: "Other", value: 0.08 },
                  ]}
                />
              </FigureNumber>
            </div>
          </article>

          {/* Col 2: Surfaces (Methods) */}
          <article className="border border-stone-300 bg-white p-5">
            <div className="text-[10px] uppercase tracking-[0.25em] text-stone-600 font-bold border-b border-stone-300 pb-2 mb-3">
              2. Surfaces
            </div>
            <ul className="space-y-3 text-sm">
              {SURFACES.map((surf) => (
                <li key={surf.label} className="border-l-2 border-stone-300 pl-3">
                  {surf.to ? (
                    <Link
                      to={surf.to}
                      className="text-stone-900 hover:text-stone-600 hover:no-underline"
                    >
                      <div className="font-bold text-base">{surf.label}</div>
                      <div className="text-xs text-stone-600 leading-snug">
                        {surf.blurb}
                      </div>
                    </Link>
                  ) : (
                    <div className="opacity-50">
                      <div className="font-bold text-base">
                        {surf.label}{" "}
                        <span className="text-[10px] uppercase font-normal text-stone-500">
                          [in progress]
                        </span>
                      </div>
                      <div className="text-xs text-stone-600 leading-snug">
                        {surf.blurb}
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </article>

          {/* Col 3: Discussion / Access */}
          <article className="border border-stone-300 bg-white p-5">
            <div className="text-[10px] uppercase tracking-[0.25em] text-stone-600 font-bold border-b border-stone-300 pb-2 mb-3">
              3. Access
            </div>
            <p className="text-sm leading-relaxed text-stone-800 mb-3">
              Three programmatic entry points cover the bulk of analytical
              use: a REST API, the R client (<span className="italic">gemma.R</span>),
              and a Python client (<span className="italic">gemmapy</span>).
            </p>
            <dl className="space-y-2 text-sm">
              <AccessRow href={COPY.links.rest} label="REST API" hint="OpenAPI / JSON" />
              <AccessRow href={COPY.links.rClient} label="gemma.R" hint="R client" />
              <AccessRow href={COPY.links.pyClient} label="gemmapy" hint="Python client" />
              <AccessRow href={COPY.links.docs} label="Documentation" hint="full reference" />
            </dl>
          </article>
        </section>

        {/* Footer — citation strip */}
        <footer className="border-t-4 border-stone-900 pt-3">
          <div className="text-[11px] text-stone-700 leading-relaxed">
            <span className="font-bold">Cite as:</span>{" "}
            <span
              className="italic"
              style={{ fontFamily: "Georgia, serif" }}
            >
              {COPY.citation}
            </span>
          </div>
          <div className="flex items-center gap-4 mt-2 text-[10px] uppercase tracking-[0.2em] text-stone-500">
            <a href={COPY.links.github} className="hover:text-stone-900" target="_blank" rel="noreferrer">
              github
            </a>
            <a href={COPY.links.lab} className="hover:text-stone-900" target="_blank" rel="noreferrer">
              pavlidis lab
            </a>
            <span className="ml-auto">{new Date().getFullYear()}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

function FigureNumber({
  n,
  caption,
  children,
}: {
  n: number;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="border border-stone-300 bg-stone-50 p-3 mb-1.5">
        {children}
      </div>
      <div
        className="text-[10px] text-stone-600 leading-snug italic"
        style={{ fontFamily: "Georgia, serif" }}
      >
        <span className="font-bold not-italic">Figure {n}.</span> {caption}
      </div>
    </div>
  );
}

function PosterRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-dotted border-stone-300 pb-1">
      <dt className="text-xs text-stone-700">{k}</dt>
      <dd className="text-lg font-bold tabular-nums text-stone-900">{v}</dd>
    </div>
  );
}

function AccessRow({
  href,
  label,
  hint,
}: {
  href: string;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-dotted border-stone-300 pb-1">
      <dt>
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-stone-900 hover:text-stone-600 hover:underline"
        >
          {label}
        </a>
      </dt>
      <dd className="text-[10px] text-stone-500 italic">{hint}</dd>
    </div>
  );
}

/** Tiny SVG bar chart — pure layout, no chart library. Bars are
 *  proportional to ``value`` (max = 1.0). */
function TaxonBars({
  data,
}: {
  data: { label: string; value: number }[];
}) {
  const W = 240;
  const H = 88;
  const labelW = 60;
  const barAreaW = W - labelW - 8;
  const rowH = H / data.length;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      className="block"
    >
      {data.map((d, i) => {
        const y = i * rowH + 4;
        const barH = rowH - 8;
        const barW = barAreaW * d.value;
        return (
          <g key={d.label}>
            <text
              x={0}
              y={y + barH * 0.75}
              fontSize="9"
              fill="#374151"
              fontFamily="Helvetica, Arial, sans-serif"
            >
              {d.label}
            </text>
            <rect
              x={labelW}
              y={y}
              width={barW}
              height={barH}
              fill="#1c1917"
            />
          </g>
        );
      })}
    </svg>
  );
}
