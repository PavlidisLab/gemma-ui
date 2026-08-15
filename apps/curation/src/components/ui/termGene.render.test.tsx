/**
 * @vitest-environment jsdom
 *
 * Gene chips: symbol on the chip, species beside it, amber whenever
 * the species can't be confirmed against the dataset.
 *
 * Wrong-species gene bindings are a Tier-1 failure mode (see
 * ``lib/taxon.ts``) and the old chip made them invisible twice over:
 * it rendered "Esr1 [mouse] estrogen receptor 1 (alpha)" — species
 * buried mid-string, and long enough to truncate before you reach it —
 * or it rendered a bare "ESR1", which states no species at all.
 */
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { Term } from "./Term";
import {
  DesignDraftContext,
  type DesignDraftValue,
} from "@/features/design/DesignDraftContext";

const HUMAN_ESR1 = "http://purl.org/commons/record/ncbi_gene/2099";
const MOUSE_ESR1 = "http://purl.org/commons/record/ncbi_gene/13982";
const CELL_TYPE = "http://purl.obolibrary.org/obo/CL_0000127";

/** Minimal draft stub — the chip reads one field off it.
 *
 *  The QueryClient is here because the species mark asks the gene
 *  catalogue what the id is. There is no network in jsdom, so every
 *  lookup resolves to null and the chip falls back to reading the
 *  label — which is exactly the path these cases exercise. */
function withProviders(node: React.ReactNode, taxon: string | null) {
  const value = { draft: taxon ? { taxon } : null } as unknown as DesignDraftValue;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DesignDraftContext.Provider value={value}>
        {node}
      </DesignDraftContext.Provider>
    </QueryClientProvider>,
  );
}

/** The species marker is the chip's only element carrying a title that
 *  starts with "Species:". */
function speciesMark(): HTMLElement | null {
  return (
    screen
      .queryAllByTitle(/^Species:/m)
      .find((el) => el.tagName === "SPAN") ?? null
  );
}

describe("Term — gene chips", () => {
  it("shows the symbol, not the full name", () => {
    withProviders(
      <Term uri={HUMAN_ESR1}>ESR1 [human] estrogen receptor 1</Term>,
      "human",
    );
    expect(screen.getByText("ESR1")).toBeTruthy();
    expect(screen.queryByText(/estrogen receptor 1/)).toBeNull();
  });

  it("keeps the full name and the species reading in the tooltip", () => {
    const { container } = withProviders(
      <Term uri={HUMAN_ESR1}>ESR1 [human] estrogen receptor 1</Term>,
      "human",
    );
    const chip = container.querySelector("span.term") as HTMLElement;
    expect(chip.title).toContain("ESR1 — estrogen receptor 1");
    expect(chip.title).toContain("matches the dataset");
  });

  it("marks a matching species quietly — no amber", () => {
    withProviders(
      <Term uri={HUMAN_ESR1}>ESR1 [human] estrogen receptor 1</Term>,
      "human",
    );
    const mark = speciesMark();
    expect(mark?.textContent).toBe("H.s.");
    expect(mark?.className).not.toContain("amber");
  });

  it("flags a mouse gene on a human dataset", () => {
    withProviders(
      <Term uri={MOUSE_ESR1}>Esr1 [mouse] estrogen receptor 1 (alpha)</Term>,
      "human",
    );
    const mark = speciesMark();
    expect(mark?.textContent).toBe("M.m.");
    expect(mark?.className).toContain("amber");
    expect(mark?.title).toContain("this dataset is human");
  });

  it("flags a gene whose species can't be determined at all", () => {
    // The common case in stored data: a bare symbol. Unverifiable is
    // not the same as verified, so it gets the same amber.
    withProviders(<Term uri={HUMAN_ESR1}>ESR1</Term>, "human");
    const mark = speciesMark();
    expect(mark?.textContent).toBe("sp?");
    expect(mark?.className).toContain("amber");
  });

  it("states the species without a verdict when there is no dataset", () => {
    withProviders(<Term uri={HUMAN_ESR1}>ESR1 [human] estrogen receptor 1</Term>, null);
    const mark = speciesMark();
    expect(mark?.textContent).toBe("H.s.");
    expect(mark?.className).not.toContain("amber");
  });

  it("leaves non-gene terms exactly as they were", () => {
    withProviders(<Term uri={CELL_TYPE}>astrocyte</Term>, "human");
    expect(screen.getByText("astrocyte")).toBeTruthy();
    expect(speciesMark()).toBeNull();
  });

  it("leaves free text alone — a bare 'ESR1' with no URI is not a gene", () => {
    withProviders(<Term>ESR1</Term>, "human");
    expect(screen.getByText("ESR1")).toBeTruthy();
    expect(speciesMark()).toBeNull();
  });
});
