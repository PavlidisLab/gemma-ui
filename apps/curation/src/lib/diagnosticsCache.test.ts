import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// This env has no localStorage — not even under jsdom, which is why the
// render tests guard with `window.localStorage?.clear()`. A minimal
// in-memory stand-in keeps the suite on the fast node environment and
// tests the module's own logic rather than a browser's.
class MemoryStorage {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}
import {
  DIAGNOSTICS_CACHE_TTL_MS,
  clearDiagnosticsCache,
  hasDiagnosticsOptIn,
  readDiagnosticsCache,
  setDiagnosticsOptIn,
  writeDiagnosticsCache,
} from "./diagnosticsCache";

describe("diagnosticsCache", () => {
  beforeAll(() => {
    (globalThis as { localStorage?: Storage }).localStorage =
      new MemoryStorage() as unknown as Storage;
  });

  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it("round-trips a payload with the timestamp the seed needs", () => {
    const before = Date.now();
    writeDiagnosticsCache("svd", 42, { variances: [1, 2] });
    const hit = readDiagnosticsCache<{ variances: number[] }>("svd", 42);
    expect(hit?.data.variances).toEqual([1, 2]);
    // `initialDataUpdatedAt` is what suppresses the refetch — a missing
    // or invented timestamp would make a cached entry read as stale.
    expect(hit?.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("ignores an entry past the TTL", () => {
    vi.useFakeTimers();
    writeDiagnosticsCache("mean-variance", 7, { means: [1] });
    expect(readDiagnosticsCache("mean-variance", 7)).not.toBeNull();
    vi.advanceTimersByTime(DIAGNOSTICS_CACHE_TTL_MS + 1);
    expect(readDiagnosticsCache("mean-variance", 7)).toBeNull();
  });

  it("keys by experiment, so one dataset never answers for another", () => {
    writeDiagnosticsCache("svd", 1, { variances: [1] });
    expect(readDiagnosticsCache("svd", 2)).toBeNull();
  });

  it("keys pc-loadings by variant, so one PC does not overwrite the next", () => {
    writeDiagnosticsCache("pc-loadings", 1, { rows: ["pc1"] }, "1:50:both");
    writeDiagnosticsCache("pc-loadings", 1, { rows: ["pc2"] }, "2:50:both");
    expect(
      readDiagnosticsCache<{ rows: string[] }>("pc-loadings", 1, "1:50:both")
        ?.data.rows,
    ).toEqual(["pc1"]);
  });

  it("declines an oversized entry rather than filling the quota", () => {
    // The ceiling exists so one enormous payload cannot evict everything
    // else on the origin. The query still works, it just refetches.
    writeDiagnosticsCache("sample-correlation", 9, {
      blob: "x".repeat(1_100_000),
    });
    expect(readDiagnosticsCache("sample-correlation", 9)).toBeNull();
  });

  it("stays inside its total budget by evicting its own oldest first", () => {
    // Three 900 KB entries cannot coexist under a 2 MB budget. The two
    // most recent survive; the first is gone. The point is that WE
    // choose what goes, rather than a QuotaExceededError landing on
    // whichever write comes next — which could be a curator's draft.
    const big = { blob: "x".repeat(900_000) };
    writeDiagnosticsCache("sample-correlation", 101, big);
    writeDiagnosticsCache("sample-correlation", 102, big);
    writeDiagnosticsCache("sample-correlation", 103, big);

    expect(readDiagnosticsCache("sample-correlation", 101)).toBeNull();
    expect(readDiagnosticsCache("sample-correlation", 103)).not.toBeNull();
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("gemma.diagnosticsCache.")) {
        total += localStorage.getItem(k)?.length ?? 0;
      }
    }
    expect(total).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it("overwriting an entry costs its size once, not twice", () => {
    // Two 900 KB entries fit under 2 MB. Rewriting one must not count
    // the old copy against the new one and evict the other.
    const big = { blob: "x".repeat(900_000) };
    writeDiagnosticsCache("sample-correlation", 201, big);
    writeDiagnosticsCache("sample-correlation", 202, big);
    writeDiagnosticsCache("sample-correlation", 202, big);
    expect(readDiagnosticsCache("sample-correlation", 201)).not.toBeNull();
    expect(readDiagnosticsCache("sample-correlation", 202)).not.toBeNull();
  });

  it("rejects a malformed entry instead of handing it to a render", () => {
    localStorage.setItem(
      "gemma.diagnosticsCache.v1:svd:5",
      JSON.stringify({ nope: true }),
    );
    expect(readDiagnosticsCache("svd", 5)).toBeNull();
  });

  it("clears one experiment's entries and opt-in, leaving others alone", () => {
    writeDiagnosticsCache("svd", 1, { a: 1 });
    writeDiagnosticsCache("svd", 2, { a: 2 });
    writeDiagnosticsCache("pc-loadings", 1, { a: 3 }, "1:50:both");
    setDiagnosticsOptIn(1);
    setDiagnosticsOptIn(2);

    clearDiagnosticsCache(1);

    expect(readDiagnosticsCache("svd", 1)).toBeNull();
    expect(readDiagnosticsCache("pc-loadings", 1, "1:50:both")).toBeNull();
    expect(hasDiagnosticsOptIn(1)).toBe(false);
    // The scoped clear is the whole reason the id is in the key.
    expect(readDiagnosticsCache("svd", 2)).not.toBeNull();
    expect(hasDiagnosticsOptIn(2)).toBe(true);
  });

  it("does not let experiment 1's clear take experiment 11's entries", () => {
    writeDiagnosticsCache("svd", 1, { a: 1 });
    writeDiagnosticsCache("svd", 11, { a: 11 });
    clearDiagnosticsCache(1);
    expect(readDiagnosticsCache("svd", 11)).not.toBeNull();
  });

  it("survives storage being unavailable", () => {
    // Private mode and storage-blocked browsers THROW on access rather
    // than returning null, so every entry point is wrapped.
    const spy = vi
      .spyOn(globalThis.localStorage, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });
    expect(() => readDiagnosticsCache("svd", 1)).not.toThrow();
    expect(readDiagnosticsCache("svd", 1)).toBeNull();
    expect(hasDiagnosticsOptIn(1)).toBe(false);
    spy.mockRestore();
  });
});
