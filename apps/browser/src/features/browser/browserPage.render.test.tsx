/**
 * @vitest-environment jsdom
 *
 * The browse page, rendered against a stubbed `/rest/v2`.
 *
 * What this file pins: the rows a payload produces, the search box
 * reaching the server as `query=`, and the paging / sorting controls
 * turning into `offset` / `limit` / `sort` on the wire. None of that is
 * visible in a unit test of `filter.ts`, and the paging half is not
 * visible on screen either — page 2 of a stubbed corpus looks the same
 * as page 1, so the assertion is on the request.
 *
 * Facets, arrival links and the visitor / curator split have their own
 * files beside this one.
 */
import { describe, expect, it, afterEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";

import { paramOf, type GemmaFetchStub } from "../../../test/gemmaFetch";
import { lastRowsRequest, mountBrowser } from "../../../test/browseFixtures";

let stub: GemmaFetchStub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
});

function mount(path = "/browser", opts: Parameters<typeof mountBrowser>[1] = {}) {
  const view = mountBrowser(path, opts);
  stub = view.stub;
  return view;
}

/** The value of `name` on the latest request for the rows. */
const lastParam = (name: string) => paramOf(lastRowsRequest(stub!), name);

describe("browse page", () => {
  it("renders a row per dataset the server returned", async () => {
    mount();
    expect(await screen.findByText("GSE11630")).toBeInTheDocument();
    expect(screen.getByText("GSE270825")).toBeInTheDocument();
    expect(
      screen.getByText("Cortex of the mouse after chronic stress"),
    ).toBeInTheDocument();
  });

  it("counts the corpus from totalElements, not from the rows on the page", async () => {
    mount();
    expect(await screen.findByText("23,549")).toBeInTheDocument();
  });

  it("says No results for an empty answer", async () => {
    mount("/browser", { rows: [], total: 0 });
    expect(await screen.findByText("No results")).toBeInTheDocument();
  });

  it("takes the taxon facet from /datasets/taxa, not from the rows", async () => {
    // 🛑 The facet counts the whole corpus; the rows are one page of
    // it. Deriving the facet from the rows would look right on a first
    // page and be wrong on every other.
    mount();
    await screen.findByText("GSE11630");
    await waitFor(() => expect(stub!.fetched(/\/datasets\/taxa/)).toBe(true));
    expect(await screen.findByText("Mus musculus")).toBeInTheDocument();
  });

  it("sends a typed query to the server as query= on Enter", async () => {
    mount();
    await screen.findByText("GSE11630");
    const box = screen.getByPlaceholderText(/search/i);
    fireEvent.change(box, { target: { value: "coronary" } });
    fireEvent.keyDown(box, { key: "Enter", code: "Enter" });

    await waitFor(() => expect(lastParam("query")).toBe("coronary"));
  });

  it("applies a typed query without Enter, after a pause", async () => {
    // Typing narrows the results on its own — the debounce in
    // SidePanel. Enter only skips the wait (and adds a history entry).
    mount();
    await screen.findByText("GSE11630");
    fireEvent.change(screen.getByPlaceholderText(/search/i), {
      target: { value: "stress" },
    });
    await waitFor(() => expect(lastParam("query")).toBe("stress"), {
      timeout: 2_000,
    });
  });

  it("drops the query from the request when the box is cleared", async () => {
    mount("/browser/q/coronary");
    await waitFor(() => expect(lastParam("query")).toBe("coronary"));
    fireEvent.click(await screen.findByRole("button", { name: "Clear search" }));
    await waitFor(() => expect(lastParam("query")).toBeNull());
  });
});

describe("paging", () => {
  it("asks for the first page of 25", async () => {
    mount();
    await screen.findByText("GSE11630");
    expect(lastParam("offset")).toBe("0");
    expect(lastParam("limit")).toBe("25");
    expect(screen.getByText("1 / 942")).toBeInTheDocument();
  });

  it("asks for the next 25 when the visitor pages forward", async () => {
    mount();
    await screen.findByText("GSE11630");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(lastParam("offset")).toBe("25"));
    expect(screen.getByText("2 / 942")).toBeInTheDocument();
  });

  it("jumps to the last page's offset, not past it", async () => {
    mount("/browser", { total: 60 });
    await screen.findByText("GSE11630");
    fireEvent.click(screen.getByRole("button", { name: "Last page" }));
    await waitFor(() => expect(lastParam("offset")).toBe("50"));
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("goes back to the first page when the page size changes", async () => {
    // Staying on page 3 at the new size would land somewhere the
    // visitor never looked.
    mount();
    await screen.findByText("GSE11630");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(lastParam("offset")).toBe("50"));

    fireEvent.change(screen.getByRole("combobox", { name: "Page size" }), {
      target: { value: "100" },
    });
    await waitFor(() => {
      expect(lastParam("limit")).toBe("100");
      expect(lastParam("offset")).toBe("0");
    });
  });

  it("goes back to the first page when the query changes", async () => {
    mount();
    await screen.findByText("GSE11630");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(lastParam("offset")).toBe("25"));

    const box = screen.getByPlaceholderText(/search/i);
    fireEvent.change(box, { target: { value: "stress" } });
    fireEvent.keyDown(box, { key: "Enter", code: "Enter" });
    await waitFor(() => {
      expect(lastParam("query")).toBe("stress");
      expect(lastParam("offset")).toBe("0");
    });
  });
});

describe("sorting", () => {
  it("sorts by most recently updated unless told otherwise", async () => {
    mount();
    await screen.findByText("GSE11630");
    expect(lastParam("sort")).toBe("-lastUpdated");
    // The column it sorts on says so.
    expect(screen.getByText(/Updated\s*↓/)).toBeInTheDocument();
  });

  it("cycles a column descending → ascending → unsorted", async () => {
    mount();
    await screen.findByText("GSE11630");

    fireEvent.click(screen.getByText(/^Samples/));
    await waitFor(() => expect(lastParam("sort")).toBe("-bioAssays.size"));
    fireEvent.click(screen.getByText(/^Samples/));
    await waitFor(() => expect(lastParam("sort")).toBe("+bioAssays.size"));
    fireEvent.click(screen.getByText(/^Samples/));
    // Unsorted is no parameter at all — the server's own order.
    await waitFor(() => expect(lastParam("sort")).toBeNull());
  });
});

describe("rows", () => {
  it("expands a row to its description on click", async () => {
    mount();
    // The title cell — the short name is a link to the dataset page and
    // stops the row's click.
    fireEvent.click(
      await screen.findByText(/Peripheral blood of patients with coronary/),
    );
    expect(
      await screen.findByText(/Whole blood from 58 patients/),
    ).toBeInTheDocument();
  });

  it("expands every row on the page, and collapses them again", async () => {
    mount();
    await screen.findByText("GSE11630");
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(
      await screen.findByText(/Whole blood from 58 patients/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Prefrontal cortex, 12 animals/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    await waitFor(() =>
      expect(screen.queryByText(/Prefrontal cortex, 12 animals/)).toBeNull(),
    );
  });
});
