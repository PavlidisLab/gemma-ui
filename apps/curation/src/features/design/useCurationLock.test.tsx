/**
 * @vitest-environment jsdom
 *
 * The lease lifecycle. The invariant under every case: nothing here
 * may prevent EDITING — a failure to acquire, an unreachable service,
 * or someone else holding it all leave the curator working, with the
 * chip telling them what is true.
 *
 * That is scoped to editing on purpose. COMMIT is gated by the lease
 * now (`CommitBar` client-side, Gemma server-side); this hook is not
 * where that happens, and must not grow into it.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { LOCK_POLL_MS, useCurationLock } from "./useCurationLock";

const acquire = vi.hoisted(() => vi.fn());
const release = vi.hoisted(() => vi.fn());
const read = vi.hoisted(() => vi.fn());

vi.mock("@/api/curationLock", () => ({
  acquireCurationLock: acquire,
  releaseCurationLock: release,
  getCurationLock: read,
}));
vi.mock("@/api/session", () => ({ useMe: () => ({ data: { username: "paul" } }) }));

const HELD = {
  locked: true, locked_by: "paul", locked_at: "2026-08-26T16:22:34Z",
  expires_at: "2026-08-26T16:52:34Z", stolen_from: null, stolen_at: null,
};
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  vi.useFakeTimers();
  acquire.mockReset(); release.mockReset(); read.mockReset();
  acquire.mockResolvedValue({ granted: true, lock: HELD });
  release.mockResolvedValue(undefined);
  read.mockResolvedValue(HELD);
});
afterEach(() => vi.useRealTimers());

const mount = (enabled = true) =>
  renderHook((p: { experimentId: number; enabled: boolean }) => useCurationLock(p), {
    initialProps: { experimentId: 9001, enabled },
  });

describe("the lease", () => {
  it("takes it on open, once", async () => {
    mount(); await flush();
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(acquire.mock.calls[0][1]).toBe("paul");
  });

  it("releases the experiment being LEFT, not the one being entered", async () => {
    const { rerender } = mount(); await flush();
    rerender({ experimentId: 9002, enabled: true }); await flush();
    // Cleanup runs before the new id takes effect.
    expect(release.mock.calls[0][0]).toBe(9001);
  });

  it("does not take a lease for a read-only viewer", async () => {
    mount(false); await flush();
    // Locking out the person who CAN edit is the failure this prevents.
    expect(acquire).not.toHaveBeenCalled();
  });

  it("NEVER refreshes — Gemma does that on the draft PUT", async () => {
    mount(); await flush();
    await act(async () => { vi.advanceTimersByTime(LOCK_POLL_MS * 4); });
    // Polling reads; it must not re-acquire.
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalled();
  });
});

describe("when someone else has it", () => {
  it("reports the holder rather than treating it as an error", async () => {
    acquire.mockResolvedValueOnce({
      granted: false,
      heldBy: { locked_by: "alice", locked_at: "2026-08-26T16:00:00Z", expires_at: null },
    });
    const { result } = mount(); await flush();
    expect(result.current.lock).toMatchObject({ locked: true, locked_by: "alice" });
  });

  it("take-over steals, and only then", async () => {
    const { result } = mount(); await flush();
    expect(acquire.mock.calls[0][2]).toBeUndefined();
    await act(async () => { result.current.takeOver(); });
    await flush();
    expect(acquire.mock.calls[1][2]).toEqual({ steal: true });
  });
});

describe("failures never stop the curator", () => {
  it("an unreachable lock service leaves editing untouched", async () => {
    acquire.mockRejectedValueOnce(new Error("down"));
    read.mockRejectedValueOnce(new Error("down"));
    const { result } = mount();
    await flush();
    // No throw, no lock, nothing disabled — the chip simply says nothing.
    expect(result.current.lock).toBeNull();
  });

  it("a failed release is swallowed — the TTL cleans up", async () => {
    release.mockRejectedValueOnce(new Error("nope"));
    const { unmount } = mount(); await flush();
    await act(async () => { unmount(); });
    expect(release).toHaveBeenCalled();
  });
});
