/**
 * @vitest-environment jsdom
 *
 * Popover: derived facts are visibly not the term's definition.
 *
 * Curation policy 2026-08-12 takes a cell line's intrinsic disease off
 * the curator's plate, which only works if the UI puts it back on the
 * screen — labelled as derived, and never in the slot that says what
 * the term means. Gemma started serving CLO's ``disease:`` description
 * in the same ``definition`` field that carries genuine prose the same
 * afternoon, so "renders the string as a definition" is a live failure
 * mode, not a hypothetical one.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { AnnotationTermDetail } from "@/api/annotations";

import { CuriePopover } from "./CuriePopover";

const term = vi.hoisted(() => ({ current: null as AnnotationTermDetail | null }));

vi.mock("@/api/annotations", () => ({
  useGemmaTerm: () => ({ data: term.current, isLoading: false, isFetched: true }),
  useOlsTerm: () => ({ data: null, isLoading: false }),
  useNcbiGene: () => ({ data: null, isLoading: false }),
  useTermChildren: () => ({ data: null, isLoading: false }),
  useTermSynonyms: () => ({ data: [], isLoading: false }),
}));

function open(detail: AnnotationTermDetail) {
  term.current = detail;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CuriePopover
        uri={detail.uri}
        anchorRect={new DOMRect(0, 0, 10, 10)}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
}

const base = (o: Partial<AnnotationTermDetail>): AnnotationTermDetail => ({
  uri: "http://purl.obolibrary.org/obo/CLO_0008127",
  label: "NCI-H929 cell",
  definition: "",
  parents: [],
  synonyms: [],
  alternativeIds: [],
  xrefs: [],
  ontologyVersion: null,
  ontology: "clo",
  source: "gemma",
  canonicalUrl: null,
  ...o,
});

describe("CuriePopover derived facts", () => {
  beforeEach(() => {
    term.current = null;
  });

  it("shows a CLO disease as derived, never as the definition", () => {
    open(base({ definition: "disease: plasmacytoma;   myeloma" }));
    // The raw description string must not appear anywhere verbatim —
    // that would be the catalogue's inference wearing a definition's
    // clothes.
    expect(screen.queryByText(/disease: plasmacytoma/)).toBeNull();
    expect(screen.getByText(/^derived$/)).toBeTruthy();
    expect(screen.getByText(/plasmacytoma · myeloma/)).toBeTruthy();
    expect(screen.getByText("CLO")).toBeTruthy();
  });

  it("does not claim 'no definition' when the definition WAS a derived fact", () => {
    open(base({ definition: "disease: plasmacytoma" }));
    expect(screen.queryByText(/No definition recorded/)).toBeNull();
  });

  it("still says 'no definition' when there is genuinely nothing", () => {
    open(base({ definition: "" }));
    expect(screen.getByText(/No definition recorded/)).toBeTruthy();
  });

  it("keeps a real prose definition in the definition slot", () => {
    const prose =
      "An immortal human B cell line cell originating from the bone marrow.";
    open(
      base({ uri: "http://purl.obolibrary.org/obo/CLO_0037272", definition: prose }),
    );
    expect(screen.getByText(prose)).toBeTruthy();
    expect(screen.queryByText(/^derived$/)).toBeNull();
  });

  it("hoists a contamination flag above the definition and names the source", () => {
    open(
      base({
        uri: "https://www.cellosaurus.org/CVCL_0372",
        label: "KB",
        definition: "A long Cellosaurus dump.",
        sourceMetadata: {
          species: [{ ncbiTaxonId: 9606, label: "Homo sapiens (Human)" }],
          cellLineType: "Cancer cell line",
          sex: "Female",
          strainType: null,
          problematic: "Contaminated",
        },
      }),
    );
    // The flag value is its own bold span; the sentence naming the
    // source is the parent's text.
    const warning = screen.getByText(/Contaminated/);
    expect(warning.parentElement?.textContent).toMatch(/flagged by Cellosaurus/);
    // Ahead of the definition in DOM order — a warning under a
    // 900-character dump is a warning nobody reads.
    const defn = screen.getByText("A long Cellosaurus dump.");
    expect(
      warning.compareDocumentPosition(defn) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // ...and not repeated as an ordinary row below.
    expect(screen.queryByText(/^problematic:/)).toBeNull();
  });

  it("renders the Cellosaurus block without turning facts into links", () => {
    open(
      base({
        uri: "https://www.cellosaurus.org/CVCL_0030",
        label: "HeLa",
        sourceMetadata: {
          species: [{ ncbiTaxonId: 9606, label: "Homo sapiens (Human)" }],
          cellLineType: "Cancer cell line",
          sex: "Female",
          strainType: null,
          problematic: null,
        },
      }),
    );
    expect(screen.getByText(/Homo sapiens \(Human\) · NCBI Taxon 9606/)).toBeTruthy();
    expect(screen.getByText(/Cancer cell line/)).toBeTruthy();
    // Gemma serves no NCBITaxon card, so a species must not be a
    // clickable chip that dead-ends the curator.
    const species = screen.getByText(/Homo sapiens \(Human\) · NCBI Taxon 9606/);
    expect(species.closest("a")).toBeNull();
    expect(species.closest("button")).toBeNull();
  });

  it("shows nothing derived for an ordinary ontology term", () => {
    open(
      base({
        uri: "http://purl.obolibrary.org/obo/MONDO_0009693",
        label: "plasma cell myeloma",
        definition: "A bone marrow-based plasma cell neoplasm.",
      }),
    );
    expect(screen.queryByText(/^derived$/)).toBeNull();
  });
});
