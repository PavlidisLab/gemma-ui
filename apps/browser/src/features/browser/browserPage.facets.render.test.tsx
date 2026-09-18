/**
 * @vitest-environment jsdom
 *
 * The side panel's facets, clicked.
 *
 * Every facet answers "how many datasets would I leave you with", so
 * each one asks the server under the CURRENT filter minus its own
 * clauses — a taxon facet narrowed by the taxon just ticked would show
 * one row with the full count and hide the alternatives. That rule is
 * implemented once per facet in `endpoints.ts` (strip `taxon.`, strip
 * `bioAssays.arrayDesignUsed.`, strip the library-strategy clause, strip
 * `allCharacteristics.`), and nothing on screen shows whether it held.
 * The specs below tick something and then read both the rows' filter
 * and the facet's own.
 */
import { describe, expect, it, afterEach } from "vitest";
import { screen, waitFor, fireEvent, within } from "@testing-library/react";

import { filterOf, paramOf, type GemmaFetchStub } from "../../../test/gemmaFetch";
import {
  BRAIN,
  lastRowsFilter,
  lastRowsRequest,
  mountBrowser,
  ORGANISM_PART,
} from "../../../test/browseFixtures";

let stub: GemmaFetchStub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
});

async function mount(path = "/browser") {
  const view = mountBrowser(path);
  stub = view.stub;
  await screen.findByText("GSE11630");
  return view;
}

/** The filter of the latest request to a facet route. */
function lastFilter(route: RegExp): string {
  const all = stub!.requests(route);
  return all.length ? filterOf(all[all.length - 1]) : "";
}

/** The checkbox on the facet row whose label contains `text`. */
async function rowCheckbox(text: string | RegExp): Promise<HTMLInputElement> {
  const label = await screen.findByText(text);
  return label.closest("li")!.querySelector<HTMLInputElement>("input[type=checkbox]")!;
}

const TAXA_FACET = /\/rest\/v2\/datasets\/taxa/;
const CATEGORY_FACET = /\/rest\/v2\/datasets\/categories/;
const COUNT = /\/rest\/v2\/datasets\/count/;

describe("taxa", () => {
  it("one taxon filters the rows by id", async () => {
    await mount();
    fireEvent.click(await rowCheckbox("Mus musculus"));
    await waitFor(() => expect(lastRowsFilter(stub!)).toContain("taxon.id = 2"));
  });

  it("two taxa are one ORed clause", async () => {
    await mount();
    fireEvent.click(await rowCheckbox("Mus musculus"));
    await waitFor(() => expect(lastRowsFilter(stub!)).toContain("taxon.id = 2"));
    fireEvent.click(await rowCheckbox("Homo sapiens"));
    await waitFor(() =>
      expect(lastRowsFilter(stub!)).toContain("taxon.id in (2,1)"),
    );
  });

  it("the taxa facet is not narrowed by the taxon just ticked", async () => {
    await mount();
    fireEvent.click(await rowCheckbox("Mus musculus"));
    await waitFor(() => expect(lastRowsFilter(stub!)).toContain("taxon.id = 2"));
    // The taxa facet re-asks under the new filter — but without its
    // own clause, so human stays on offer with its real count.
    await waitFor(() =>
      expect(stub!.requests(TAXA_FACET).length).toBeGreaterThan(1),
    );
    expect(lastFilter(TAXA_FACET)).not.toContain("taxon.");
    // Every other facet IS narrowed by it.
    expect(lastFilter(CATEGORY_FACET)).toContain("taxon.id = 2");
  });

  it("Clear unticks every taxon", async () => {
    await mount("/browser/t/mouse");
    await waitFor(() => expect(lastRowsFilter(stub!)).toContain("taxon.id = 2"));
    const section = screen.getByText("Taxa").closest("section")!;
    fireEvent.click(within(section).getByRole("button", { name: "Clear" }));
    // Back to a filter already asked for, so the answer comes from the
    // cache and there is no new request to read. The page says it.
    await waitFor(() => expect(screen.queryByText(/Filters applied/)).toBeNull());
    expect(await rowCheckbox("Mus musculus")).not.toBeChecked();
  });
});

