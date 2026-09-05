// Per-gene page — /gene/ncbi/$ncbiId
// Endpoints: /rest/v2/genes/{ncbiId} · /locations · /homologues · /goTerms · /overview
//
// Every sub-resource is keyed by the NCBI id, NOT gene.id. Gemma's
// internal id looks like an id and is right there on the payload, but
// /genes/{gene} resolves a bare number as an NCBI gene id — TP53's
// internal 162841 404s with "recognised to be 'ncbiGeneId'", while 7157
// answers. Pass `gene.ncbiId` (falling back to the route param), never
// `gene.id`.
//
// The page is keyed by NCBI gene id (not symbol): symbols collide across
// taxa, so the URL carries an unambiguous NCBI id. Symbol/name resolution
// happens upstream at search time (see GenesPage / resolveGeneNcbiId), and
// legacy /gene/$id links redirect here via GeneRedirect.
//
// Differential expression section is on hold pending the heavy gene-page
// rework — placeholder for now (see GENE_PAGE_REWORK_RECCE.md once it lands).

import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  getGene,
  getGeneLocations,
  getGeneGoTerms,
  getGeneHomologues,
  getGeneOverview,
  geneLocationRange,
  formatMultifunctionalityRank,
} from "@/api/endpoints";
import type { Gene, GeneLocation } from "@/api/endpoints";
import { GEMMA_1_LABEL, useGemma1Url } from "@/features/shared/gemma1";
import { PageMask } from "@gemma/ui";

export function GenePage() {
  const { ncbiId } = useParams({ from: "/gene/ncbi/$ncbiId" });

  const geneQ = useQuery({
    queryKey: ["gene", "ncbi", ncbiId],
    queryFn: ({ signal }) => getGene(ncbiId, signal),
    enabled: !!ncbiId,
  });

  if (geneQ.isLoading) {
    return <PageMask mode="region" label="Loading gene" detail={`NCBI ${ncbiId}…`} />;
  }

  if (geneQ.isError || !geneQ.data) {
    return (
      <div className="h-full overflow-y-auto bg-gemma-bg">
        <div className="max-w-4xl mx-auto px-6 py-12 text-center space-y-2">
          <h1 className="text-lg font-semibold text-gemma-ink">
            Gene not found.
          </h1>
          <p className="text-xs text-gemma-subtle">
            {(geneQ.error as Error)?.message ??
              `No gene matched NCBI id ${ncbiId}.`}
          </p>
        </div>
      </div>
    );
  }

  const gene = geneQ.data;
  // The sub-resource key. `gene.ncbiId` is the payload's own answer;
  // the route param is the same id and covers a row that somehow omits
  // it (the route only ever carries an NCBI id).
  const geneKey = gene.ncbiId ?? ncbiId;

  return (
    <div className="h-full overflow-y-auto bg-gemma-bg">
      <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
        <Breadcrumbs gene={gene} />
        <GeneHero gene={gene} />
        <LocationsSection geneKey={geneKey} />
        <HomologuesSection geneKey={geneKey} gene={gene} />
        <FunctionSection geneKey={geneKey} />
        <DiffExComingSoonSection />
      </div>
    </div>
  );
}

function Breadcrumbs({ gene }: { gene: Gene }) {
  return (
    <nav className="text-xs text-gemma-subtle flex items-baseline gap-1.5">
      <span>Genes</span>
      <span className="text-gemma-grid">/</span>
      <span className="font-mono text-gemma-ink">
        {gene.officialSymbol ?? `#${gene.id}`}
      </span>
    </nav>
  );
}

function GeneHero({ gene }: { gene: Gene }) {
  const gemma1 = useGemma1Url(`/gene/showGene.html?id=${gene.id}`);
  const taxon = gene.taxon?.commonName ?? gene.taxon?.scientificName ?? "—";
  return (
    <header className="bg-white border border-gemma-grid rounded-md p-5">
      <div className="flex items-baseline gap-2 flex-wrap mb-2">
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 italic">
          {taxon}
        </span>
        {gene.aliases && gene.aliases.length > 0 ? (
          <span
            className="text-[10px] text-gemma-subtle"
            title={gene.aliases.join(", ")}
          >
            aliases: {gene.aliases.slice(0, 4).join(", ")}
            {gene.aliases.length > 4 ? ` +${gene.aliases.length - 4}` : ""}
          </span>
        ) : null}
      </div>

      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-2xl font-bold font-mono tracking-tight text-gemma-ink">
          {gene.officialSymbol ?? "—"}
        </h1>
        <span className="text-base text-gemma-subtle">
          {gene.officialName ?? ""}
        </span>
      </div>

      {gene.description ? (
        <p className="mt-2 text-sm text-gemma-ink leading-relaxed">
          {gene.description}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 mt-4">
        {gene.ncbiId ? (
          <ExternalLink
            href={`https://www.ncbi.nlm.nih.gov/gene/${gene.ncbiId}`}
            label={`NCBI Gene: ${gene.ncbiId}`}
          />
        ) : null}
        {gene.ensemblId ? (
          <ExternalLink
            href={`https://www.ensembl.org/Gene/Summary?g=${gene.ensemblId}`}
            label={`Ensembl: ${gene.ensemblId}`}
          />
        ) : null}
        {gemma1 ? <ExternalLink href={gemma1} label={GEMMA_1_LABEL} /> : null}
      </div>
    </header>
  );
}

function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-[11px] px-2 py-1 rounded border border-gemma-grid bg-gemma-bg text-gemma-accent hover:border-gemma-accent/60 hover:bg-white transition-colors font-mono"
    >
      {label} ↗
    </a>
  );
}

