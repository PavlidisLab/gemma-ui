/**
 * Standalone probe (design element) page — /platforms/$shortName/probe/$id.
 *
 * A React port of Gemma's legacy `compositeSequence.detail.jsp`
 * (`/arrays/compositeSequence/show.html?id=`): probe name + platform,
 * a description/sequence detail table, and the genome-alignment grid
 * that page loads over DWR.
 *
 * **Why the URL carries the platform.** The legacy page is addressed
 * by composite-sequence id alone because it queries the database
 * directly. REST has no top-level probe endpoint — every element hangs
 * off `/platforms/{platform}/elements/{id}` — and a mismatched pair
 * answers 200 with an empty list rather than 404. So the platform is
 * part of the address here. It costs nothing: that path segment takes
 * a short name as readily as an id, so the route keys on `shortName`
 * exactly like the platform page it sits under.
 *
 * **Where each field comes from.** Two calls, and they are not
 * interchangeable:
 *   - the element itself (`withSequence`, `withGenes`) → name,
 *     description, the bases, length, mapped genes;
 *   - the mapping summary → the alignments, and — riding on any one of
 *     them — the sequence's *metadata*: type, sequence name, sequence
 *     description, accession, taxon.
 *
 * That second point is the page's one real seam. Sequence metadata is
 * only published inside a BLAT result, so a probe with no alignments
 * shows its bases but none of the descriptive fields around them. The
 * detail rows say "not recorded" and mean it; see `probeSequenceInfo`.
 *
 * Not ported: the legacy grid's **Transcripts** column. The REST
 * mapping summary serializes `blatResult` and `genes` only — the gene
 * *products* behind a hit (`geneProductIdMap` on the Java value
 * object) never reach the wire.
 */

import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  getElementAlignments,
  getPlatformElement,
  probeSequenceInfo,
  type BioSequenceInfo,
} from "@/api/endpoints";
import { PageMask } from "@gemma/ui";
import { GeneMappings, GenomeAlignment, ProbeSequence } from "./probeDetail";
import { getElementGenes } from "@/api/endpoints";

