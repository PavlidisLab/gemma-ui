/**
 * Terminal / catalog variant — monospace, dense, command-line aesthetic.
 *
 * Design intent:
 *   - Pure monospace from masthead down. No imagery, no rounded
 *     corners, no shadow.
 *   - Brackets, slashes, and pipes as the only ornamentation.
 *   - Two color tokens: foreground / muted. Optional accent for one
 *     interactive element.
 *   - The page reads like `ls -la /gemma`. Comfortable for a
 *     bioinformatics audience; alienating for everyone else (that's
 *     the design choice to evaluate).
 */

import { Link } from "@tanstack/react-router";
import { COPY, SURFACES } from "../copy";
import { useGemmaSummary, fmtCount } from "../useGemmaSummary";

const MONO = '"JetBrains Mono", "SF Mono", Menlo, ui-monospace, monospace';

export function HomeTerminal() {
  const s = useGemmaSummary();
  return (
    <div
      className="h-full overflow-y-auto bg-stone-50 text-stone-900"
      style={{ fontFamily: MONO }}
    >
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Masthead — like a shell banner */}
        <pre className="text-xs leading-tight text-stone-500 mb-4 whitespace-pre">{`
:: gemma  ─────  curated gene expression  ─────  v1
`}</pre>

        <header className="flex items-baseline justify-between border-b border-stone-300 pb-2 mb-6">
          <div className="text-2xl font-bold tracking-tight">gemma</div>
          <div className="text-xs text-stone-500">
            {new Date().toISOString().slice(0, 10)}
          </div>
        </header>

        {/* About */}
        <section className="mb-8">
          <div className="text-xs text-stone-500 mb-1">// about</div>
          <p className="text-sm leading-relaxed text-stone-800 max-w-2xl">
            {COPY.tagline}
          </p>
          <p className="text-sm leading-relaxed text-stone-700 max-w-2xl mt-2">
            {COPY.about}
          </p>
        </section>

        {/* Counts as a key=value block */}
        <section className="mb-8">
          <div className="text-xs text-stone-500 mb-1">// stats</div>
          <pre className="text-sm text-stone-900 leading-relaxed whitespace-pre">{`datasets   = ${pad(fmtCount(s.datasets), 10)}
platforms  = ${pad(fmtCount(s.platforms), 10)}
samples    = ${pad(fmtCount(s.samples), 10)}
`}</pre>
        </section>

        {/* Surfaces as a `ls` listing */}
        <section className="mb-8">
          <div className="text-xs text-stone-500 mb-1">// surfaces</div>
          <ul className="text-sm">
            {SURFACES.map((surf) => (
              <li key={surf.label} className="leading-relaxed">
                {surf.to ? (
                  <Link
                    to={surf.to}
                    className="text-stone-900 hover:text-emerald-700 hover:no-underline"
                  >
                    <span className="text-stone-500">└─ </span>
                    <span className="text-emerald-700">{surf.label.toLowerCase()}</span>
                    <span className="text-stone-500">  →  {surf.blurb}</span>
                  </Link>
                ) : (
                  <span className="text-stone-400">
                    <span className="text-stone-400">└─ </span>
                    <span className="line-through">{surf.label.toLowerCase()}</span>
                    <span>  →  (not built yet) {surf.blurb}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* Links */}
        <section className="mb-8">
          <div className="text-xs text-stone-500 mb-1">// clients</div>
          <ul className="text-sm space-y-0.5">
            <LinkRow href={COPY.links.rest} label="REST API" />
            <LinkRow href={COPY.links.docs} label="docs" />
            <LinkRow href={COPY.links.rClient} label="gemma.R (R)" />
            <LinkRow href={COPY.links.pyClient} label="gemmapy (python)" />
            <LinkRow href={COPY.links.github} label="github" />
          </ul>
        </section>

        {/* Citation */}
        <footer className="border-t border-stone-300 pt-3 text-xs text-stone-500 leading-relaxed">
          <div className="mb-1">// cite</div>
          <div className="text-stone-700">{COPY.citation}</div>
        </footer>
      </div>
    </div>
  );
}

function pad(s: string, w: number): string {
  return s.padStart(w, " ");
}

function LinkRow({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-stone-900 hover:text-emerald-700 hover:no-underline"
      >
        <span className="text-stone-500">$ open </span>
        <span className="text-emerald-700">{label}</span>
        <span className="text-stone-400 ml-2">{shorten(href)}</span>
      </a>
    </li>
  );
}

function shorten(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
