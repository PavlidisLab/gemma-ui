/**
 * @vitest-environment jsdom
 *
 * Autosave. The interval is 60 s (Paul, 2026-08-25), which only works
 * because leaving the tab forces a save — so both halves are pinned
 * here, along with the two orderings that would lose an edit.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

/** `waitFor` runs on REAL timers, so it hangs under `useFakeTimers`.
 *  Everything here resolves on the microtask queue, so draining it is
 *  both sufficient and deterministic. */
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
import type { Design } from "@/features/experiment/types";
import { AUTOSAVE_INTERVAL_MS, useDraftAutosave } from "./useDraftAutosave";

const put = vi.hoisted(() => vi.fn());
vi.mock("@/api/curationDraft", async (orig) => {
  const actual = await orig<typeof import("@/api/curationDraft")>();
  return { ...actual, putCurationDraft: put };
});
vi.mock("@/api/session", () => ({
  useMe: () => ({ data: { username: "paul" } }),
}));

const design = (n: number) => ({ experiment_id: 9, n }) as unknown as Design;

beforeEach(() => {
  vi.useFakeTimers();
  put.mockReset();
  put.mockResolvedValue({ saved_at: "2026-08-25T19:04:00Z" });
});
afterEach(() => vi.useRealTimers());

function mount(props: Partial<Parameters<typeof useDraftAutosave>[0]> = {}) {
  return renderHook((p: Parameters<typeof useDraftAutosave>[0]) => useDraftAutosave(p), {
    initialProps: {
      experimentId: 9,
      draft: design(1),
      isDirty: true,
      enabled: true,
      ...props,
    },
  });
}

describe("the interval", () => {
  it("does not save a clean draft, ever", async () => {
    mount({ isDirty: false });
    await act(async () => { vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS * 5); });
    expect(put).not.toHaveBeenCalled();
  });

  it("saves 60 seconds after an edit, not before", async () => {
    mount();
    await act(async () => { vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS - 1000); });
    expect(put).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("restarts the clock on each edit — steady typing saves from the LAST edit", async () => {
    const { rerender } = mount();
    for (let i = 2; i <= 4; i++) {
      await act(async () => { vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS - 5000); });
      rerender({ experimentId: 9, draft: design(i), isDirty: true, enabled: true });
    }
    expect(put).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS); });
    expect(put).toHaveBeenCalledTimes(1);
    // The LAST draft, not the first.
    expect(put.mock.calls[0][2].design).toEqual(design(4));
  });

  it("is off when editing is disabled", async () => {
    mount({ enabled: false });
    await act(async () => { vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS * 3); });
    expect(put).not.toHaveBeenCalled();
  });
});

describe("leaving", () => {
  it("saves when the tab is hidden — this is what makes 60 s safe", async () => {
    mount();
    Object.defineProperty(document, "visibilityState", {
      configurable: true, get: () => "hidden",
    });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("saves on pagehide", async () => {
    mount();
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("saves when walking to another experiment, under the OLD id", async () => {
    const { unmount } = mount();
    await act(async () => { unmount(); });
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0]).toBe(9);
  });
});

describe("two saves never overlap", () => {
  it("queues an edit that lands mid-save instead of racing it", async () => {
    let release!: (v: unknown) => void;
    put.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const { rerender, result } = mount();

    await act(async () => { vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS); });
    expect(put).toHaveBeenCalledTimes(1);
    expect(result.current.state.kind).toBe("saving");

    // An edit arrives while the first save is still open.
    rerender({ experimentId: 9, draft: design(99), isDirty: true, enabled: true });
    await act(async () => { result.current.flush(); });
    // Still one: the second was queued, not fired alongside.
    expect(put).toHaveBeenCalledTimes(1);

    await act(async () => { release({ saved_at: "t" }); });
    await flush();
    // ...and goes once the first finishes, with the NEWER draft.
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[1][2].design).toEqual(design(99));
  });
});

describe("what the curator is told", () => {
  it("reports saved with the moment GEMMA committed", async () => {
    const { result } = mount();
    await act(async () => { vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS); });
    await flush();
    expect(result.current.state).toEqual({
      kind: "saved",
      at: "2026-08-25T19:04:00Z",
    });
  });

  it("maps a failure onto its own state rather than a generic error", async () => {
    const { ApiError } = await import("@/api/client");
    put.mockRejectedValueOnce(new ApiError("x", 502, "Bad Gateway", "unreachable: nope"));
    const { result } = mount();
    await act(async () => { vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS); });
    await flush();
    expect(result.current.state.kind).toBe("offline");
  });
});
