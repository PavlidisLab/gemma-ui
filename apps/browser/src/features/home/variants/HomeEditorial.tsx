/**
 * Editorial variant — newspaper/magazine register.
 *
 * Design intent:
 *   - Serif headline (Georgia → fallback) with a slim sans-serif body.
 *   - Multi-column on wide viewports; collapses to single column on
 *     narrow.
 *   - Hairline dividers, no rounded corners, no shadows. Treats the
 *     home page as the front page of a publication — masthead, lede,
 *     section pointers, colophon.
 *   - Live counts read as a small inline figure block, not a hero.
 */

import { Link } from "@tanstack/react-router";
import { COPY, SURFACES } from "../copy";
import { useGemmaSummary, fmtCount } from "../useGemmaSummary";

export function HomeEditorial() {
  const s = useGemmaSummary();
  return (
    <div
      className="h-full overflow-y-auto bg-[#fbfaf6] text-stone-900"
      style={{ fontFamily: 'Georgia, "Times New Roman", Times, serif' }}
    >
      <div className="max-w-5xl mx-auto px-8 py-10">
        {/* Masthead */}
        <header className="flex items-baseline justify-between border-b-2 border-stone-900 pb-2">
          <div className="flex items-baseline gap-3">
            <Wordmark />
            <span
              className="text-[11px] uppercase tracking-[0.18em] text-stone-500"
              style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
            >
              Vol. 1 · No. 1
            </span>
          </div>
          <span
            className="text-[11px] text-stone-500"
            style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
          >
            {new Date().toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </span>
        </header>

        {/* Lede */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-8">
          <div className="md:col-span-2">
            <h1 className="text-5xl leading-[1.05] tracking-tight mb-4">
              {COPY.tagline}
            </h1>
            <p
              className="text-base leading-relaxed text-stone-800"
              style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
            >
              {COPY.about}
            </p>
          </div>

          {/* Numbers — small inline figure block */}
          <aside
            className="border-l border-stone-300 pl-6"
            style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
          >
            <div className="text-[11px] uppercase tracking-[0.18em] text-stone-500 mb-2">
              In the corpus
            </div>
            <dl className="space-y-2">
              <Figure k="Datasets" v={fmtCount(s.datasets)} />
              <Figure k="Platforms" v={fmtCount(s.platforms)} />
              <Figure k="Samples" v={fmtCount(s.samples)} />
            </dl>
            <p className="text-[11px] text-stone-500 italic mt-3 leading-snug">
              {COPY.corpusBlurb}
            </p>
          </aside>
        </section>

        {/* Section pointers */}
        <section className="mt-12 border-t border-stone-300 pt-6">
          <div
            className="text-[11px] uppercase tracking-[0.18em] text-stone-500 mb-3"
            style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
          >
            Sections
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-4">
            {SURFACES.map((s) => (
              <SectionEntry key={s.label} surface={s} />
            ))}
          </div>
        </section>

        {/* Colophon */}
        <footer
          className="mt-12 border-t border-stone-300 pt-4 text-[11px] text-stone-500 leading-relaxed"
          style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
        >
          <p>
            Published by the{" "}
            <a href={COPY.links.lab} className="underline" target="_blank" rel="noreferrer">
              Pavlidis Lab
            </a>{" "}
            at the University of British Columbia. Source on{" "}
            <a href={COPY.links.github} className="underline" target="_blank" rel="noreferrer">
              GitHub
            </a>
            . Cite as: {COPY.citation}
          </p>
        </footer>
      </div>
    </div>
  );
}

function Wordmark() {
  return (
    <span className="text-3xl font-bold tracking-tight">Gemma</span>
  );
}

function Figure({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-stone-200 pb-1">
      <dt className="text-[12px] text-stone-700">{k}</dt>
      <dd className="text-xl tabular-nums text-stone-900">{v}</dd>
    </div>
  );
}

function SectionEntry({
  surface,
}: {
  surface: (typeof SURFACES)[number];
}) {
  const inner = (
    <div>
      <div className="text-xl mb-1">{surface.label}</div>
      <div
        className="text-[12px] text-stone-600 leading-snug"
        style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
      >
        {surface.blurb}
      </div>
    </div>
  );
  if (!surface.to) {
    return (
      <div className="opacity-40 cursor-not-allowed select-none">{inner}</div>
    );
  }
  return (
    <Link
      to={surface.to}
      className="block text-stone-900 hover:text-stone-600 hover:no-underline"
    >
      {inner}
    </Link>
  );
}
