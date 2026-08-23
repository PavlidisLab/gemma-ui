/**
 * @vitest-environment jsdom
 *
 * Popover: the synonyms line spends its budget on names, not formulae.
 *
 * A ChEBI compound arrives with its IUPAC name first and the code a
 * curator recognises seventh — CHEBI:145535 put a 125-character
 * sulfamate on the line and left `MLN4924` inside "(+6 more)", which is
 * the one string that would have told a reader the chip is the drug
 * they know. `normalizeSynonyms` reorders; the budget here has to not
 * hand the space straight back to the nomenclature.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { AnnotationTermDetail, TermSynonym } from "@/api/annotations";

import { CuriePopover } from "./CuriePopover";

const term = vi.hoisted(() => ({ current: null as AnnotationTermDetail | null }));

vi.mock("@/api/annotations", () => ({
  useGemmaTerm: () => ({ data: term.current, isLoading: false, isFetched: true }),
  useOlsTerm: () => ({ data: null, isLoading: false }),
  useNcbiGene: () => ({ data: null, isLoading: false }),
  useTermChildren: () => ({ data: null, isLoading: false }),
  useTermSynonyms: () => ({ data: [], isLoading: false }),
}));

const IUPAC =
  "[(1S,2S,4R)-4-{4-[(1S)-2,3-dihydro-1H-inden-1-ylamino]-7H-pyrrolo" +
  "[2,3-d]pyrimidin-7-yl}-2-hydroxycyclopentyl]methyl sulfamate";
const IUPAC_ALT =
  "[(1S,2S,4R)-4-[4-[[(1S)-2,3-dihydro-1H-inden-1-yl]amino]pyrrolo" +
  "[2,3-d]pyrimidin-7-yl]-2-hydroxy-cyclopentyl]methyl sulfamate";

/** Post-``normalizeSynonyms`` order — what the card actually receives. */
const syn = (...values: string[]): TermSynonym[] =>
  values.map((value) => ({ value, type: "related_synonym" }));

function open(synonyms: TermSynonym[]) {
  term.current = {
    uri: "http://purl.obolibrary.org/obo/CHEBI_145535",
    label: "pevonedistat",
    definition: "A pyrrolopyrimidine that is 7H-pyrrolo[2,3-d]pyrimidine …",
    parents: [],
    synonyms,
    alternativeIds: [],
    xrefs: [],
    ontologyVersion: "254+gemma-slim",
    ontology: "chebi",
    source: "gemma",
    canonicalUrl: null,
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CuriePopover
        uri={term.current.uri}
        anchorRect={new DOMRect(0, 0, 10, 10)}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
}

/** The rendered synonyms line, as one string. */
function line(): string {
  const label = screen.getByText(/^synonyms:/);
  return label.parentElement?.textContent ?? "";
}

describe("CuriePopover synonyms line", () => {
  beforeEach(() => {
    term.current = null;
  });

  it("shows the recognisable names and keeps the IUPAC name in the tail", () => {
    open(
      syn("pevonedistatum", "MLN-4924", "MLN4924", "MLN 4924", IUPAC, IUPAC_ALT),
    );
    const text = line();
    expect(text).toContain("MLN4924");
    expect(text).toContain("pevonedistatum");
    // The budget stops before the entry that would overrun it, rather
    // than admitting one 125-character name and wrapping four lines.
    expect(text).not.toContain("sulfamate");
    expect(text).toContain("(+2 more)");
  });

  it("still names one synonym when every one of them is systematic", () => {
    open(syn(IUPAC, IUPAC_ALT));
    const text = line();
    expect(text).toContain("methyl sulfamate");
    expect(text).toContain("(+1 more)");
  });

  it("leaves a term whose aliases all fit fully listed", () => {
    open(syn("cerebral ischemia", "brain infarction", "cerebral infarct"));
    const text = line();
    expect(text).toContain("cerebral ischemia");
    expect(text).toContain("cerebral infarct");
    expect(text).not.toContain("more)");
  });
});
