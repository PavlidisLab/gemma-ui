/**
 * @vitest-environment jsdom
 *
 * "+ Import experiment" is a local-mode affordance.
 *
 * The import copies an experiment out of Gemma into the local store.
 * In remote mode that experiment IS the source — there is nothing to
 * import, and the route would happily re-import a dataset over itself.
 * The server does not guard this (its own note calls it "local mode
 * only, by nature rather than by a guard"), so the gate lives here and
 * is the only thing standing between a remote curator and a button
 * that means nothing.
 *
 * Also pinned: the header's right-alignment survives the gate. The
 * `ml-auto` that pushes the buttons rightward sits on whichever one
 * comes first, so it has to move to the screening button when the
 * import button is absent.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CuratorDashboard } from "./CuratorDashboard";

// Same shim as dashboardSearchWaiting: this jsdom has no localStorage
// and the dashboard mounts the theme menu, which reads it.
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

const modeState = { mode: "local" as "local" | "remote" };

vi.mock("@/lib/gemmaMode", async (orig) => {
  const actual = await orig<typeof import("@/lib/gemmaMode")>();
  return {
    ...actual,
    useGemmaMode: () => ({ ...actual.resolveGemmaMode(), mode: modeState.mode }),
  };
});

vi.mock("@/api/datasets", async (orig) => {
  const actual = await orig<typeof import("@/api/datasets")>();
  return {
    ...actual,
    useDatasets: () => ({ data: [], isLoading: false, isError: false }),
  };
});

vi.mock("@/api/tickets", async (orig) => {
  const actual = await orig<typeof import("@/api/tickets")>();
  return {
    ...actual,
    useTickets: () => ({ data: [], isLoading: false, isFetching: false }),
  };
});

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CuratorDashboard reviewer="local-curator" onSelect={vi.fn()} />
    </QueryClientProvider>,
  );
}

const importButton = () =>
  screen.queryByRole("button", { name: /import experiment/i });
const screeningButton = () =>
  screen.getByRole("button", { name: /new screening ticket/i });

describe("dashboard — import-experiment gate", () => {
  beforeEach(() => {
    modeState.mode = "local";
  });

  it("offers the import button in local mode", () => {
    open();
    expect(importButton()).toBeTruthy();
  });

  it("hides it in remote mode, where there is nothing to import", () => {
    modeState.mode = "remote";
    open();
    expect(importButton()).toBeNull();
    // The rest of the header is untouched.
    expect(screeningButton()).toBeTruthy();
  });

  it("moves ml-auto onto the screening button when the import one is gone", () => {
    modeState.mode = "remote";
    open();
    expect(screeningButton().className).toContain("ml-auto");
  });

  it("leaves ml-auto on the import button when both are shown", () => {
    open();
    expect(importButton()!.className).toContain("ml-auto");
    expect(screeningButton().className).not.toContain("ml-auto");
  });
});
