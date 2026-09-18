/**
 * @vitest-environment jsdom
 *
 * Arriving at the browse page from a link.
 *
 * Most visitors do not start from an empty /browser. They come from the
 * home page's charts (`?updatedSince=`, `?categoryUri=`,
 * `?annotationUri=`, `/browser/rnaseq`), from a taxon route, from a
 * platform page's "open in browser", or from someone's "Copy link"
 * (`?s=`). Each of those seeds the search state once, on mount, and a
 * link that seeds nothing still renders a perfectly plausible page —
 * the whole unfiltered corpus. So every spec here reads the FILTER the
 * rows were requested with, not just the screen.
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";

import { paramOf, type GemmaFetchStub } from "../../../test/gemmaFetch";
import {
  BRAIN,
  GPL6480,
  lastRowsFilter,
  lastRowsRequest,
  mountBrowser,
  ORGANISM_PART,
} from "../../../test/browseFixtures";
import { emptySearchSettings } from "@/lib/types";
import { decodeSearchSettings, encodeSearchSettings } from "./shareLink";

let stub: GemmaFetchStub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
});

function mount(path: string) {
  const view = mountBrowser(path);
  stub = view.stub;
  return view;
}

/** Settle on the rows, then hand back the filter they were asked for. */
async function rowsFilter(): Promise<string> {
  await screen.findByText("GSE11630");
  return lastRowsFilter(stub!);
}

describe("taxon routes", () => {
  it("/browser/t/<common name> filters to that taxon once the taxa load", async () => {
    // The route names the taxon; its id comes from /datasets/taxa, so
    // the clause can only be added after that answers.
    mount("/browser/t/mouse");
    await screen.findByText("GSE11630");
    await waitFor(() => expect(lastRowsFilter(stub!)).toContain("taxon.id = 2"));
  });

  it("/browser/t/<id> works too", async () => {
    mount("/browser/t/1");
    await screen.findByText("GSE11630");
    await waitFor(() => expect(lastRowsFilter(stub!)).toContain("taxon.id = 1"));
  });

  it("an unknown taxon filters nothing rather than everything", async () => {
    mount("/browser/t/unicorn");
    expect(await rowsFilter()).not.toContain("taxon.id");
  });

  it("carries the query on /browser/t/<taxon>/q/<query>", async () => {
    mount("/browser/t/mouse/q/stress");
    await screen.findByText("GSE11630");
    await waitFor(() => {
      expect(lastRowsFilter(stub!)).toContain("taxon.id = 2");
      expect(paramOf(lastRowsRequest(stub!), "query")).toBe("stress");
    });
  });
});

describe("presets", () => {
  it("/browser/twocolor filters on the two-colour library strategy, with a chip to clear it", async () => {
    mount("/browser/twocolor");
    expect(await rowsFilter()).toContain(
      "bioAssays.libraryStrategy in (MICROARRAY_TWO_COLOR)",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Clear the Two-colour microarray filter",
      }),
    );
    await waitFor(() =>
      expect(lastRowsFilter(stub!)).not.toContain("MICROARRAY_TWO_COLOR"),
    );
  });

  it("/browser/rnaseq filters on the sequencing technology type", async () => {
    mount("/browser/rnaseq");
    expect(await rowsFilter()).toMatch(/technologyType in \(SEQUENCING\)/);
  });

  it("/browser/microarray filters on every microarray technology type", async () => {
    mount("/browser/microarray");
    expect(await rowsFilter()).toMatch(
      /technologyType in \(ONECOLOR,TWOCOLOR,DUALMODE\)/,
    );
  });
});

describe("?updatedSince=", () => {
  it("adds a lastUpdated clause and a chip that removes it", async () => {
    mount("/browser?updatedSince=2026-09-01");
    expect(await rowsFilter()).toContain("lastUpdated > 2026-09-01");
    expect(screen.getByText("Updated since 2026-09-01")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Clear the updated-since filter" }),
    );
    await waitFor(() =>
      expect(lastRowsFilter(stub!)).not.toContain("lastUpdated"),
    );
    expect(screen.queryByText("Updated since 2026-09-01")).toBeNull();
  });

  it("ignores anything that is not a bare ISO date", async () => {
    // It goes straight into a filter clause.
    mount("/browser?updatedSince=2026-09-01%20or%20id%20%3E%200");
    expect(await rowsFilter()).not.toContain("lastUpdated");
    expect(screen.queryByText(/Updated since/)).toBeNull();
  });
});