export function ProbePage() {
  const { shortName, elementId } = useParams({ strict: false }) as {
    shortName?: string;
    elementId?: string;
  };
  const platform = shortName ?? "";
  const id = Number(elementId);

  const elementQ = useQuery({
    queryKey: ["platform", platform, "element", id],
    queryFn: ({ signal }) => getPlatformElement(platform, id, signal),
    enabled: !!platform && Number.isFinite(id),
    staleTime: 5 * 60_000,
  });

  // Alignments come down separately because they are the expensive
  // half — and because the same query key is already warm whenever the
  // visitor arrived by opening this probe's row on the platform page.
  const alignmentsQ = useQuery({
    queryKey: ["platform", platform, "element", id, "alignments"],
    queryFn: ({ signal }) => getElementAlignments(platform, id, signal),
    enabled: !!platform && Number.isFinite(id),
    staleTime: Infinity,
  });

  const genesQ = useQuery({
    queryKey: ["platform", platform, "element", id, "genes"],
    queryFn: ({ signal }) => getElementGenes(platform, id, signal),
    enabled: !!platform && Number.isFinite(id),
    staleTime: 5 * 60_000,
  });

  if (!Number.isFinite(id)) {
    return (
      <Stub
        label="Not a probe id."
        detail={`"${elementId}" isn't a number. Probe pages are addressed by element id.`}
      />
    );
  }
  if (elementQ.isLoading) {
    return <PageMask mode="region" label="Loading probe" detail={`#${id}…`} />;
  }
  if (elementQ.isError) {
    return (
      <Stub
        label="Couldn't load this probe."
        detail={(elementQ.error as Error).message}
      />
    );
  }
  const el = elementQ.data;
  if (!el) {
    // The empty-list case: either the probe doesn't exist or it isn't
    // on this platform. REST can't tell us which, so don't pick one.
    return (
      <Stub
        label="No such probe on this platform."
        detail={`Element #${id} isn't on ${platform}. The id may belong to another platform, or not exist.`}
      />
    );
  }

  const seq = probeSequenceInfo(alignmentsQ.data ?? []);
  const platformName = el.arrayDesign?.shortName ?? platform;

  return (
    <div className="h-full overflow-y-auto bg-gemma-bg">
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-5">
        <nav className="text-[11px] text-gemma-subtle">
          <Link to="/platforms" className="hover:underline">
            Platforms
          </Link>
          {" / "}
          <Link
            to="/platforms/$shortName"
            params={{ shortName: platform }}
            className="hover:underline"
          >
            {platformName}
          </Link>
          {" / "}
          <span className="text-gemma-ink">{el.name}</span>
        </nav>

        <header>
          <h1 className="text-xl font-semibold text-gemma-ink font-mono break-all">
            {el.name}
          </h1>
          <p className="text-[12px] text-gemma-subtle mt-0.5">
            design element on{" "}
            <Link
              to="/platforms/$shortName"
              params={{ shortName: platform }}
              className="text-gemma-accent hover:underline"
            >
              {platformName}
            </Link>
            {el.arrayDesign?.name ? (
              <span className="text-gemma-subtle"> — {el.arrayDesign.name}</span>
            ) : null}
          </p>
        </header>

        <section className="bg-white dark:bg-transparent border border-gemma-grid rounded">
          <table className="w-full text-[12px]">
            <tbody>
              <Row
                label="Description"
                hint="Description for the probe, usually provided by the manufacturer. It might not match the sequence annotation."
                value={el.description?.trim()}
                missing="No description available"
              />
              <Row
                label="Taxon"
                value={seq?.taxon?.commonName ?? seq?.taxon?.scientificName}
                missing="No taxon available"
                pending={alignmentsQ.isLoading}
              />
              <Row
                label="Sequence type"
                hint="The type of this sequence as recorded in Gemma."
                value={seq?.type}
                missing="No sequence type available"
                pending={alignmentsQ.isLoading}
                mono
              />
              <Row
                label="Sequence name"
                hint="Name of the sequence in Gemma."
                value={seq?.name}
                missing="No sequence name available"
                pending={alignmentsQ.isLoading}
                mono
              />
              <Row
                label="Sequence description"
                hint="Description of the sequence in Gemma."
                value={seq?.description}
                missing="No sequence description available"
                pending={alignmentsQ.isLoading}
              />
              <Row
                label="Sequence accession"
                hint="External accession for this sequence, if known."
                value={accessionOf(seq)}
                missing="No accession available"
                pending={alignmentsQ.isLoading}
                mono
              />
              <Row
                label="Sequence length"
                value={
                  el.sequenceLength != null
                    ? `${el.sequenceLength.toLocaleString()} bp`
                    : seq?.length != null
                      ? `${seq.length.toLocaleString()} bp`
                      : undefined
                }
                missing="No sequence available"
              />
            </tbody>
          </table>
        </section>

        <section className="bg-white dark:bg-transparent border border-gemma-grid rounded px-3 py-2">
          <ProbeSequence
            sequence={el.sequence ?? seq?.sequence}
            sequenceLength={el.sequenceLength ?? seq?.length}
          />
        </section>

        <section className="bg-white dark:bg-transparent border border-gemma-grid rounded px-3 py-2">
          <GeneMappings genesQ={genesQ} />
        </section>

        <section className="bg-white dark:bg-transparent border border-gemma-grid rounded px-3 py-2">
          <GenomeAlignment platformId={platform} elementId={id} enabled />
          {/* The legacy grid has a Transcripts column listing the gene
              products behind each hit. REST publishes the alignment and
              its genes but not its gene products, so there is nothing
              to render — said plainly rather than left as a silent
              omission. */}
          <p className="text-[10px] text-gemma-subtle italic mt-2">
            Per-alignment transcripts aren't published by the API.
          </p>
        </section>
      </div>
    </div>
  );
}

/** Accession plus the database that issued it, when both are known. */
function accessionOf(seq: BioSequenceInfo | null): string | undefined {
  const acc = seq?.sequenceDatabaseEntry?.accession;
  if (!acc) return undefined;
  const db = seq?.sequenceDatabaseEntry?.externalDatabase?.name;
  return db ? `${acc} (${db})` : acc;
}

/** One detail row. `missing` is the legacy page's own wording for an
 *  absent value — kept, because "No accession available" is a
 *  different and more useful statement than an empty cell. */
function Row({
  label,
  hint,
  value,
  missing,
  pending,
  mono,
}: {
  label: string;
  hint?: string;
  value?: string | null;
  missing: string;
  pending?: boolean;
  mono?: boolean;
}) {
  return (
    <tr className="border-b border-gemma-grid last:border-b-0 align-top">
      <td className="px-3 py-1.5 font-semibold text-gemma-ink whitespace-nowrap w-52">
        {label}
        {hint ? (
          <span
            className="ml-1 text-gemma-subtle cursor-help font-normal"
            title={hint}
          >
            ⓘ
          </span>
        ) : null}
      </td>
      <td
        className={`px-3 py-1.5 text-gemma-ink break-words ${mono ? "font-mono text-[11px]" : ""}`}
      >
        {pending ? (
          <span className="text-gemma-subtle italic">loading…</span>
        ) : value ? (
          value
        ) : (
          <span className="text-gemma-subtle italic">{missing}</span>
        )}
      </td>
    </tr>
  );
}

function Stub({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="h-full overflow-y-auto bg-gemma-bg">
      <div className="max-w-4xl mx-auto px-6 py-12 text-center space-y-2">
        <h1 className="text-lg font-semibold text-gemma-ink">{label}</h1>
        {detail ? (
          <p className="text-xs text-gemma-subtle">{detail}</p>
        ) : null}
      </div>
    </div>
  );
}