describe("annotations", () => {
  const TERM_CLAUSE = `allCharacteristics.valueUri in (${BRAIN}) and allCharacteristics.categoryUri = ${ORGANISM_PART}`;

  /** The Brain row's tri-state button, once it is clickable. Looked up
   *  afresh each time: a picked term moves into the category's
   *  "selected" band, which is a different list, so the row remounts —
   *  and the tree disables its buttons while the facet refetches. */
  async function brainButton(): Promise<HTMLElement> {
    let button: HTMLElement | null = null;
    await waitFor(() => {
      // "Brain" is also written on the selection's chip; the tree row is
      // the one carrying the term's count.
      const row = screen.getByText("≥900").closest("li")!;
      button = within(row).getByRole("button");
      expect(button).toBeEnabled();
    });
    return button!;
  }

  async function openOrganismParts() {
    fireEvent.click(await screen.findByText("Organism Parts"));
    await screen.findByText("Brain");
  }

  it("cycles a term: include → exclude → neither", async () => {
    await mount();
    await openOrganismParts();

    fireEvent.click(await brainButton());
    await waitFor(() => expect(lastRowsFilter(stub!)).toContain(`any(${TERM_CLAUSE})`));
    expect(await brainButton()).toHaveAttribute("title", expect.stringMatching(/^Selected/));

    fireEvent.click(await brainButton());
    await waitFor(() => expect(lastRowsFilter(stub!)).toContain(`none(${TERM_CLAUSE})`));
    expect(lastRowsFilter(stub!)).not.toContain(`any(${TERM_CLAUSE})`);
    expect(await brainButton()).toHaveAttribute("title", expect.stringMatching(/^Negated/));

    // Back to no selection — a filter the page already asked for, so
    // it is answered from the cache. The page says it.
    fireEvent.click(await brainButton());
    await waitFor(() => expect(screen.queryByText(/Filters applied/)).toBeNull());
    expect(await brainButton()).toHaveAttribute("title", "Click to select");
  });

  it("the category facet is not narrowed by a term picked from it", async () => {
    // Otherwise picking `brain` would hide every other organism part —
    // and the category itself, with the way back to unpick it.
    await mount();
    await openOrganismParts();
    fireEvent.click(await brainButton());
    await waitFor(() => expect(lastRowsFilter(stub!)).toContain(BRAIN));
    await waitFor(() =>
      expect(stub!.requests(CATEGORY_FACET).length).toBeGreaterThan(1),
    );
    expect(lastFilter(CATEGORY_FACET)).not.toContain("allCharacteristics");
  });

  it("marks the category that holds a selection, even folded", async () => {
    await mount();
    await openOrganismParts();
    fireEvent.click(await brainButton());
    await waitFor(() => expect(lastRowsFilter(stub!)).toContain(BRAIN));
    // Fold it; the count and the term's name stay on the header.
    fireEvent.click(screen.getByText("Organism Parts"));
    expect(await screen.findByLabelText("1 selected")).toBeInTheDocument();
  });
});

describe("platforms and library strategies", () => {
  it("Two-colour is a library-strategy clause, and a chip in the header", async () => {
    await mount();
    fireEvent.click(await screen.findByText("Microarray"));
    fireEvent.click(await rowCheckbox("Two-colour"));
    await waitFor(() =>
      expect(lastRowsFilter(stub!)).toContain(
        "bioAssays.libraryStrategy in (MICROARRAY_TWO_COLOR)",
      ),
    );
    expect(
      screen.getByRole("button", { name: "Clear the Two-colour microarray filter" }),
    ).toBeInTheDocument();
  });

  it("counts each strategy without the strategy already ticked", async () => {
    // With Two-colour ticked, One-colour must still count its own
    // datasets — not zero, which is what ANDing both would give.
    await mount();
    fireEvent.click(await screen.findByText("Microarray"));
    fireEvent.click(await rowCheckbox("Two-colour"));
    await waitFor(() =>
      expect(lastRowsFilter(stub!)).toContain("MICROARRAY_TWO_COLOR"),
    );
    await waitFor(() => {
      const oneColour = stub!
        .requests(COUNT)
        .map(filterOf)
        .filter((f) => f.includes("in (MICROARRAY_ONE_COLOR)"));
      expect(oneColour.length).toBeGreaterThan(1);
      expect(oneColour[oneColour.length - 1]).not.toContain("MICROARRAY_TWO_COLOR");
    });
    const row = (await screen.findByText("One-colour")).closest("li")!;
    expect(within(row).getByText("7,000")).toBeInTheDocument();
  });

  it("hides a strategy with no datasets under the filter", async () => {
    await mount();
    // RNA-Seq starts open; its Other row holds the rarer strategies.
    fireEvent.click(await screen.findByTitle("Other — expand for its types"));
    // Until its count arrives a row is shown with a blank count — the
    // facet cannot yet know it is empty. Wait for the answers.
    const mirna = (await screen.findByText("miRNA-Seq")).closest("li")!;
    await waitFor(() => expect(within(mirna).getByText("40")).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText("ssRNA-seq")).toBeNull());
    expect(screen.queryByText("Ribo-Seq")).toBeNull();
  });

  it("sums a technology group once per type, not once per platform", async () => {
    // `numberOfExpressionExperimentsForTechnologyType` repeats on every
    // platform of the type. Microarray is ONECOLOR 7,000 + TWOCOLOR 800.
    await mount();
    const row = (await screen.findByText("Microarray")).closest("li")!;
    expect(within(row).getByText("7,800")).toBeInTheDocument();
  });

  it("a platform ticked under a channel filters on the platform's id", async () => {
    await mount();
    fireEvent.click(await screen.findByText("Microarray"));
    fireEvent.click(await screen.findByTitle("Two-colour — expand for individual platforms"));
    fireEvent.click(await rowCheckbox(/GPL6480/));
    await waitFor(() =>
      expect(lastRowsFilter(stub!)).toContain("bioAssays.arrayDesignUsed.id in (7)"),
    );
  });
});

describe("Clear all", () => {
  it("drops the query and every filter", async () => {
    await mount("/browser/t/mouse/q/stress");
    await waitFor(() => expect(lastRowsFilter(stub!)).toContain("taxon.id = 2"));
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    await waitFor(() => {
      expect(lastRowsFilter(stub!)).not.toContain("taxon.");
      expect(paramOf(lastRowsRequest(stub!), "query")).toBeNull();
    });
  });
});
