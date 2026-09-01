/**
 * @vitest-environment jsdom
 *
 * "Under curation" — three states that must never collapse.
 *
 * The one that matters: when the listing route does not exist, the panel
 * must NOT render "nothing is under curation". That sentence is a
 * confident all-clear, and we would be saying it about a question we
 * could not ask. An empty list from a working route is a real answer
 * about a quiet corpus; the two look identical in the data and must not
 * look identical on screen.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { LOCKS_ROUTE_ABSENT } from "@/api/curationLock";
import { UnderCurationPanel } from "./UnderCurationPanel";

const result = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/api/curationLock", async (orig) => {
  const actual = await orig<typeof import("@/api/curationLock")>();
  return { ...actual, getActiveCurationLocks: () => Promise.resolve(result.current) };
});

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <UnderCurationPanel />
    </QueryClientProvider>,
  );
}

const lock = (over: Record<string, unknown> = {}) => ({
  experiment_id: 1658,
  experiment_short_name: "GSE11630",
  locked: true,
  locked_by: "alice",
  locked_at: new Date().toISOString(),
  expires_at: null,
  stolen_from: null,
  stolen_at: null,
  ...over,
});

describe("Under curation", () => {
  beforeEach(() => {
    cleanup();
    result.current = null;
  });

  it("shows counts when the live-holder route is absent — never 'nothing'", async () => {
    // 🛑 The invariant survives the redesign: with no way to list who
    // holds what, the panel must not claim the corpus is quiet. What
    // changed (2026-09-01) is that it no longer says "not available
    // yet" either — corpus counts ARE answerable and are what the panel
    // was asked for, so it shows those and names the one thing still
    // missing. The assertion that matters is the absence of a false
    // all-clear, not the presence of a particular sentence.
    result.current = LOCKS_ROUTE_ABSENT;
    open();
    await waitFor(() =>
      expect(screen.getByText(/needs attention/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/nothing is under curation/i)).toBeNull();
    // Still honest about what it cannot say.
    expect(screen.getByText(/holding a dataset right now/i)).toBeTruthy();
  });

  it("says nothing is under curation when the route answers empty", async () => {
    result.current = [];
    open();
    await waitFor(() =>
      expect(screen.getByText(/nothing is under curation/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/not available yet/i)).toBeNull();
  });

  it("names a person and marks them a curator", async () => {
    result.current = [lock()];
    open();
    await waitFor(() => expect(screen.getByText("GSE11630")).toBeTruthy());
    expect(screen.getByText("alice")).toBeTruthy();
    expect(screen.getByText("curator")).toBeTruthy();
    expect(screen.queryByText("job")).toBeNull();
  });

  it("marks a batch as a job and carries its run in the tooltip", async () => {
    // Null runId means a human; present means a job. A blocked curator
    // reads these opposite ways — wait for a run, take over from a
    // person — so the two must be distinguishable at a glance.
    result.current = [
      lock({
        locked_by: "gemmaAgent",
        agent_name: "proposer",
        run_id: "category-policy-rebuild-2026-08-09",
      }),
    ];
    open();
    await waitFor(() => expect(screen.getByText("job")).toBeTruthy());
    expect(screen.getByText("proposer")).toBeTruthy();
    expect(
      screen.getByTitle(/category-policy-rebuild-2026-08-09/),
    ).toBeTruthy();
  });

  it("offers no take-over — stealing a lease is not a list action", async () => {
    result.current = [lock()];
    open();
    await waitFor(() => expect(screen.getByText("GSE11630")).toBeTruthy());
    expect(screen.queryByText(/take over/i)).toBeNull();
  });
});
