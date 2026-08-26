/**
 * Probe-level building blocks, shared by the platform page's inline
 * element expando and the standalone probe page.
 *
 * These lived inside `PlatformDetailPage` when the expando was their
 * only consumer. The probe page renders the same three things — gene
 * mappings, sequence, genome alignments — so they moved here rather
 * than being reimplemented against the same endpoints with a second
 * set of copy and colours.
 */

import { useQuery } from "@tanstack/react-query";
import { getElementAlignments } from "@/api/endpoints";
import type { GeneMappingSummary, MappedGene } from "@/api/endpoints";
import { publicGemmaUrl } from "@/lib/gemmaConfig";

/**
 * UCSC genome-browser link for one alignment.
 *
 * The assembly is NOT `blatResult.targetDatabase`, which is the string
 * "human"; it is `taxon.externalDatabase.name`, "hg38".  Chromosome
 * names arrive bare and UCSC wants the `chr` prefix, which is also
 * correct for alt contigs.
 *
 * `hgt.customText` points UCSC at Gemma's own `pslTrack` endpoint —
 * `text/plain`, public, and carrying EVERY alignment for the probe in
 * one track. So each row opens at its own locus with the whole
 * mapping loaded, and the track text is the server's, not ours.
 *
 * The URL handed to UCSC has to be absolute and reachable from
 * outside, which is `publicGemmaUrl` and emphatically not `gemmaUrl` —
 * see the note there. It returns EMPTY when there is no base we can
 * honestly claim is public, and the track is attached only when the
 * result is a real http(s) URL. Position is always set, so a link
 * without a track still lands somewhere useful.
 */
export function ucscUrl(
  b: NonNullable<GeneMappingSummary["blatResult"]>,
  trackUrl: string,
): string | null {
  const db = b.taxon?.externalDatabase?.name;
  const chr = b.targetChromosomeName;
  if (!db || !chr || b.targetStart == null || b.targetEnd == null) return null;
  const seq = /^chr/i.test(chr) ? chr : `chr${chr}`;
  const params = new URLSearchParams({
    db,
    position: `${seq}:${b.targetStart}-${b.targetEnd}`,
  });
  if (/^https?:\/\//i.test(trackUrl)) params.set("hgt.customText", trackUrl);
  return `https://genome.ucsc.edu/cgi-bin/hgTracks?${params.toString()}`;
}

/** BLAT identity and score arrive as fractions, not percentages. */
export function pct(v: number): string {
  return `${(v * 100).toFixed(v >= 0.999 ? 0 : 1)}%`;
}

/** GRCh38 alt contigs carry an `_alt` / `_random` / `chrUn_` suffix.
 *  A probe with one primary hit typically also aligns to every alt
 *  contig covering the same locus, so they are the same finding
 *  repeated rather than multi-mapping. */
export function isAltContig(chr: string): boolean {
  return /_alt$|_random$|^chrUn|^Un_/i.test(chr);
}

/** Primary assembly first; the alt-contig repeats after it. */
export function sortAlignments(rows: GeneMappingSummary[]): GeneMappingSummary[] {
  return [...rows].sort((a, b) => {
    const ca = a.blatResult?.targetChromosomeName ?? "";
    const cb = b.blatResult?.targetChromosomeName ?? "";
    return Number(isAltContig(ca)) - Number(isAltContig(cb));
  });
}

export function GeneMappings({
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
        // Don't guess at WHY. A probe can map to nothing because it
        // has no genome alignment, because its alignments are
        // non-specific, or because it is a control — and the payload
        // says none of that. State the fact only.
        <div className="text-[11px] text-gemma-subtle italic">
          no gene mapping met criteria
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
export function ProbeSequence({
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
export function GenomeAlignment({
  platformId,
  elementId,
  enabled,
}: {
  /** Numeric id or short name — both resolve in the REST path. */
  platformId: number | string;
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
  // UCSC fetches this itself, so it needs a base reachable from the
  // internet — not the one this app talks to. Empty when we have none,
  // which drops the track and leaves the position link.
  const trackUrl = publicGemmaUrl(
    `/rest/v2/platforms/${platformId}/elements/${elementId}/pslTrack`,
  );
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
            const url = ucscUrl(b, trackUrl);
            const coords =
              chr && start != null && end != null
                ? `${chr}:${start.toLocaleString()}-${end.toLocaleString()}`
                : null;
            return (
              // Two lines, not one: the locus plus its metrics ran past
              // the panel, which is a half-width column on this page.
              <li key={i} className="text-[11px] leading-snug">
                <div className="font-mono text-gemma-ink break-all">
                  {coords ? (
                    url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-gemma-accent hover:underline"
                        title="Open this locus in the UCSC genome browser"
                      >
                        {coords}
                      </a>
                    ) : (
                      coords
                    )
                  ) : (
                    <span className="text-gemma-subtle italic">
                      alignment without coordinates
                    </span>
                  )}
                  {b.strand ? (
                    <span className="text-gemma-subtle"> ({b.strand})</span>
                  ) : null}
                  {chr && isAltContig(chr) ? (
                    <span
                      className="ml-1 text-[9px] text-gemma-subtle"
                      title="An alternate contig — usually the same locus as the primary-assembly hit above, not a second place the probe lands."
                    >
                      alt
                    </span>
                  ) : null}
                </div>
                <div className="text-[10px] text-gemma-subtle">
                  {b.identity != null ? `${pct(b.identity)} identity` : ""}
                  {b.identity != null && b.score != null ? " · " : ""}
                  {b.score != null ? `score ${pct(b.score)}` : ""}
                  {r.genes?.length ? (
                    <>
                      {b.identity != null || b.score != null ? " · " : ""}
                      {r.genes.map((g) => g.officialSymbol ?? "?").join(", ")}
                    </>
                  ) : (
                    <span
                      title="The probe aligns here but the alignment supports no gene — a real result, not a missing one."
                      className="italic"
                    >
                      {b.identity != null || b.score != null ? " · " : ""}
                      no gene
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