describe("?sort=", () => {
  it("replaces the default sort", async () => {
    mount("/browser?sort=-id");
    await screen.findByText("GSE11630");
    expect(paramOf(lastRowsRequest(stub!), "sort")).toBe("-id");
  });
});

describe("?categoryUri= and ?annotationUri=", () => {
  it("a category link includes the whole category", async () => {
    mount(
      `/browser?categoryUri=${encodeURIComponent(ORGANISM_PART)}&categoryLabel=organism%20part`,
    );
    expect(await rowsFilter()).toContain(
      `allCharacteristics.categoryUri = ${ORGANISM_PART}`,
    );
  });

  it("a term link binds the term to its category, not to the dataset at large", async () => {
    // A term matches only where it is annotated under the category it
    // was picked from. Unbound, `brain` would match a dataset that
    // mentions brain anywhere at all.
    mount(
      `/browser?annotationUri=${encodeURIComponent(BRAIN)}&annotationLabel=brain` +
        `&categoryUri=${encodeURIComponent(ORGANISM_PART)}&categoryLabel=organism%20part`,
    );
    const f = await rowsFilter();
    expect(f).toContain(
      `any(allCharacteristics.valueUri in (${BRAIN}) and allCharacteristics.categoryUri = ${ORGANISM_PART})`,
    );
    // The term, not the whole category.
    expect(f).not.toContain(`[allCharacteristics.categoryUri = ${ORGANISM_PART}]`);
  });

  it("ignores a URI that is not http(s)", async () => {
    mount("/browser?annotationUri=javascript%3Aalert(1)");
    expect(await rowsFilter()).not.toContain("allCharacteristics");
  });
});

describe("shared links (?s=)", () => {
  it("names a platform the link carried as a bare id, once the facet has it", async () => {
    // A shared link encodes platforms by id alone. Until the platform
    // list arrives the filter description can only say "7"; after, it
    // should say which platform that is.
    const s = encodeSearchSettings({
      ...emptySearchSettings(),
      platforms: [{ id: GPL6480.id }],
    });
    mount(`/browser?s=${s}`);
    expect(await rowsFilter()).toContain(
      `bioAssays.arrayDesignUsed.id in (${GPL6480.id})`,
    );
    const summary = await screen.findByText(/Filters applied: platforms/);
    await waitFor(() =>
      expect(summary).toHaveAttribute(
        "title",
        expect.stringContaining(GPL6480.name),
      ),
    );
  });

  it("a link this app did not write loads the unfiltered page", async () => {
    mount("/browser?s=not-a-link-we-wrote");
    expect(await rowsFilter()).not.toMatch(/taxon|arrayDesignUsed|allCharacteristics/);
  });
});

describe("Copy link", () => {
  afterEach(() => {
    // jsdom has no clipboard; the specs below install one.
    delete (navigator as unknown as Record<string, unknown>).clipboard;
  });

  function installClipboard(writeText: (s: string) => Promise<void>) {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  }

  it("writes a link that reproduces the current filters and sort", async () => {
    const writeText = vi.fn(async (_: string) => {});
    installClipboard(writeText);
    mount("/browser");
    await screen.findByText("GSE11630");

    // Pick a taxon in the side panel, so there is something to share.
    const mouseRow = (await screen.findByText("Mus musculus")).closest("li")!;
    fireEvent.click(mouseRow.querySelector("input[type=checkbox]")!);
    await waitFor(() => expect(lastRowsFilter(stub!)).toContain("taxon.id = 2"));

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByText("Link copied")).toBeInTheDocument();

    const url = writeText.mock.calls[0][0];
    // Deployed, the router is hash-based and the params live inside the
    // fragment; under test it is a memory history and they do not.
    // `hashRouting.test.ts` pins the hash shape; this reads either.
    const inner = new URL(url.includes("#") ? url.split("#")[1] : url, "http://x");
    expect(inner.pathname).toBe("/browser");
    expect(inner.searchParams.get("sort")).toBe("-lastUpdated");
    const decoded = decodeSearchSettings(inner.searchParams.get("s")!);
    expect(decoded?.taxon?.map((t) => t.id)).toEqual([2]);
  });

  it("says so when the clipboard refuses", async () => {
    installClipboard(async () => {
      throw new Error("denied");
    });
    mount("/browser");
    await screen.findByText("GSE11630");
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByText("Copy failed")).toBeInTheDocument();
  });
});
