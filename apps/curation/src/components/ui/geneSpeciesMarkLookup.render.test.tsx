/**
 * @vitest-environment jsdom
 *
 * The species mark resolves the gene by its NCBI id.
 *
 * Most stored bindings are a bare symbol — "ESR1" — which states no
 * species, and reading the label was never going to answer for those.
 * The id in the URI does: Gemma's own gene catalogue
 * (``/rest/v2/genes/{ncbiId}``) knows the taxon of every gene it has.
 * These cases pin that the catalogue is what the mark believes, and
 * that the label is only the fallback.
 */
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import type { GeneInfo } from "@/api/genes";
import { GeneSpeciesMark } from "./GeneSpeciesMark";

const gene = vi.hoisted(() => ({ current: null as GeneInfo | null }));

vi.mock("@/api/genes", () => ({
  useGeneInfo: () => ({ data: gene.current }),
}));

const HUMAN_ESR1 = "http://purl.org/commons/record/ncbi_gene/2099";

function info(patch: Partial<GeneInfo>): GeneInfo {
  return {
    ncbiId: "2099",
    symbol: "ESR1",
    name: "estrogen receptor 1",
    taxonCommonName: "human",
    taxonScientificName: "Homo sapiens",
    aliases: [],
    ...patch,
  };
}

function mark(
  found: GeneInfo | null,
  props: { species?: string | null; datasetTaxon: string | null },
) {
  gene.current = found;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <GeneSpeciesMark
        uri={HUMAN_ESR1}
        species={props.species ?? null}
        datasetTaxon={props.datasetTaxon}
      />
    </QueryClientProvider>,
  );
  return screen.queryAllByTitle(/^Species:/m)[0] ?? null;
}

describe("GeneSpeciesMark — catalogue lookup", () => {
  it("answers for a bare symbol the label could never have answered for", () => {
    const el = mark(info({}), { species: null, datasetTaxon: "human" });
    expect(el?.textContent).toBe("H.s.");
    expect(el?.className).not.toContain("amber");
  });

  it("flags the mismatch it just resolved", () => {
    const el = mark(info({ taxonScientificName: "Mus musculus", taxonCommonName: "mouse" }), {
      species: null,
      datasetTaxon: "human",
    });
    expect(el?.textContent).toBe("M.m.");
    expect(el?.className).toContain("amber");
  });

  it("believes the catalogue over the label when they disagree", () => {
    // The label is whatever the producing tool wrote; the id is what
    // the annotation actually points at.
    const el = mark(info({ taxonScientificName: "Mus musculus", taxonCommonName: "mouse" }), {
      species: "human",
      datasetTaxon: "human",
    });
    expect(el?.textContent).toBe("M.m.");
    expect(el?.className).toContain("amber");
  });

  it("puts the catalogue's own reading of the id in the tooltip", () => {
    const el = mark(info({}), { species: null, datasetTaxon: "human" });
    expect(el?.title).toContain("Gemma: ESR1 — estrogen receptor 1");
  });

  it("falls back to the label when the catalogue can't be reached", () => {
    const el = mark(null, { species: "human", datasetTaxon: "human" });
    expect(el?.textContent).toBe("H.s.");
    expect(el?.className).not.toContain("amber");
  });

  it("flags when neither the catalogue nor the label knows", () => {
    const el = mark(null, { species: null, datasetTaxon: "human" });
    expect(el?.textContent).toBe("sp?");
    expect(el?.className).toContain("amber");
  });
});
