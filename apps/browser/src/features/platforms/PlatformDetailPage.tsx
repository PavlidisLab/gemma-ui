/**
 * Single-platform detail page — /platforms/$shortName.
 *
 * Design intent:
 *   - One page, no tabs. The legacy ExtJS page had an Overview /
 *     Elements / Experiments tab cluster; this lays everything out
 *     inline so the curator's eye flows top-to-bottom without a tab
 *     mode-switch.
 *   - Header hero: name + identity chips (manufacturer pill, tech
 *     type, taxon, status flags) + key counts.
 *   - Description card with collapse for long Affymetrix-style prose.
 *   - Elements explorer — the section that gets the "super nice"
 *     treatment per design review. Server-side paginated (50/page) with a
 *     debounced name filter; can handle the gene-based
 *     pseudoplatforms (millions of "elements") because we never
 *     fetch them all.
 *   - Datasets link routes back to the dataset browser with this
 *     platform pre-filtered. Doesn't try to embed the dataset list
 *     here — the browser already does that.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  elementNameFilter,
  getDatasetsByPlatform,
  getElementAlignments,
  getElementGenes,
  getPlatformAnnotations,
  getPlatformByShortName,
  getPlatformElementCount,
  getPlatformElements,
} from "@/api/endpoints";
import type {
  GeneMappingSummary,
  MappedGene,
  PlatformElement,
} from "@/api/endpoints";
import { encodeSearchSettings } from "@/features/browser/shareLink";
import {
  emptySearchSettings,
  type AnnotationTerm,
  type Dataset,
  type Platform,
  type SearchSettings,
} from "@/lib/types";
import { manufacturerOf } from "./manufacturer";
import { PageMask } from "@gemma/ui";

const ELEMENTS_PAGE = 50;
const DATASETS_PAGE = 25;

export function PlatformDetailPage() {
  // TanStack Router params — typed in the route definition.
  const { shortName } = useParams({ strict: false }) as { shortName?: string };
  const name = shortName ?? "";

  const platformQ = useQuery({
    queryKey: ["platform", "byShortName", name],
    queryFn: ({ signal }) => getPlatformByShortName(name, signal),
    enabled: !!name,
  });

  if (!name) return <NotFoundStub label="Missing platform identifier." />;

  if (platformQ.isLoading) {
    return (
      <PageMask mode="region" label="Loading platform" detail={`${name}…`} />
    );
  }
  if (platformQ.isError || !platformQ.data) {
    return (
      <NotFoundStub
        label={`Platform "${name}" not found.`}
        detail={(platformQ.error as Error)?.message}
      />
    );
  }

  const p = platformQ.data;
  return (
    <div className="h-full overflow-y-auto bg-gemma-bg">
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        <Breadcrumbs name={p.shortName ?? name} />
        <Hero platform={p} />
        <DescriptionCard platform={p} />
        <AnnotationsSection platform={p} />
        {/* Two-up tables — each in its own ~24rem scrolling viewport
         *  so we don't burn vertical screen space and the curator can
         *  compare Datasets + Elements side-by-side. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <DatasetsSection platform={p} />
          <ElementsSection platform={p} />
        </div>
        <RelatedSection platform={p} />
        <MetaFooter platform={p} />
      </div>
    </div>
  );
}

function Breadcrumbs({ name }: { name: string }) {
  return (
    <nav className="text-xs text-gemma-subtle flex items-baseline gap-1.5">
      <Link to="/platforms" className="text-gemma-subtle hover:text-gemma-ink hover:no-underline">
        Platforms
      </Link>
      <span className="text-gemma-grid">/</span>
      <span className="font-mono text-gemma-ink">{name}</span>
    </nav>
  );
}

function Hero({ platform: p }: { platform: Platform }) {
  const tech = p.technologyType ?? "—";
  const taxon = p.taxon?.commonName ?? p.taxon?.scientificName ?? "—";

  // Element count. Not on the platform entity — it's the
  // ``totalElements`` of a one-row elements page, which is why it
  // arrives separately and can still be loading when the rest is drawn.
  const elementsQ = useQuery({
    queryKey: ["platform", p.id, "element-count"],
    queryFn: ({ signal }) => getPlatformElementCount(p.id, signal),
    staleTime: 60 * 60 * 1000,
  });

  // Both merge directions come off the platform itself as of
  // 2026-08-22. This used to need a `?filter=mergedInto.id=` query for
  // the mergees, and the other direction — what a mergee was folded
  // INTO — could not be answered at all.
  const mergees = p.mergees ?? [];
  const mergedInto = p.mergedInto ?? null;

  return (
    <header className="bg-white border border-gemma-grid rounded-md p-5">
      {/* shortName + manufacturer + status flags */}
      <div className="flex items-baseline gap-2 flex-wrap mb-2">
        <span className="font-mono text-xs text-gemma-subtle">
          {p.shortName ?? `#${p.id}`}
        </span>
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700">
          {manufacturerOf(p)}
        </span>
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-indigo-800">
          {tech}
        </span>
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 italic">
          {taxon}
        </span>
        {p.troubled ? (
          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-100 border border-rose-300 text-rose-800">
            troubled
          </span>
        ) : null}
        {p.isMerged ? (
          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-violet-50 border border-violet-200 text-violet-800">
            merged
          </span>
        ) : null}
        {p.isMergee ? (
          <span
            title="This platform's elements were folded into a combined platform, which is what its datasets are analyzed on."
            className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 border border-slate-300 text-slate-700"
          >
            mergee (subsumed)
          </span>
        ) : null}
      </div>

      <h1 className="text-xl font-semibold tracking-tight text-gemma-ink leading-snug">
        {p.name ?? "Untitled platform"}
      </h1>

      {/* Merge relationship, both directions named. */}
      {mergees.length > 0 ? (
        <p className="text-xs text-gemma-subtle mt-2">
          Combines{" "}
          {mergees.map((m, i) => (
            <span key={m.id}>
              {i > 0 ? ", " : ""}
              <PlatformRef target={m} />
            </span>
          ))}
          .
        </p>
      ) : mergedInto ? (
        <p className="text-xs text-gemma-subtle mt-2">
          Merged into <PlatformRef target={mergedInto} />. Datasets run on this
          array are analyzed on that one.
        </p>
      ) : null}

      {/* Quick stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
        <Stat label="Experiments" value={(p.numberOfExpressionExperiments ?? 0).toLocaleString()} />
        <Stat
          label="Elements"
          value={
            elementsQ.data !== undefined
              ? elementsQ.data.toLocaleString()
              : elementsQ.isError
                ? "—"
                : "…"
          }
          hint="probes / design elements on this platform"
        />
        {/* Gene counts are null until a report has been generated for
            this platform — null means NOT COMPUTED, so the tile is
            omitted rather than showing a zero that reads as "maps to no
            genes". Gene-list platforms derive them live and always
            answer, with no report age to show. */}
        {p.numberOfGenes != null ? (
          <Stat
            label="Genes"
            value={p.numberOfGenes.toLocaleString()}
            hint={
              (p.numberOfMappedElements != null
                ? `${p.numberOfMappedElements.toLocaleString()} elements map to a gene. `
                : "") +
              (p.geneCountsLastUpdated
                ? `Counted ${p.geneCountsLastUpdated}.`
                : "Derived from the element list, current.")
            }
          />
        ) : null}
        <Stat
          label="Switched out"
          value={(p.numberOfSwitchedExpressionExperiments ?? 0).toLocaleString()}
          hint="datasets switched off this platform to a newer/preferred one"
        />
        {p.color ? <Stat label="Channels" value={p.color} /> : <div />}
        {p.releaseVersion ? <Stat label="Version" value={p.releaseVersion} /> : <div />}
      </div>
    </header>
  );
}

