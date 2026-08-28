/**
 * @vitest-environment jsdom
 *
 * The dashboard quick-search must not call a still-loading catalogue
 * "no matches".
 *
 * ``useDatasets`` pages the WHOLE catalogue (local_api caps limit at
 * 1000, so it loops on offset), which is slow on a cold cache. The
 * readout derived its text from ``matches.length`` alone, and
 * ``matches`` is computed off ``data ?? []`` — so the not-loaded-yet
 * zero and the honest zero rendered identically, and the not-loaded one
 * arrives first. Typing an accession that IS in the catalogue said "no
 * matches" until the pages landed.
 *
 * Submitting in that window was worse than cosmetic: ``runSearch``
 * reads ``matches.length !== 1`` as "not a single hit" and hands off to
 * the browse page, losing the straight jump.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CuratorDashboard } from "./CuratorDashboard";
import type { DatasetSummary } from "@/api/datasets";

// This jsdom has no localStorage (node needs --localstorage-file), and
// the dashboard mounts the theme menu, which reads it. Shimmed HERE
// rather than in test/setup.ts on purpose: a global one would let the
// draft / per-experiment-flag caches persist across the whole suite,
// where today every test starts with them absent.
// The key EXISTS on window here and holds undefined, so test the
// value, not the key.
if (!window.localStorage) {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

// The catalogue query is the thing under test; everything else the
// dashboard mounts is stubbed to keep this about the search readout.
const datasetsState: {
  data: DatasetSummary[] | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: true, isError: false };

vi.mock("@/api/datasets", async (orig) => {
  const actual = await orig<typeof import("@/api/datasets")>();
  return { ...actual, useDatasets: () => datasetsState };
});

vi.mock("@/api/tickets", async (orig) => {
  const actual = await orig<typeof import("@/api/tickets")>();
  return {
    ...actual,
    useTickets: () => ({ data: [], isLoading: false, isFetching: false }),
  };
});

const navigate = vi.fn();
vi.mock("@/routes", async (orig) => {
  const actual = await orig<typeof import("@/routes")>();
  return { ...actual, navigate: (...a: unknown[]) => navigate(...a) };
});

const GSE: DatasetSummary = {
  experiment_id: 8528,
  short_name: "GSE43825",
  title: "Mammary tissue of control mice",
  taxon: "mouse",
  updated_at: null,
  n_factors: 0,
  n_fvs: 0,
  n_biomaterials: 12,
  n_tags: 0,
  troubled: false,
  needs_attention: false,
} as unknown as DatasetSummary;

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CuratorDashboard reviewer="local-curator" onSelect={vi.fn()} />
    </QueryClientProvider>,
  );
  return screen.getByLabelText("Find an experiment");
}

const searchButton = () => screen.getByRole("button", { name: /search/i });

describe("dashboard quick-search — waiting state", () => {
  beforeEach(() => {
    navigate.mockClear();
    datasetsState.data = undefined;
    datasetsState.isLoading = true;
    datasetsState.isError = false;
  });

  it("says it is searching, NOT 'no matches', while the catalogue loads", () => {
    const input = open();
    fireEvent.change(input, { target: { value: "GSE43825" } });
    expect(screen.getByText(/searching…/i)).toBeTruthy();
    expect(screen.queryByText("no matches")).toBeNull();
  });

  it("says 'no matches' once the catalogue is in and really misses", () => {
    datasetsState.data = [GSE];
    datasetsState.isLoading = false;
    const input = open();
    fireEvent.change(input, { target: { value: "GSE000000" } });
    expect(screen.getByText("no matches")).toBeTruthy();
    expect(screen.queryByText(/searching…/i)).toBeNull();
  });

  it("reports a failed catalogue rather than calling it a miss", () => {
    datasetsState.isLoading = false;
    datasetsState.isError = true;
    const input = open();
    fireEvent.change(input, { target: { value: "GSE43825" } });
    // "reach", not "load": remote mode now asks Gemma for the match
    // instead of filtering a catalogue it holds, so the same readout
    // covers a failed search as well as a failed catalogue fetch.
    expect(screen.getByText(/couldn't reach the catalogue/i)).toBeTruthy();
    expect(screen.queryByText("no matches")).toBeNull();
  });

  it("does not bounce to the browse page when submitted mid-load", () => {
    const input = open();
    fireEvent.change(input, { target: { value: "GSE43825" } });
    fireEvent.submit(input.closest("form")!);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("disables the button while the catalogue loads", () => {
    const input = open();
    fireEvent.change(input, { target: { value: "GSE43825" } });
    expect(searchButton().hasAttribute("disabled")).toBe(true);
  });

  it("frees the button once the catalogue is in", () => {
    datasetsState.data = [GSE];
    datasetsState.isLoading = false;
    const input = open();
    fireEvent.change(input, { target: { value: "GSE43825" } });
    expect(searchButton().hasAttribute("disabled")).toBe(false);
    // And the readout now names the single hit it will jump to.
    expect(screen.getByText(/1 match → opens GSE43825/)).toBeTruthy();
  });
});
