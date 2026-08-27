/**
 * @vitest-environment jsdom
 *
 * Popover footer: registry link-outs + copy-URI.
 *
 * The two link-outs must land on DIFFERENT pages. They didn't: the
 * "OBO" link was the bare ``purl.obolibrary.org`` IRI, and the purl
 * content-negotiates an HTML request straight to OLS4 — so "OBO" and
 * "OLS" opened the same EBI page. OBO Foundry terms now point at
 * Ontobee instead. EFO's canonical IRI redirects to the OLS entity
 * page, so EFO gets ONE link, not an "EFO · OLS" pair.
 *
 * Copy-URI copies the resolved IRI (not the CURIE) and is present even
 * for terms with no browsable registry home.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

function detail(uri: string, xrefs: string[] = []): AnnotationTermDetail {
  return {
    uri,
    label: "astrocyte",
    definition: "",
    parents: [],
    synonyms: [],
    alternativeIds: [],
    xrefs,
    ontologyVersion: null,
    ontology: "",
    source: "gemma",
    canonicalUrl: uri,
  };
}

function open(uri: string, xrefs: string[] = []) {
  term.current = detail(uri, xrefs);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <CuriePopover
        uri={uri}
        anchorRect={new DOMRect(0, 0, 10, 10)}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
}

function hrefOf(label: string): string {
  const a = screen.getByText(new RegExp(`^${label} ↗$`));
  return a.getAttribute("href") ?? "";
}

describe("CuriePopover link-outs", () => {
  beforeEach(() => {
    term.current = null;
  });

  it("sends an OBO Foundry term to Ontobee and OLS — two distinct pages", () => {
    open("http://purl.obolibrary.org/obo/CL_0000127");
    const ontobee = hrefOf("Ontobee");
    const ols = hrefOf("OLS");
    expect(ontobee).toContain("ontobee.org/ontology/CL");
    expect(ols).toContain("ebi.ac.uk/ols4");
    expect(ontobee).not.toBe(ols);
    // The bare purl must not be offered — it redirects to the OLS page.
    expect(screen.queryByText(/^OBO ↗$/)).toBeNull();
  });

  it("gives an EFO term a single OLS link, not a duplicate pair", () => {
    open("http://www.ebi.ac.uk/efo/EFO_0000513");
    expect(screen.getAllByText(/^OLS ↗$/)).toHaveLength(1);
    expect(screen.queryByText(/^Ontobee ↗$/)).toBeNull();
  });

  it("copies the resolved IRI, not the CURIE", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    open("CL:0000127");
    await userEvent.click(screen.getByRole("button", { name: /copy URI/ }));
    expect(writeText).toHaveBeenCalledWith(
      "http://purl.obolibrary.org/obo/CL_0000127",
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /copied/ })).toBeTruthy(),
    );
  });

  it("links a cell line to its Cellosaurus RECORD when the term xrefs one", () => {
    // Gemma files the accession under RRID, not Cellosaurus — matching a
    // "Cellosaurus" prefix would find nothing, silently, and leave the
    // curator on a search page.
    open("http://www.ebi.ac.uk/efo/EFO_0001086", [
      "CLO:0001601",
      "RRID:CVCL_0023",
      "BTO:0000018",
    ]);
    const href = hrefOf("Cellosaurus");
    expect(href).toBe("https://www.cellosaurus.org/CVCL_0023");
    expect(href).not.toContain("search");
  });

  it("keeps the name search when the term xrefs no accession", () => {
    // The fallback still has to work: most cell-line terms carry no
    // Cellosaurus xref, and a search beats no link at all.
    open("http://purl.obolibrary.org/obo/CLO_0051454", ["BTO:0000018"]);
    expect(hrefOf("Cellosaurus")).toContain("cellosaurus.org/search?query=");
  });

  it("leaves a native Cellosaurus term alone — it already addresses its page", () => {
    open("http://www.cellosaurus.org/CVCL_0395");
    expect(hrefOf("Cellosaurus")).toBe("https://www.cellosaurus.org/CVCL_0395");
    // Native CVCL gets ONLY Cellosaurus; OBO/OLS do not host it.
    expect(screen.queryByText(/^OLS ↗$/)).toBeNull();
  });

  it("still offers copy for a term with no browsable registry home", () => {
    open("http://gemma.msl.ubc.ca/ont/TGEMO_00022");
    expect(screen.queryByText(/^OLS ↗$/)).toBeNull();
    expect(screen.getByRole("button", { name: /copy URI/ })).toBeTruthy();
  });
});
