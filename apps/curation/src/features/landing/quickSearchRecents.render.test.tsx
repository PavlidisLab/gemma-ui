/**
 * @vitest-environment jsdom
 *
 * The "recent" list under the quick-search box — the datasets this
 * browser has opened, offered on an empty, focused box.
 *
 * What is pinned here is the part that can go wrong without looking
 * wrong: a pick has to go through the same open path as a single search
 * hit (ticket context and all), Enter on a highlighted row must open it
 * rather than fall through to the form's submit (which sends an empty
 * box to the browse page), and typing has to put the list away.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ExperimentQuickSearch } from "./ExperimentQuickSearch";
import { pushRecentExperiment } from "./recentExperiments";
import type { DatasetSummary } from "@/api/datasets";

const datasetsState: {
  data: DatasetSummary[] | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: [], isLoading: false, isError: false };

vi.mock("@/api/datasets", async (orig) => {
  const actual = await orig<typeof import("@/api/datasets")>();
  return {
    ...actual,
    useDatasets: () => datasetsState,
    useDatasetSearch: () => ({
      data: undefined,
      isFetching: false,
      isError: false,
    }),
  };
});

const openTickets = vi.fn(async () => [] as unknown[]);
vi.mock("@/api/tickets", async (orig) => {
  const actual = await orig<typeof import("@/api/tickets")>();
  return {
    ...actual,
    experimentTicketsQueryOptions: (id: number | string) => ({
      queryKey: ["tickets", id],
      queryFn: () => openTickets(),
    }),
  };
});

const navigate = vi.fn();
vi.mock("@/routes", async (orig) => {
  const actual = await orig<typeof import("@/routes")>();
  return { ...actual, navigate: (...a: unknown[]) => navigate(...a) };
});

/** This jsdom has no `localStorage`; the module treats that as "no
 *  recents", so the stub is what makes the list exist at all. */
let store: Record<string, string> = {};
beforeEach(() => {
  store = {};
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = String(v);
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        store = {};
      },
    },
  });
  navigate.mockClear();
  openTickets.mockClear();
  datasetsState.data = [];
  datasetsState.isLoading = false;
});

function open(props: Partial<
  React.ComponentProps<typeof ExperimentQuickSearch>
> = {}) {
  const onSelect = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ExperimentQuickSearch onSelect={onSelect} {...props} />
    </QueryClientProvider>,
  );
  const input = screen.getByLabelText("Find an experiment");
  return { input, onSelect };
}

describe("quick-search — recent datasets", () => {
  it("offers them newest-first on an empty, focused box", () => {
    pushRecentExperiment({ id: "1", label: "GSE1" });
    pushRecentExperiment({ id: "2", label: "GSE2", taxon: "mouse" });
    const { input } = open();
    // Nothing until the box is focused — the dashboard row would
    // otherwise sit permanently under a panel of links.
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.focus(input);
    const rows = screen.getAllByRole("option");
    expect(rows.map((r) => r.textContent)).toEqual(["GSE2mouse", "GSE1"]);
  });

  it("says so when there is nothing yet instead of rendering nothing at all", () => {
    // 🛑 The case that shipped broken: on an experiment page the one
    // recorded visit is the dataset on screen, which the header box
    // excludes — so a focused box rendered NOTHING, which reads as the
    // feature not working rather than as an empty list.
    pushRecentExperiment({ id: "2", label: "GSE2" });
    const { input } = open({ excludeExperimentId: 2 });
    fireEvent.focus(input);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByText(/apart from this one/)).toBeTruthy();
  });

  it("does not offer to clear a list with nothing in it", () => {
    const { input } = open();
    fireEvent.focus(input);
    expect(screen.getByText(/Datasets you open show up here\./)).toBeTruthy();
    expect(screen.queryByTitle(/Forget the datasets/)).toBeNull();
  });

  it("opens a clicked row through the ticket-resolving path", async () => {
    pushRecentExperiment({ id: "8528", label: "GSE43825" });
    const { input, onSelect } = open();
    fireEvent.focus(input);
    fireEvent.click(screen.getByText("GSE43825"));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("8528"));
    expect(openTickets).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("Enter on an arrowed-to row opens it instead of submitting the empty box", async () => {
    pushRecentExperiment({ id: "1", label: "GSE1" });
    pushRecentExperiment({ id: "2", label: "GSE2" });
    const { input, onSelect } = open();
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("1"));
    // An empty box that submits goes to the browse page; the row must
    // win that race.
    expect(navigate).not.toHaveBeenCalled();
  });

  it("puts the list away once the curator types", () => {
    pushRecentExperiment({ id: "1", label: "GSE1" });
    const { input } = open();
    fireEvent.focus(input);
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.change(input, { target: { value: "GSE" } });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("does not offer the experiment already on screen", () => {
    pushRecentExperiment({ id: "1", label: "GSE1" });
    pushRecentExperiment({ id: "2", label: "GSE2" });
    const { input } = open({ excludeExperimentId: 2 });
    fireEvent.focus(input);
    expect(screen.getAllByRole("option").map((r) => r.textContent)).toEqual([
      "GSE1",
    ]);
  });

  it("prefers the catalogue's current accession over the stored one", () => {
    pushRecentExperiment({ id: "1", label: "GSE1-as-stored" });
    datasetsState.data = [
      {
        experiment_id: 1,
        short_name: "GSE1-renamed",
        title: "a title",
      } as unknown as DatasetSummary,
    ];
    const { input } = open();
    fireEvent.focus(input);
    expect(screen.getByText("GSE1-renamed")).toBeTruthy();
    expect(screen.queryByText("GSE1-as-stored")).toBeNull();
  });

  it("clears on request", () => {
    pushRecentExperiment({ id: "1", label: "GSE1" });
    const { input } = open();
    fireEvent.focus(input);
    fireEvent.click(screen.getByTitle(/Forget the datasets/));
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
