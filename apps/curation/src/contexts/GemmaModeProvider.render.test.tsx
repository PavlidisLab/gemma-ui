/**
 * @vitest-environment jsdom
 *
 * Nothing renders under a mode that might still change.
 *
 * 🛑 The mode decides which backend every query talks to, and no query
 * key carries it. `useMe` keys on a bare `["me"]`, resolves the mode at
 * render, and then holds the answer (`staleTime: 5min`,
 * `refetchOnMount: false`, `refetchOnWindowFocus: false`). So a child
 * rendered on the build-time default in a build-local / runtime-remote
 * container cached the synthetic `local-curator` with `GROUP_ADMIN` —
 * no login page, every Gemma call anonymous — and nothing was left to
 * refetch it.
 *
 * These pin the gate, the failure path through it, and the bounded
 * wait's escape hatch.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const fetchConfig = vi.hoisted(() => vi.fn());
vi.mock("@/lib/gemmaMode", async (orig) => {
  const actual = await orig<typeof import("@/lib/gemmaMode")>();
  return { ...actual, fetchRuntimeConfig: fetchConfig };
});

import { resolveGemmaMode, setRuntimeConfig } from "@/lib/gemmaMode";
import { GemmaModeProvider } from "./GemmaModeProvider";

/** Every mode a child saw at render time — what `useMe` would have
 *  keyed its one cache entry on. */
const seen: string[] = [];

function Child() {
  seen.push(resolveGemmaMode().mode);
  return <div>child</div>;
}

/** Everything here settles on the microtask queue, so draining it is
 *  both sufficient and deterministic under fake timers. */
const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

function mount(qc = new QueryClient()) {
  return render(
    <QueryClientProvider client={qc}>
      <GemmaModeProvider>
        <Child />
      </GemmaModeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  seen.length = 0;
  setRuntimeConfig(null);
  fetchConfig.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GemmaModeProvider", () => {
  it("🛑 renders no child until the runtime config settles", async () => {
    let settle: (rc: unknown) => void = () => {};
    fetchConfig.mockReturnValue(new Promise((res) => (settle = res)));

    mount();
    expect(screen.queryByText("child")).toBeNull();
    expect(seen).toEqual([]);

    await act(async () => {
      settle({ mode: "remote", gemmaBaseUrl: "https://gemma2.msl.ubc.ca" });
      await Promise.resolve();
    });

    expect(screen.getByText("child")).toBeTruthy();
    // 🛑 The point of the gate: the first — and only — mode a child
    // ever saw is the runtime one.
    expect(new Set(seen)).toEqual(new Set(["remote"]));
  });

  it("renders on the build-time answer when the config fetch fails", async () => {
    // Legacy local-api without the endpoint, or offline. Nothing
    // regresses: the build-time values are the answer.
    fetchConfig.mockResolvedValue(null);
    mount();
    await flush();
    expect(screen.getByText("child")).toBeTruthy();
    expect(seen).toEqual(["local"]);
  });

  it("stops waiting on an upstream that never answers", async () => {
    vi.useFakeTimers();
    fetchConfig.mockReturnValue(new Promise(() => {}));
    mount();
    expect(screen.queryByText("child")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    // A blank app forever is worse than the build-time answer, so the
    // wait is bounded — and a late config still corrects it below.
    expect(screen.getByText("child")).toBeTruthy();
    expect(seen).toEqual(["local"]);
  });

  it("🛑 drops the query cache when a late config changes the mode", async () => {
    vi.useFakeTimers();
    let settle: (rc: unknown) => void = () => {};
    fetchConfig.mockReturnValue(new Promise((res) => (settle = res)));
    const qc = new QueryClient();
    const cleared = vi.spyOn(qc, "clear");

    mount(qc);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(cleared).not.toHaveBeenCalled();

    await act(async () => {
      settle({ mode: "remote" });
      await Promise.resolve();
    });
    await flush();

    // Anything answered in that window came from the other backend
    // under a key that does not name the mode. Dropping the cache is
    // the whole correction: a child that resolved the mode OUTSIDE
    // React does not re-render just because the context changed.
    expect(cleared).toHaveBeenCalled();
    expect(resolveGemmaMode().mode).toBe("remote");
  });

  it("leaves the cache alone when the config confirms the mode", async () => {
    vi.useFakeTimers();
    let settle: (rc: unknown) => void = () => {};
    fetchConfig.mockReturnValue(new Promise((res) => (settle = res)));
    const qc = new QueryClient();
    const cleared = vi.spyOn(qc, "clear");

    mount(qc);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await act(async () => {
      settle({ mode: "local" });
      await Promise.resolve();
    });

    expect(cleared).not.toHaveBeenCalled();
  });
});
