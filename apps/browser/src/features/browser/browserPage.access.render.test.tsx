/**
 * @vitest-environment jsdom
 *
 * Who is looking, and what happens when the server says no.
 *
 * Visitor and curator get different result sets from the same page: a
 * visitor's filter carries `curatorOnlyLibraryStrategyClause`, which
 * hides the datasets whose every sample is OTHER or CHIP_SEQ; a curator
 * sees them, marked. Neither half is visible on screen without the
 * other to compare against, so the specs read the filter.
 *
 * The failure half: every browse query used to render a failure as a
 * zero — an empty table, facet counts of 0 — so a broken request looked
 * exactly like a corpus with nothing in it. Gemma also answers an XHR
 * error with HTTP 200 and the error in the body (see `client.ts`), so
 * the stub serves it that way.
 */
import { describe, expect, it, afterEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

import { envelope, type GemmaFetchStub } from "../../../test/gemmaFetch";
import {
  CURATOR,
  lastRowsFilter,
  mountBrowser,
  type BrowseOptions,
} from "../../../test/browseFixtures";

let stub: GemmaFetchStub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
});

function mount(opts: BrowseOptions = {}) {
  const view = mountBrowser("/browser", opts);
  stub = view.stub;
  return view;
}

const HIDING_CLAUSE =
  "none(bioAssays.libraryStrategy in (OTHER,CHIP_SEQ)) or any(bioAssays.libraryStrategy not in (OTHER,CHIP_SEQ))";

/** The curator-only listing: same path as the rows, sorted by id. */
const CURATOR_ONLY_LISTING = /\/rest\/v2\/datasets\?.*sort=%2Bid/;

describe("a visitor", () => {
  it("is not sent the datasets whose samples are all OTHER or CHIP_SEQ", async () => {
    mount();
    await screen.findByText("GSE11630");
    expect(lastRowsFilter(stub!)).toContain(HIDING_CLAUSE);
  });

  it("does not fetch the list of hidden datasets", async () => {
    // Nothing on a visitor's page uses it, and it pages the whole set.
    mount();
    await screen.findByText("GSE11630");
    expect(stub!.fetched(CURATOR_ONLY_LISTING)).toBe(false);
  });

  it("is not offered the curator-only library strategies", async () => {
    mount();
    await screen.findByText("GSE11630");
    await screen.findByText("Microarray");
    expect(screen.queryByTitle("OTHER")).toBeNull();
    expect(screen.queryByTitle("CHIP_SEQ")).toBeNull();
  });
});

describe("a curator", () => {
  it("is sent everything", async () => {
    mount({ me: CURATOR });
    await screen.findByText("GSE11630");
    await waitFor(() => expect(lastRowsFilter(stub!)).not.toContain(HIDING_CLAUSE));
  });

  it("sees which rows a visitor would not", async () => {
    mount({ me: CURATOR });
    await waitFor(() => expect(stub!.fetched(CURATOR_ONLY_LISTING)).toBe(true));
    const row = (await screen.findByText("GSE270825")).closest("tr")!;
    await waitFor(() =>
      expect(
        within(row).getByTitle(/Hidden from visitors who are not curators/),
      ).toBeInTheDocument(),
    );
    const other = (await screen.findByText("GSE11630")).closest("tr")!;
    expect(within(other).queryByTitle(/Hidden from visitors/)).toBeNull();
  });

  it("is offered the curator-only library strategies, marked as such", async () => {
    mount({ me: CURATOR });
    await screen.findByText("GSE11630");
    const chip = await screen.findByTitle("CHIP_SEQ");
    expect(within(chip).getByText("ChIP-Seq")).toBeInTheDocument();
    expect(within(chip).getByText("curators")).toBeInTheDocument();
  });
});

describe("when a browse query fails", () => {
  /** Gemma's XHR error: a 200 whose body is the error. */
  const xhrError = (code: number, message: string) => ({
    error: { code, message },
  });

  it("names the query and shows the server's message, instead of 'No results'", async () => {
    mount({
      extra: [
        {
          match: /\/rest\/v2\/datasets(\?|$)/,
          body: xhrError(400, "Unsupported filter property."),
        },
      ],
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Browse query failed: datasets.");
    expect(alert).toHaveTextContent("Unsupported filter property.");
    expect(alert).toHaveTextContent("Counts and results below are missing, not zero.");
    expect(screen.getByText("Results unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No results")).toBeNull();
  });

  it("names only the ones that failed", async () => {
    mount({
      extra: [
        { match: /\/rest\/v2\/datasets\/taxa/, body: envelope(null), status: 503 },
      ],
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Browse query failed: taxa.");
    // The rows still came back, and still show.
    expect(await screen.findByText("GSE11630")).toBeInTheDocument();
  });

  it("says so once when everything failed", async () => {
    // One cause, one banner — a shared cause is the usual case.
    mount({
      extra: [
        {
          match: /\/rest\/v2\/datasets/,
          body: xhrError(401, "Full authentication is required."),
        },
      ],
    });
    // The six queries fail one by one; the banner lists them until the
    // last one lands.
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent("Every browse query failed."));
    // The message appears once, not once per query.
    expect(
      alert.textContent!.split("Full authentication is required.").length - 1,
    ).toBe(1);
  });

  it("does not print a proxy's error page into the banner", async () => {
    mount({
      extra: [
        {
          match: /\/rest\/v2\/datasets(\?|$)/,
          body: "<html><body><h1>502 Bad Gateway</h1></body></html>",
          status: 502,
        },
      ],
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Browse query failed: datasets.");
    expect(alert).toHaveTextContent("502");
    expect(alert.textContent).not.toContain("<html>");
    expect(alert.textContent).not.toContain("Bad Gateway");
  });
});