/** BLAT identity and score arrive as fractions, not percentages. */
function pct(v: number): string {
  return `${(v * 100).toFixed(v >= 0.999 ? 0 : 1)}%`;
}

/** GRCh38 alt contigs carry an `_alt` / `_random` / `chrUn_` suffix.
 *  A probe with one primary hit typically also aligns to every alt
 *  contig covering the same locus, so they are the same finding
 *  repeated rather than multi-mapping. */
function isAltContig(chr: string): boolean {
  return /_alt$|_random$|^chrUn|^Un_/i.test(chr);
}

/** Primary assembly first; the alt-contig repeats after it. */
function sortAlignments(rows: GeneMappingSummary[]): GeneMappingSummary[] {
  return [...rows].sort((a, b) => {
    const ca = a.blatResult?.targetChromosomeName ?? "";
    const cb = b.blatResult?.targetChromosomeName ?? "";
    return Number(isAltContig(ca)) - Number(isAltContig(cb));
  });
}

/** A link to another platform by short name, falling back to the id
 *  when a merge partner has none. */
function PlatformRef({
  target,
}: {
  target: { id: number; shortName?: string | null };
}) {
  return (
    <Link
      to="/platforms/$shortName"
      params={{ shortName: target.shortName ?? String(target.id) }}
      className="text-gemma-accent hover:underline"
    >
      {target.shortName ?? `#${target.id}`}
    </Link>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div title={hint} className="bg-gemma-bg border border-gemma-grid rounded px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-gemma-subtle">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-gemma-ink mt-0.5">
        {value}
      </div>
    </div>
  );
}

