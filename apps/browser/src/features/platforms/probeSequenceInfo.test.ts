/**
 * Pins where the probe page's sequence metadata comes from.
 *
 * REST publishes a probe's BioSequence *metadata* (type, name,
 * description, accession, taxon) in exactly one place: nested inside a
 * BLAT result, on `blatResult.querySequence`. Every alignment of one
 * probe shares that sequence, so any of them will do — but a probe
 * with no alignments has no copy of it at all, even though the
 * sequence plainly exists (the elements listing serves its bases and
 * length). GPL96's AFFX control probes are the real example: 0
 * alignments, 267bp of sequence, no metadata.
 *
 * Hence null rather than an empty shell, so the page can say "No
 * sequence type available" and mean it.
 */
import { describe, it, expect } from "vitest";
import { probeSequenceInfo, type GeneMappingSummary } from "@/api/endpoints";

/** Shape as served for GPL96 `1007_s_at`, trimmed. */
const withSequence: GeneMappingSummary = {
  blatResult: {
    targetChromosomeName: "6",
    strand: "+",
    querySequence: {
      name: "1007_s_at_collapsed",
      type: "AFFY_COLLAPSED",
      description: "Collapsed from 16 reporter sequences",
      length: 251,
      taxon: { commonName: "human", scientificName: "Homo sapiens" },
    },
  },
  genes: [{ id: 16908, officialSymbol: "DDR1", ncbiId: 780 }],
};

/** Same probe, a further alignment — alt contig, same query sequence. */
const altContig: GeneMappingSummary = {
  blatResult: {
    targetChromosomeName: "6_GL000253v2_alt",
    strand: "+",
    querySequence: { name: "1007_s_at_collapsed", type: "AFFY_COLLAPSED" },
  },
};

describe("probeSequenceInfo", () => {
  it("reads the sequence off an alignment", () => {
    expect(probeSequenceInfo([withSequence])?.type).toBe("AFFY_COLLAPSED");
  });

  it("takes the first alignment that carries one", () => {
    // Order shouldn't matter — they describe the same query sequence.
    expect(probeSequenceInfo([altContig, withSequence])?.name).toBe(
      "1007_s_at_collapsed",
    );
    expect(probeSequenceInfo([withSequence, altContig])?.name).toBe(
      "1007_s_at_collapsed",
    );
  });

  it("skips an alignment that carries no query sequence", () => {
    const bare: GeneMappingSummary = {
      blatResult: { targetChromosomeName: "6" },
    };
    expect(probeSequenceInfo([bare, withSequence])?.type).toBe(
      "AFFY_COLLAPSED",
    );
  });

  it("is null for a probe with no alignments — the AFFX-control case", () => {
    expect(probeSequenceInfo([])).toBeNull();
  });

  it("is null rather than an empty shell when no alignment carries one", () => {
    // The page distinguishes these: null prints "No sequence type
    // available", an empty object would print a blank cell.
    expect(probeSequenceInfo([{ blatResult: null }])).toBeNull();
    expect(probeSequenceInfo([{ blatResult: { querySequence: null } }])).toBeNull();
  });
});
