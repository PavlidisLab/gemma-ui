// Per-gene page — /gene/$id
// Endpoints: /rest/v2/genes/{id} · /locations · /goTerms
//
// Differential expression section is on hold pending the heavy gene-page
// rework — placeholder for now (see GENE_PAGE_REWORK_RECCE.md once it lands).

import { useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  getGene,
  getGeneLocations,
  getGeneGoTerms,
} from "@/api/endpoints";
import type { Gene, GeneLocation, GoTerm } from "@/api/endpoints";
import { gemmaUrl } from "@/lib/gemmaConfig";

export function GenePage() {
  const { id } = useParams({ from: "/gene/$id" });

  const geneQ = useQuery({
    queryKey: ["gene", id],
    queryFn: ({ signal }) => getGene(id, signal),
    enabled: !!id,
  });

  if (geneQ.isLoading) {
    return (
      <div className="h-full overflow-y-auto bg-gemma-bg">
        <div className="max-w-4xl mx-auto px-6 py-8 text-sm text-gemma-subtle italic">
          Loading gene…
        </div>
      </div>
    );
  }

  if (geneQ.isError || !geneQ.data) {
    return (
      <div className="h-full overflow-y-auto bg-gemma-bg">
        <div className="max-w-4xl mx-auto px-6 py-12 text-center space-y-2">
          <h1 className="text-lg font-semibold text-gemma-ink">
            Gene "{id}" not found.
          </h1>
          <p className="text-xs text-gemma-subtle">
            {(geneQ.error as Error)?.message ?? "No gene matched this identifier."}
          </p>
        </div>
      </div>
    );
  }

  const gene = geneQ.data;

  return (
    <div className="h-full overflow-y-auto bg-gemma-bg">
      <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
        <Breadcrumbs gene={gene} />
        <GeneHero gene={gene} />
        <LocationsSection geneId={gene.id} />
        <GoTermsSection geneId={gene.id} />
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
        <ExternalLink
          href={gemmaUrl(`/gene/showGene.html?id=${gene.id}`)}
          label="View in Gemma"
        />
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

function LocationsSection({ geneId }: { geneId: number }) {
  const locQ = useQuery({
    queryKey: ["gene", geneId, "locations"],
    queryFn: ({ signal }) => getGeneLocations(geneId, signal),
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
  const start = loc.nucleotideStart?.toLocaleString() ?? "?";
  const end = loc.nucleotideEnd?.toLocaleString() ?? "?";
  const strand = loc.strand ?? "?";
  return (
    <span className="text-[11px] font-mono px-2 py-1 rounded bg-slate-50 border border-slate-200 text-slate-800">
      {taxon ? <span className="text-gemma-subtle mr-1 italic">{taxon}</span> : null}
      {loc.chromosome}:{start}–{end}{" "}
      <span className="text-gemma-subtle">({strand})</span>
    </span>
  );
}

const GO_ASPECT_LABELS: Record<string, string> = {
  biological_process: "Biological Process",
  molecular_function: "Molecular Function",
  cellular_component: "Cellular Component",
  BP: "Biological Process",
  MF: "Molecular Function",
  CC: "Cellular Component",
};

function GoTermsSection({ geneId }: { geneId: number }) {
  const goQ = useQuery({
    queryKey: ["gene", geneId, "goTerms"],
    queryFn: ({ signal }) => getGeneGoTerms(geneId, signal),
    staleTime: Infinity,
  });

  if (goQ.isLoading) {
    return (
      <section className="bg-white border border-gemma-grid rounded-md p-4 text-xs text-gemma-subtle italic">
        Loading GO terms…
      </section>
    );
  }

  const terms = goQ.data ?? [];
  if (terms.length === 0) return null;

  const grouped = new Map<string, GoTerm[]>();
  for (const t of terms) {
    const asp = t.aspect ?? "other";
    if (!grouped.has(asp)) grouped.set(asp, []);
    grouped.get(asp)!.push(t);
  }

  const aspectOrder = ["BP", "MF", "CC", "biological_process", "molecular_function", "cellular_component"];
  const sortedGroups = [...grouped.entries()].sort(([a], [b]) => {
    const ai = aspectOrder.indexOf(a);
    const bi = aspectOrder.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return (
    <section className="bg-white border border-gemma-grid rounded-md p-5 space-y-4">
      <div className="text-xs uppercase tracking-wide font-semibold text-gemma-subtle">
        GO annotations ({terms.length})
      </div>
      <div className="space-y-3">
        {sortedGroups.map(([asp, aspTerms]) => (
          <div key={asp}>
            <div className="text-[10px] uppercase tracking-wide text-gemma-subtle mb-1.5">
              {GO_ASPECT_LABELS[asp] ?? asp}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {aspTerms.map((t) => (
                <a
                  key={t.termUri ?? t.goId ?? t.term}
                  href={t.termUri ? `https://www.ebi.ac.uk/QuickGO/term/${t.goId}` : undefined}
                  target={t.goId ? "_blank" : undefined}
                  rel="noreferrer"
                  title={t.definition ?? t.termUri ?? undefined}
                  className="text-[11px] px-1.5 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-800 hover:border-indigo-400 transition-colors"
                >
                  {t.goId ? (
                    <span className="font-mono text-[10px] text-indigo-500 mr-1">{t.goId}</span>
                  ) : null}
                  {t.term ?? t.termUri ?? "?"}
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
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