function AnnotationsSection({ platform: p }: { platform: Platform }) {
  const annQ = useQuery({
    queryKey: ["platform", p.id, "annotations"],
    queryFn: ({ signal }) => getPlatformAnnotations(p.id, signal),
    staleTime: 5 * 60 * 1000,
  });

  if (annQ.isLoading) {
    return (
      <section className="bg-white border border-gemma-grid rounded-md p-4 text-xs text-gemma-subtle italic">
        Loading annotations…
      </section>
    );
  }
  if (annQ.isError) {
    return (
      <section className="bg-white border border-gemma-grid rounded-md p-4 text-xs text-rose-700">
        Failed to load annotations.
      </section>
    );
  }
  const terms = annQ.data ?? [];
  if (terms.length === 0) return null;

  // Group by className (ontology category).
  const groups = new Map<string, AnnotationTerm[]>();
  for (const t of terms) {
    const cat = t.className ?? "Other";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(t);
  }

  return (
    <section className="bg-white border border-gemma-grid rounded-md p-5 space-y-3">
      <div className="text-xs uppercase tracking-wide font-semibold text-gemma-subtle">
        Annotations
      </div>
      <div className="space-y-2">
        {[...groups.entries()].map(([cat, tms]) => (
          <div key={cat} className="flex flex-wrap items-baseline gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-gemma-subtle mr-0.5 shrink-0">
              {cat}
            </span>
            {tms.map((t) => (
              <span
                key={t.termUri ?? t.termName}
                title={t.termUri ?? undefined}
                className="text-[11px] px-1.5 py-0.5 rounded-full bg-sky-50 border border-sky-200 text-sky-800"
              >
                {t.termName ?? t.termUri ?? "?"}
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function DescriptionCard({ platform: p }: { platform: Platform }) {
  const [expanded, setExpanded] = useState(false);
  if (!p.description) {
    return (
      <section className="bg-white border border-gemma-grid rounded-md p-5 text-sm text-gemma-subtle italic">
        No description recorded.
      </section>
    );
  }
  const long = p.description.length > 600;
  const shown = expanded || !long ? p.description : p.description.slice(0, 600) + "…";
  return (
    <section className="bg-white border border-gemma-grid rounded-md p-5 space-y-2">
      <div className="text-xs uppercase tracking-wide font-semibold text-gemma-subtle">
        Description
      </div>
      <p className="text-sm text-gemma-ink leading-relaxed whitespace-pre-wrap">
        {shown}
      </p>
      {long ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-gemma-accent hover:underline"
        >
          {expanded ? "Show less" : "Show full description"}
        </button>
      ) : null}
    </section>
  );
}

/** Elements explorer — server-side paginated probe list with a
 *  debounced name filter. Designed so it never loads more than 50
 *  rows at a time, which keeps gene-based pseudoplatforms
 *  (potentially millions of elements) responsive. */
function ElementsSection({ platform: p }: { platform: Platform }) {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  // Probe-name and gene search are separate server-side questions
  // (`filter=name like …` vs `gene=`), so the visitor picks which one
  // they're asking rather than us guessing from the string.
  const [mode, setMode] = useState<"probe" | "gene">("probe");

  // 250ms debounce — fast enough to feel live, slow enough to avoid
  // bursts of fetches on every keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  // Reset to page 0 whenever the search changes — otherwise filtering
  // can land on an offset past the new totalElements.
  useEffect(() => {
    setPage(0);
  }, [debounced, mode]);

  const elementsQ = useQuery({
    queryKey: ["platform", p.id, "elements", mode, debounced, page],
    queryFn: ({ signal }) =>
      getPlatformElements(
        p.id,
        {
          offset: page * ELEMENTS_PAGE,
          limit: ELEMENTS_PAGE,
          query: mode === "probe" ? debounced || undefined : undefined,
          gene: mode === "gene" ? debounced || undefined : undefined,
        },
        signal,
      ),
    placeholderData: keepPreviousData,
  });

  // Probe search is prefix-only and cannot carry an underscore, so a
  // full probe name is cut back to its first segment. Say so, rather
  // than quietly returning a superset of what was typed.
  const nameSearch =
    mode === "probe" && debounced ? elementNameFilter(debounced) : null;

  const total = elementsQ.data?.totalElements ?? null;
  const totalPages = total !== null ? Math.max(1, Math.ceil(total / ELEMENTS_PAGE)) : null;
  const rows = elementsQ.data?.data ?? [];
  const showingFrom = total === 0 ? 0 : page * ELEMENTS_PAGE + 1;
  const showingTo = Math.min(showingFrom + rows.length - 1, total ?? 0);

  return (
    <section className="bg-white border border-gemma-grid rounded-md flex flex-col h-96">
      <header className="px-3 py-2 border-b border-gemma-grid flex items-baseline gap-2 flex-wrap shrink-0">
        <h2 className="text-xs font-semibold text-gemma-ink uppercase tracking-wide">
          Elements
        </h2>
        <span className="text-[11px] text-gemma-subtle tabular-nums">
          {total !== null ? total.toLocaleString() : "…"}
          {debounced ? (
            <>
              {" · "}
              {/* Say what was actually searched. A name search cut back
                  to its prefix returns more than was typed, and the
                  count beside the query is what makes that visible. */}
              &quot;{nameSearch?.truncated ? nameSearch.prefix : debounced}
              &quot;
              {nameSearch?.truncated ? (
                <span
                  className="not-italic"
                  title={`"${debounced}" was searched as "${nameSearch.prefix}" — the API cannot match a probe name containing an underscore.`}
                >
                  {" "}
                  (prefix)
                </span>
              ) : null}
            </>
          ) : (
            ""
          )}
        </span>
        <div className="ml-auto flex items-baseline gap-1">
          <div className="flex rounded border border-gemma-grid overflow-hidden">
            {(["probe", "gene"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={
                  "text-[10px] px-1.5 py-0.5 " +
                  (mode === m
                    ? "bg-gemma-accent text-white"
                    : "bg-white text-gemma-subtle hover:text-gemma-ink")
                }
              >
                {m}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={mode === "probe" ? "probe name…" : "gene symbol…"}
            title={
              mode === "probe"
                ? "Matches the START of a probe name. The API's `like` is prefix-only and cannot carry an underscore, so a full name such as 1007_s_at is searched as 1007."
                : "Official symbol, alias, older symbol or NCBI id. Resolved against this platform's taxon; returns the probes for the best-matching gene."
            }
            className="text-[11px] px-1.5 py-0.5 rounded border border-gemma-grid focus:outline-none focus:ring-1 focus:ring-gemma-accent/50 focus:border-gemma-accent w-36"
          />
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-[11px] border-collapse">
          <thead className="bg-gemma-bg text-[10px] uppercase tracking-wide text-gemma-subtle sticky top-0 z-10">
            <tr>
              <th className="px-1 py-1 w-5"></th>
              <th className="text-left px-2 py-1 font-medium w-40">Probe</th>
              <th className="text-left px-2 py-1 font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !elementsQ.isLoading ? (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-[11px] text-gemma-subtle italic">
                  No probes match.
                </td>
              </tr>
            ) : null}
            {rows.map((el) => (
              <ElementRow
                key={el.id}
                element={el}
                platformId={p.id}
              />
            ))}
          </tbody>
        </table>
      </div>

      {totalPages !== null && totalPages > 1 ? (
        <footer className="px-3 py-1.5 border-t border-gemma-grid flex items-baseline justify-between text-[10px] text-gemma-subtle shrink-0">
          <span className="tabular-nums">
            {showingFrom.toLocaleString()}–{showingTo.toLocaleString()} of{" "}
            {total!.toLocaleString()}
          </span>
          <div className="flex items-center gap-1.5">
            <PagerButton
              disabled={page === 0 || elementsQ.isFetching}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              ←
            </PagerButton>
            <span className="tabular-nums">
              {page + 1}/{totalPages}
            </span>
            <PagerButton
              disabled={page + 1 >= totalPages || elementsQ.isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              →
            </PagerButton>
          </div>
        </footer>
      ) : null}
    </section>
  );
}

function PagerButton({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-1.5 py-0 rounded border border-gemma-grid bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gemma-bg text-gemma-ink text-[11px] leading-tight"
    >
      {children}
    </button>
  );
}

/** Expandable element row — click chevron to reveal:
 *    - Gene mappings (LIVE — fetched on demand from
 *      /platforms/{id}/elements/{eid}/genes)
 *    - Probe sequence (MOCK — backend doesn't expose; see TODO in
 *      endpoints.ts)
 *    - Genome alignment (MOCK — same reason)
 *
 *  Mocks are clearly badged ``stub`` so curators don't mistake the
 *  generated values for real data. */
function ElementRow({
  element: el,
  platformId,
}: {
  element: PlatformElement;
  platformId: number;
}) {
  const [open, setOpen] = useState(false);
  const genesQ = useQuery({
    queryKey: ["platform", platformId, "element", el.id, "genes"],
    queryFn: ({ signal }) => getElementGenes(platformId, el.id, signal),
    enabled: open,
    staleTime: Infinity,
  });
  return (
    <>
      <tr
        className="border-t border-gemma-grid hover:bg-gemma-bg/60 cursor-pointer"
        onClick={() => setOpen((v) => !v)}
      >
        <td className="px-1 py-1 text-gemma-subtle text-[10px] text-center select-none">
          {open ? "▾" : "▸"}
        </td>
        <td className="px-2 py-1 font-mono text-[10px] text-gemma-ink whitespace-nowrap">
          {el.name}
        </td>
        <td className="px-2 py-1 text-[11px] text-gemma-subtle leading-snug">
          {/* Genes ride down with the page (`withGenes`), so the row can
              say what it maps to without opening. `[]` is a real answer
              — "maps to no gene" — and is drawn differently from the
              field being absent. */}
          {el.genes?.length ? (
            <span className="mr-1.5 inline-flex gap-1 align-baseline">
              {el.genes.slice(0, 3).map((g) => (
                <span
                  key={g.id}
                  className="font-mono text-[10px] text-gemma-ink"
                  title={g.ncbiId ? `NCBI:${g.ncbiId}` : undefined}
                >
                  {g.officialSymbol ?? `#${g.id}`}
                </span>
              ))}
              {el.genes.length > 3 ? (
                <span className="text-[10px] text-gemma-subtle">
                  +{el.genes.length - 3}
                </span>
              ) : null}
            </span>
          ) : null}
          {el.description ? (
            <span className="text-gemma-ink line-clamp-1">{el.description}</span>
          ) : !el.genes?.length ? (
            <span className="italic">—</span>
          ) : null}
        </td>
      </tr>
      {open ? (
        <tr className="border-t border-gemma-grid bg-gemma-bg/40">
          <td></td>
          <td colSpan={2} className="px-2 py-2 space-y-2">
            <GeneMappings genesQ={genesQ} />
            <ProbeSequence
              sequence={el.sequence}
              sequenceLength={el.sequenceLength}
            />
            <GenomeAlignment
              platformId={platformId}
              elementId={el.id}
              enabled={open}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function GeneMappings({
  genesQ,
}: {
  genesQ: { data?: MappedGene[]; isLoading: boolean; isError: boolean };
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-gemma-subtle mb-1">
        Gene mappings
      </div>
      {genesQ.isLoading ? (
        <div className="text-[11px] text-gemma-subtle italic">loading…</div>
      ) : genesQ.isError ? (
        <div className="text-[11px] text-rose-700">failed to load</div>
      ) : (genesQ.data?.length ?? 0) === 0 ? (
        <div className="text-[11px] text-gemma-subtle italic">
          no gene mapping — likely a control / housekeeping probe
        </div>
      ) : (
        <ul className="space-y-0.5">
          {genesQ.data!.map((g) => (
            <li key={g.id} className="flex items-baseline gap-1.5 text-[11px]">
              <span className="font-mono font-semibold text-gemma-ink">
                {g.officialSymbol ?? "—"}
              </span>
              <span className="text-gemma-subtle italic line-clamp-1">
                {g.officialName ?? ""}
              </span>
              <span className="ml-auto inline-flex gap-1 shrink-0">
                {g.ncbiId ? (
                  <a
                    href={`https://www.ncbi.nlm.nih.gov/gene/${g.ncbiId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-gemma-accent hover:underline font-mono"
                  >
                    NCBI:{g.ncbiId}
                  </a>
                ) : null}
                {g.ensemblId ? (
                  <a
                    href={`https://www.ensembl.org/Gene/Summary?g=${g.ensemblId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-gemma-accent hover:underline font-mono"
                  >
                    {g.ensemblId}
                  </a>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Probe oligonucleotide sequence — real, and free: it rides down with
 *  the elements page (`withSequence`), so opening a row costs nothing.
 *
 *  This used to render a deterministic 60-mer generated from the probe
 *  name under a `stub` badge, because REST carried no sequence. It does
 *  now. Every base below is the platform's. */
function ProbeSequence({
  sequence,
  sequenceLength,
}: {
  sequence?: string | null;
  sequenceLength?: number | null;
}) {
  if (!sequence) {
    return (
      <div>
        <div className="text-[10px] uppercase tracking-wide text-gemma-subtle mb-1">
          Sequence
        </div>
        <div className="text-[11px] text-gemma-subtle italic">
          none recorded for this element
        </div>
      </div>
    );
  }
  // `sequenceLength` is the full length of the biological sequence; the
  // string itself can be shorter. Say which number is which rather than
  // printing one and implying the other.
  const shown = sequence.length;
  const full = sequenceLength ?? shown;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-gemma-subtle mb-1">
        Sequence · {full.toLocaleString()}bp
        {shown < full ? ` · first ${shown.toLocaleString()} shown` : ""}
      </div>
      <code className="text-[10px] text-gemma-ink font-mono break-all leading-tight">
        {sequence}
      </code>
    </div>
  );
}

/** Genome alignment — the real BLAT summary.
 *
 *  Live since 2026-08-22. It had rendered a hash of the element id
 *  dressed as coordinates, then said "not published by the API" for a
 *  few hours, because the field was serialized away behind
 *  `@JsonIgnore` on the value object — the query had been running and
 *  its result discarded on the way out.
 *
 *  `identity` and `score` are fractions, shown as percentages. A probe
 *  on the primary assembly typically reports several alignments that
 *  are the same locus on alt contigs (`6_GL000253v2_alt`), so the
 *  primary-assembly ones sort first and the rest are marked. */
function GenomeAlignment({
  platformId,
  elementId,
  enabled,
}: {
  platformId: number;
  elementId: number;
  enabled: boolean;
}) {
  const q = useQuery({
    queryKey: ["platform", platformId, "element", elementId, "alignments"],
    queryFn: ({ signal }) => getElementAlignments(platformId, elementId, signal),
    enabled,
    staleTime: Infinity,
  });
  const rows = q.data ?? [];
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-gemma-subtle mb-1">
        Genome alignment
      </div>
      {q.isLoading ? (
        <div className="text-[11px] text-gemma-subtle italic">loading…</div>
      ) : q.isError ? (
        <div className="text-[11px] text-rose-700 italic">
          couldn't load alignments
        </div>
      ) : rows.length === 0 ? (
        <div className="text-[11px] text-gemma-subtle italic">
          no alignments recorded
        </div>
      ) : (
        <ul className="space-y-0.5">
          {sortAlignments(rows).map((r, i) => {
            const b = r.blatResult ?? {};
            const chr = b.targetChromosomeName;
            const start = b.targetStart;
            const end = b.targetEnd;
            return (
              <li key={i} className="text-[11px] text-gemma-ink font-mono">
                {chr && start != null && end != null ? (
                  <>
                    {chr}:{start.toLocaleString()}-{end.toLocaleString()}
                    {b.strand ? (
                      <span className="text-gemma-subtle"> ({b.strand})</span>
                    ) : null}
                    {isAltContig(chr) ? (
                      <span
                        className="ml-1 text-[9px] text-gemma-subtle not-italic"
                        title="An alternate contig — usually the same locus as the primary-assembly hit above, not a second place the probe lands."
                      >
                        alt
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-gemma-subtle italic">
                    alignment without coordinates
                  </span>
                )}
                {b.identity != null || b.score != null ? (
                  <span className="ml-2 text-[10px] text-gemma-subtle">
                    {b.identity != null ? `${pct(b.identity)} identity` : ""}
                    {b.identity != null && b.score != null ? " · " : ""}
                    {b.score != null ? `score ${pct(b.score)}` : ""}
                  </span>
                ) : null}
                {r.genes?.length ? (
                  <span className="ml-2 text-[10px] text-gemma-subtle">
                    → {r.genes.map((g) => g.officialSymbol ?? "?").join(", ")}
                  </span>
                ) : (
                  <span
                    className="ml-2 text-[10px] text-gemma-subtle italic"
                    title="The probe aligns here but the alignment supports no gene — a real result, not a missing one."
                  >
                    no gene
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Inline paginated datasets-on-this-platform table. Same shape as
 *  ElementsSection but smaller page (25 rows) since dataset rows
 *  carry more text. Server-side paged so this stays fast even on
 *  gene-based pseudoplatforms with thousands of experiments
 *  (the reviewer, 2026-05-17 — the legacy Datasets tab on the platform
 *  page can hang badly in that case). */
function DatasetsSection({ platform: p }: { platform: Platform }) {
  const [page, setPage] = useState(0);
  const shortName = p.shortName ?? "";

  const dsQ = useQuery({
    queryKey: ["platform", p.id, "datasets", page],
    queryFn: ({ signal }) =>
      getDatasetsByPlatform(
        shortName,
        { offset: page * DATASETS_PAGE, limit: DATASETS_PAGE },
        signal,
      ),
    enabled: !!shortName,
    placeholderData: keepPreviousData,
  });

  const total = dsQ.data?.totalElements ?? null;
  const rows = dsQ.data?.data ?? [];
  const totalPages = total !== null ? Math.max(1, Math.ceil(total / DATASETS_PAGE)) : null;
  const showingFrom = total === 0 ? 0 : page * DATASETS_PAGE + 1;
  const showingTo = Math.min(showingFrom + rows.length - 1, total ?? 0);

  return (
    <section className="bg-white border border-gemma-grid rounded-md flex flex-col h-96">
      <header className="px-3 py-2 border-b border-gemma-grid flex items-baseline gap-2 flex-wrap shrink-0">
        <h2 className="text-xs font-semibold text-gemma-ink uppercase tracking-wide">
          Datasets
        </h2>
        <span className="text-[11px] text-gemma-subtle tabular-nums">
          {total !== null ? total.toLocaleString() : "…"}
        </span>
        <Link
          to="/browser"
          // `?s=` — the same encoded-settings param a shared link uses,
          // and the only channel the Browser reads a platform from
          // (`useUrlInitial` knows sort, updatedSince, categoryUri,
          // annotationUri, taxon and s — nothing named `platforms`).
          // This used to pass `{ platforms: shortName }`, which landed
          // as `?platforms=GPL96`, was read by nobody, and opened the
          // Browser unfiltered. The `as never` on the old call is why
          // the compiler never said so.
          //
          // Ids only, matching `decodeSearchSettings` — the platform
          // selector matches on id and supplies its own label.
          search={
            {
              s: encodeSearchSettings({
                ...emptySearchSettings(),
                platforms: [{ id: p.id }] as SearchSettings["platforms"],
              }),
            } as never
          }
          className="ml-auto text-[11px] text-gemma-accent hover:underline"
        >
          open in browser →
        </Link>
      </header>

      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-[11px] border-collapse">
          <thead className="bg-gemma-bg text-[10px] uppercase tracking-wide text-gemma-subtle sticky top-0 z-10">
            <tr>
              <th className="text-left px-2 py-1 font-medium w-20">Accession</th>
              <th className="text-left px-2 py-1 font-medium">Title</th>
              <th className="text-right px-2 py-1 font-medium w-12 tabular-nums">N</th>
              <th className="text-left px-2 py-1 font-medium w-20">Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !dsQ.isLoading ? (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-[11px] text-gemma-subtle italic">
                  No datasets on this platform.
                </td>
              </tr>
            ) : null}
            {rows.map((d) => (
              <DatasetRow key={d.id} dataset={d} />
            ))}
          </tbody>
        </table>
      </div>

      {totalPages !== null && totalPages > 1 ? (
        <footer className="px-3 py-1.5 border-t border-gemma-grid flex items-baseline justify-between text-[10px] text-gemma-subtle shrink-0">
          <span className="tabular-nums">
            {showingFrom.toLocaleString()}–{showingTo.toLocaleString()} of{" "}
            {total!.toLocaleString()}
          </span>
          <div className="flex items-center gap-1.5">
            <PagerButton
              disabled={page === 0 || dsQ.isFetching}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              ←
            </PagerButton>
            <span className="tabular-nums">
              {page + 1}/{totalPages}
            </span>
            <PagerButton
              disabled={page + 1 >= totalPages || dsQ.isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              →
            </PagerButton>
          </div>
        </footer>
      ) : null}
    </section>
  );
}

function DatasetRow({ dataset: d }: { dataset: Dataset }) {
  return (
    <tr className="border-t border-gemma-grid hover:bg-gemma-bg/60">
      <td className="px-2 py-1 font-mono text-[10px] text-gemma-ink whitespace-nowrap">
        {d.shortName}
      </td>
      <td className="px-2 py-1 text-[11px] text-gemma-ink leading-snug">
        <span className="line-clamp-1">{d.name}</span>
      </td>
      <td className="px-2 py-1 text-right text-[11px] text-gemma-ink tabular-nums">
        {d.numberOfBioAssays.toLocaleString()}
      </td>
      <td className="px-2 py-1 text-[10px] text-gemma-subtle whitespace-nowrap">
        {d.lastUpdated
          ? new Date(d.lastUpdated).toLocaleDateString(undefined, {
              month: "short",
              year: "2-digit",
            })
          : "—"}
      </td>
    </tr>
  );
}

function RelatedSection({ platform: p }: { platform: Platform }) {
  const hasReleaseUrl = !!p.releaseUrl;
  const hasExternal = (p.externalReferences?.length ?? 0) > 0;
  if (!hasReleaseUrl && !hasExternal) return null;
  return (
    <section className="bg-white border border-gemma-grid rounded-md p-5 space-y-3">
      <div className="text-xs uppercase tracking-wide font-semibold text-gemma-subtle">
        Related
      </div>
      <ul className="space-y-2 text-sm">
        {hasReleaseUrl ? (
          <li>
            <a
              href={p.releaseUrl!}
              target="_blank"
              rel="noreferrer"
              className="text-gemma-accent hover:underline"
            >
              Manufacturer release page ↗
            </a>
          </li>
        ) : null}
        {hasExternal
          ? p.externalReferences!.map((ref, i) => (
              <li key={i} className="text-xs text-gemma-subtle">
                External: <span className="font-mono">{ref.externalDatabase?.name ?? "?"}:{ref.accession ?? "—"}</span>
              </li>
            ))
          : null}
      </ul>
    </section>
  );
}

function MetaFooter({ platform: p }: { platform: Platform }) {
  return (
    <footer className="text-xs text-gemma-subtle space-y-1">
      {p.curationNote ? (
        <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-amber-900">
          <span className="font-semibold">Curator note:</span> {p.curationNote}
        </div>
      ) : null}
      <div>
        Gemma internal id #{p.id}{" · "}
        Last updated{" "}
        {p.lastUpdated
          ? new Date(p.lastUpdated).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })
          : "—"}
      </div>
    </footer>
  );
}

function NotFoundStub({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="h-full overflow-y-auto bg-gemma-bg">
      <div className="max-w-5xl mx-auto px-6 py-12 text-center space-y-2">
        <h1 className="text-lg font-semibold text-gemma-ink">{label}</h1>
        {detail ? <p className="text-xs text-gemma-subtle">{detail}</p> : null}
        <Link to="/platforms" className="text-sm text-gemma-accent hover:underline">
          ← Back to all platforms
        </Link>
      </div>
    </div>
  );
}

// `useMemo` kept around in case future fields need derived values.
void useMemo;