function LocationsSection({ geneKey }: { geneKey: number | string }) {
  const locQ = useQuery({
    queryKey: ["gene", geneKey, "locations"],
    queryFn: ({ signal }) => getGeneLocations(geneKey, signal),
    staleTime: Infinity,
  });

  const locs = locQ.data ?? [];
  if (!locQ.isLoading && locs.length === 0) return null;

  return (
    <section className="bg-white border border-gemma-grid rounded-md p-5 space-y-2">
      <div className="text-xs uppercase tracking-wide font-semibold text-gemma-subtle">
        Genomic location
      </div>
      {locQ.isLoading ? (
        <div className="text-xs text-gemma-subtle italic">Loading…</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {locs.map((loc, i) => (
            <LocationChip key={i} loc={loc} />
          ))}
        </div>
      )}
    </section>
  );
}

function LocationChip({ loc }: { loc: GeneLocation }) {
  if (!loc.chromosome) return null;
  const taxon = loc.taxon?.commonName ?? loc.taxon?.scientificName ?? "";
  // start + length, not start + end — see GeneLocation.
  const range = geneLocationRange(loc);
  const start = range.start?.toLocaleString() ?? "?";
  const end = range.end?.toLocaleString() ?? "?";
  const strand = loc.strand ?? "?";
  return (
    <span className="text-[11px] font-mono px-2 py-1 rounded bg-slate-50 border border-slate-200 text-slate-800">
      {taxon ? <span className="text-gemma-subtle mr-1 italic">{taxon}</span> : null}
      {loc.chromosome}:{start}–{end}{" "}
      <span className="text-gemma-subtle">({strand})</span>
    </span>
  );
}

// ─── Homologues — /genes/{ncbiId}/homologues ─────────────────────────────────
//
// The homologene-backed view of the same gene in other taxa, mirroring
// the legacy gene page's "Homologues" row.
//
// The section stays visible on an empty result instead of unmounting,
// because empty is deployment-dependent rather than gene-dependent:
// staging-gemma serves TP53's mouse and rat homologues while gemma2
// returns `{"data":[]}` for every gene (2026-09-04). A hide-when-empty
// section would silently vanish across a whole backend and read as an
// unbuilt feature; the empty copy names the gene so it reads as an
// unloaded dataset instead.

function HomologuesSection({
  geneKey,
  gene,
}: {
  geneKey: number | string;
  gene: Gene;
}) {
  const homQ = useQuery({
    queryKey: ["gene", geneKey, "homologues"],
    queryFn: ({ signal }) => getGeneHomologues(geneKey, signal),
    staleTime: Infinity,
  });

  const homologues = homQ.data ?? [];
  const symbol = gene.officialSymbol ?? `NCBI ${geneKey}`;

  return (
    <section className="bg-white border border-gemma-grid rounded-md p-5 space-y-3">
      <div className="text-xs uppercase tracking-wide font-semibold text-gemma-subtle">
        Homologues{homologues.length > 0 ? ` (${homologues.length})` : ""}
      </div>

      {homQ.isLoading ? (
        <div className="text-xs text-gemma-subtle italic">Loading…</div>
      ) : homQ.isError ? (
        <div className="text-xs text-rose-700">
          Couldn't load homologues — {(homQ.error as Error)?.message ?? "request failed"}.
        </div>
      ) : homologues.length === 0 ? (
        <div className="text-sm text-gemma-subtle italic">
          No homologues recorded for {symbol}.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {homologues.map((h) => (
            <HomologueChip key={h.ncbiId ?? h.id} homologue={h} />
          ))}
        </div>
      )}
    </section>
  );
}

