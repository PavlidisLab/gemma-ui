/**
 * Tests for the paper auto-apply dismissal flags.
 *
 * This module is the exemplar the app-level CLAUDE.md points at for
 * "per-experiment durable flags scope by experiment id and clear on
 * Reset", so both halves of that contract are pinned here — the scoping
 * AND the clear. The clear half was missing in practice: the flag
 * outlived the publication row it gated, so after a Reset the paper was
 * suppressed forever.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// Inline localStorage polyfill so this runs in the default (node)
// vitest env, matching agentFeedback.test.ts / proposalDispositions.test.ts.
beforeAll(() => {
  if (typeof window === "undefined") {
    const store = new Map<string, string>();
    const ls = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      get length() {
        return store.size;
      },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
    };
    const g = globalThis as unknown as {
      window?: { localStorage: typeof ls };
      localStorage?: typeof ls;
    };
    g.window = { localStorage: ls };
    g.localStorage = ls;
  }
});

import {
  clearPaperDismissals,
  isPaperDismissed,
  markPaperDismissed,
  paperDismissalKey,
} from "./paperDismissal";

beforeEach(() => {
  window.localStorage.clear();
});

describe("paperDismissalKey", () => {
  it("scopes the key by experiment AND proposal", () => {
    expect(paperDismissalKey(42, "prop-1")).toBe(
      "gca:auto-applied-paper:42:prop-1",
    );
  });

  it("treats a numeric and string experiment id as the same key", () => {
    expect(paperDismissalKey(42, "p")).toBe(paperDismissalKey("42", "p"));
  });
});

describe("mark / is dismissed", () => {
  it("reads back a flag it just set", () => {
    markPaperDismissed(1, "prop-1");
    expect(isPaperDismissed(1, "prop-1")).toBe(true);
  });

  it("defaults to not-dismissed", () => {
    expect(isPaperDismissed(1, "prop-1")).toBe(false);
  });

  it("does not leak across proposals of the same experiment", () => {
    markPaperDismissed(1, "prop-1");
    expect(isPaperDismissed(1, "prop-2")).toBe(false);
  });

  it("does not leak across experiments", () => {
    markPaperDismissed(1, "prop-1");
    expect(isPaperDismissed(2, "prop-1")).toBe(false);
  });

  it("treats a non-\"1\" stored value as not dismissed", () => {
    window.localStorage.setItem(paperDismissalKey(1, "prop-1"), "0");
    expect(isPaperDismissed(1, "prop-1")).toBe(false);
  });
});

describe("clearPaperDismissals", () => {
  it("clears every proposal's flag for the named experiment", () => {
    markPaperDismissed(1, "prop-1");
    markPaperDismissed(1, "prop-2");
    markPaperDismissed(1, "prop-3");

    clearPaperDismissals(1);

    expect(isPaperDismissed(1, "prop-1")).toBe(false);
    expect(isPaperDismissed(1, "prop-2")).toBe(false);
    expect(isPaperDismissed(1, "prop-3")).toBe(false);
  });

  it("leaves other experiments' flags intact", () => {
    markPaperDismissed(1, "prop-1");
    markPaperDismissed(2, "prop-1");

    clearPaperDismissals(1);

    expect(isPaperDismissed(1, "prop-1")).toBe(false);
    expect(isPaperDismissed(2, "prop-1")).toBe(true);
  });

  it("does not clear experiment 12 when clearing experiment 1", () => {
    // The trailing ":" in the prefix is what makes this work.
    markPaperDismissed(12, "prop-1");

    clearPaperDismissals(1);

    expect(isPaperDismissed(12, "prop-1")).toBe(true);
  });

  it("removes ALL matching keys, not just the first", () => {
    // Guards the collect-then-remove ordering: removing during the
    // index scan reindexes localStorage and silently skips entries.
    for (let i = 0; i < 12; i++) markPaperDismissed(1, `prop-${i}`);

    clearPaperDismissals(1);

    const leftover = Array.from({ length: 12 }, (_, i) => `prop-${i}`).filter(
      (pid) => isPaperDismissed(1, pid),
    );
    expect(leftover).toEqual([]);
  });

  it("leaves unrelated localStorage keys alone", () => {
    window.localStorage.setItem("notes:1", "keep me");
    markPaperDismissed(1, "prop-1");

    clearPaperDismissals(1);

    expect(window.localStorage.getItem("notes:1")).toBe("keep me");
  });

  it("is a no-op when nothing is dismissed", () => {
    expect(() => clearPaperDismissals(1)).not.toThrow();
  });
});
