/**
 * @vitest-environment jsdom
 *
 * An Enter pressed before the catalogue lands is HELD, not dropped.
 *
 * The submit guard is right — an empty match list on a cold cache is
 * "not loaded", not "no hits", and acting on it bounces a real single
 * hit to the browse page (`dashboardSearchWaiting.render.test.tsx`
 * pins that). But it used to `return` outright, so the keystroke went
 * nowhere and the curator had to press Enter a second time once the
 * count stopped reading "…" — an Enter that does nothing is
 * indistinguishable from one the box never received.
 *
 * Held as the QUERY, not a flag: a curator who keeps typing while it
 * waits has moved on, and firing on the string they no longer mean
 * would navigate somewhere they did not ask for.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ExperimentQuickSearch } from "./ExperimentQuickSearch";
import type { DatasetSummary } from "@/api/datasets";

const datasetsState: {
  data: DatasetSummary[] | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: true, isError: false };

vi.mock("@/api/datasets", async (orig) => {
  const actual = await orig<typeof import("@/api/datasets")>();
  return {
    ...actual,
    useDatasets: () => datasetsState,
    // Local mode: the server search is idle and the client filters the
    // catalogue. Keeps this test about the catalogue's arrival.
    useDatasetSearch: () => ({
      data: undefined,
      isFetching: false,
      isError: false,
    }),
  };
});

// A single hit resolves its ticket context before opening; no open
// tickets means it opens plain, which is the path under test.
vi.mock("@/api/tickets", async (orig) => {
  const actual = await orig<typeof import("@/api/tickets")>();
  return {
    ...actual,
    experimentTicketsQueryOptions: (id: number | string) => ({
      queryKey: ["tickets", id],
      queryFn: async () => [],
    }),
  };
});

const navigate = vi.fn();
vi.mock("@/routes", async (orig) => {
  const actual = await orig<typeof import("@/routes")>();
  return { ...actual, navigate: (...a: unknown[]) => navigate(...a) };
});

const GSE = {
  experiment_id: 8528,
  short_name: "GSE43825",
  title: "Mammary tissue of control mice",
  taxon: "mouse",
} as unknown as DatasetSummary;

function open() {
  const onSelect = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <ExperimentQuickSearch onSelect={onSelect} />
    </QueryClientProvider>,
  );
  const input = screen.getByLabelText("Find an experiment");
  /** Land the catalogue and re-render, the way a resolving query would. */
  const landCatalogue = () => {
    datasetsState.data = [GSE];
    datasetsState.isLoading = false;
    view.rerender(
      <QueryClientProvider client={qc}>
        <ExperimentQuickSearch onSelect={onSelect} />
      </QueryClientProvider>,
    );
  };
  return { input, onSelect, landCatalogue };
}

describe("quick-search — Enter pressed before the catalogue lands", () => {
  beforeEach(() => {
    navigate.mockClear();
    datasetsState.data = undefined;
    datasetsState.isLoading = true;
    datasetsState.isError = false;
  });

  it("opens the single hit once the catalogue arrives — no second Enter", async () => {
    const { input, onSelect, landCatalogue } = open();
    fireEvent.change(input, { target: { value: "GSE43825" } });
    fireEvent.submit(input.closest("form")!);
    // Still nothing to match against: it must not guess.
    expect(onSelect).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();

    landCatalogue();
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(8528));
    // The straight jump, not the browse-page fallback.
    expect(navigate).not.toHaveBeenCalled();
  });

  it("says the Enter was received rather than looking idle", () => {
    const { input } = open();
    fireEvent.change(input, { target: { value: "GSE43825" } });
    expect(screen.getByText(/^searching…$/)).toBeTruthy();
    fireEvent.submit(input.closest("form")!);
    expect(screen.getByText(/searching, then opening…/)).toBeTruthy();
  });

  it("drops the held Enter if the curator types something else", async () => {
    const { input, onSelect, landCatalogue } = open();
    fireEvent.change(input, { target: { value: "GSE43825" } });
    fireEvent.submit(input.closest("form")!);
    // Changed their mind before the catalogue landed.
    fireEvent.change(input, { target: { value: "GSE999" } });
    landCatalogue();
    await waitFor(() =>
      expect(screen.queryByText(/searching, then opening…/)).toBeNull(),
    );
    // Neither the old intent nor a surprise navigation.
    expect(onSelect).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("still hands a MISS to the browse page when Enter was held", async () => {
    const { input, onSelect, landCatalogue } = open();
    fireEvent.change(input, { target: { value: "GSE000000" } });
    fireEvent.submit(input.closest("form")!);
    landCatalogue();
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        "#/all-experiments?q=GSE000000",
      ),
    );
    expect(onSelect).not.toHaveBeenCalled();
  });
});