function HomologueChip({ homologue }: { homologue: Gene }) {
  const taxon =
    homologue.taxon?.commonName ?? homologue.taxon?.scientificName ?? "";
  const symbol = homologue.officialSymbol ?? `#${homologue.id}`;
  const title = [homologue.officialName, taxon ? `(${taxon})` : null]
    .filter(Boolean)
    .join(" ");

  const body = (
    <>
      {taxon ? (
        <span className="text-gemma-subtle mr-1.5 italic">{taxon}</span>
      ) : null}
      <span className="font-mono font-semibold">{symbol}</span>
    </>
  );

  // Without an NCBI id there is no gene page to point at — the route is
  // keyed by that id and nothing else resolves it.
  if (homologue.ncbiId == null) {
    return (
      <span
        title={title || undefined}
        className="text-[11px] px-2 py-1 rounded bg-slate-50 border border-slate-200 text-slate-800"
      >
        {body}
      </span>
    );
  }

  return (
    <Link
      to="/gene/ncbi/$ncbiId"
      params={{ ncbiId: String(homologue.ncbiId) }}
      title={title || "Open this gene's page"}
      className="text-[11px] px-2 py-1 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 hover:border-emerald-400 transition-colors"
    >
      {body}
    </Link>
  );
}

// ─── Function — /genes/{ncbiId}/goTerms (counted) + /overview ────────────────
//
// A COUNT, not a term list. Mirrors the "Functions" row on the legacy
// gene page (gemma.msl.ubc.ca/gene/showGene.html?id=162841), which
// reads "224 GO Terms; Overall multifunctionality 1.00" — one line,
// no chips.
//
// ⚠️ The count here will NOT match the legacy page's. Every REST
// deployment returns 678 GO terms for TP53 (measured 2026-09-04 on
// gemma2, on staging-gemma, and on the v1 host's own /rest/v2), while
// the legacy page prints 224 for the same gene — the page counts a
// narrower set than the endpoint serves (the endpoint looks to include
// the propagated parent terms). This renders what the endpoint
// returns; the gap is a question for the backend, not something to
// paper over client-side by inventing a filter.
//
// Two queries because neither endpoint alone answers the row:
// /overview carries `multifunctionalityRank` but no GO count, and
// /goTerms carries the terms but no rank. There is no goTerms/count
// endpoint, so the count costs a full 678-row fetch.

function FunctionSection({ geneKey }: { geneKey: number | string }) {
  const goQ = useQuery({
    queryKey: ["gene", geneKey, "goTerms"],
    queryFn: ({ signal }) => getGeneGoTerms(geneKey, signal),
    staleTime: Infinity,
  });

  const overviewQ = useQuery({
    queryKey: ["gene", geneKey, "overview"],
    queryFn: ({ signal }) => getGeneOverview(geneKey, signal),
    staleTime: Infinity,
  });

  const goCount = goQ.data?.length ?? null;
  const rank = overviewQ.data?.multifunctionalityRank;
  const rankText = formatMultifunctionalityRank(rank);

  return (
    <section className="bg-white border border-gemma-grid rounded-md p-5 space-y-2">
      <div className="text-xs uppercase tracking-wide font-semibold text-gemma-subtle">
        Function
      </div>

      {goQ.isLoading || overviewQ.isLoading ? (
        <div className="text-xs text-gemma-subtle italic">Loading…</div>
      ) : (
        <div className="text-sm text-gemma-ink">
          {goCount != null ? (
            <span>
              <span className="font-semibold">{goCount.toLocaleString()}</span>{" "}
              GO {goCount === 1 ? "term" : "terms"}
            </span>
          ) : (
            <span className="text-gemma-subtle italic">GO terms unavailable</span>
          )}
          {rankText != null ? (
            <>
              <span className="text-gemma-subtle">; </span>
              <span
                // The displayed value is rounded to two decimals like
                // the legacy page, so "1.00" is not necessarily 1 —
                // TP53 is 0.9993. Keep the exact figure reachable.
                title={`Multifunctionality rank ${rank}. Ranked in [0, 1]; higher means the gene is annotated to more distinct GO groups.`}
                className="underline decoration-dotted decoration-gemma-grid underline-offset-2"
              >
                overall multifunctionality{" "}
                <span className="font-semibold">{rankText}</span>
              </span>
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}

function DiffExComingSoonSection() {
  return (
    <section className="bg-white border border-gemma-grid rounded-md p-5">
      <div className="text-xs uppercase tracking-wide font-semibold text-gemma-subtle mb-1">
        Differential expression
      </div>
      <div className="text-sm text-gemma-subtle italic">
        Coming soon — the gene page is being heavily redone.
      </div>
    </section>
  );
}
