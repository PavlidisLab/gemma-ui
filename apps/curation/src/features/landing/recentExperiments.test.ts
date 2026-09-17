/**
 * @vitest-environment jsdom
 *
 * The recent-datasets list under the quick-search box. Two rules are
 * pinned because both fail silently — the list still renders, it is
 * just wrong:
 *
 *  - an entry whose id the catalogue does not carry is KEPT (remote
 *    mode's catalogue is a bounded prefix, so "absent" is usually
 *    "past the cap", and dropping it loses the dataset the curator was
 *    in a minute ago);
 *  - a malformed entry with no id is dropped, because it would
 *    navigate to `#/experiments/`.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearRecentExperiments,
  getRecentExperiments,
  pushRecentExperiment,
  resolveRecentExperiments,
  MAX_RECENT_EXPERIMENTS,
} from "./recentExperiments";

const KEY = "gca:recent-experiments:v1";

/** 🛑 This environment has no `localStorage` — jsdom here is configured
 *  without it, which `recentTickets.test.ts` also works around. That
 *  absence is exactly what the module's try/catch is for, so the stub
 *  is installed to test the LOGIC; the no-storage path is covered
 *  separately below. */
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
});

describe("the MRU", () => {
  it("keeps most-recent-first and does not duplicate a re-visit", () => {
    pushRecentExperiment({ id: "1", label: "GSE1" });
    pushRecentExperiment({ id: "2", label: "GSE2" });
    pushRecentExperiment({ id: "1", label: "GSE1" });
    expect(getRecentExperiments().map((r) => r.id)).toEqual(["1", "2"]);
  });

  it("refreshes the stored label on a re-visit", () => {
    pushRecentExperiment({ id: "7", label: "GSE7", title: "old title" });
    pushRecentExperiment({ id: "7", label: "GSE7-renamed", title: "new title" });
    expect(getRecentExperiments()[0]).toMatchObject({
      label: "GSE7-renamed",
      title: "new title",
    });
  });

  it("caps the list", () => {
    for (let i = 1; i <= MAX_RECENT_EXPERIMENTS + 5; i++) {
      pushRecentExperiment({ id: String(i), label: `GSE${i}` });
    }
    expect(getRecentExperiments()).toHaveLength(MAX_RECENT_EXPERIMENTS);
  });

  it("keeps the id opaque — the preboarding form round-trips", () => {
    pushRecentExperiment({ id: "preboarding:12", label: "GSE300000" });
    expect(getRecentExperiments()[0].id).toBe("preboarding:12");
  });

  it("clears", () => {
    pushRecentExperiment({ id: "1", label: "GSE1" });
    clearRecentExperiments();
    expect(getRecentExperiments()).toEqual([]);
  });
});

describe("reading what is in storage", () => {
  it("drops an entry with no usable id rather than offering it", () => {
    store[KEY] = JSON.stringify([
      { label: "GSE1" },
      { id: "", label: "GSE2" },
      { id: "3", label: "GSE3" },
    ]);
    expect(getRecentExperiments().map((r) => r.id)).toEqual(["3"]);
  });

  it("falls back to the id when the label is missing", () => {
    store[KEY] = JSON.stringify([{ id: "44" }]);
    expect(getRecentExperiments()[0].label).toBe("44");
  });

  it("survives a numeric id, a non-array, and junk", () => {
    store[KEY] = JSON.stringify([{ id: 91442, label: "GSE270825" }]);
    expect(getRecentExperiments()[0].id).toBe("91442");
    store[KEY] = JSON.stringify({ id: "1" });
    expect(getRecentExperiments()).toEqual([]);
    store[KEY] = "{not json";
    expect(getRecentExperiments()).toEqual([]);
  });

  it("is empty, not an error, with no storage at all", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: undefined,
    });
    expect(getRecentExperiments()).toEqual([]);
    expect(pushRecentExperiment({ id: "1", label: "GSE1" })).toEqual([]);
  });
});

describe("resolving against the catalogue", () => {
  const stored = [
    { id: "1", label: "GSE1", title: "stored title", taxon: "human" },
    { id: "14164", label: "GSE107613" },
  ];

  it("keeps an entry the catalogue does not carry", () => {
    const rows = resolveRecentExperiments(stored, [
      { experiment_id: 1, short_name: "GSE1", title: "live title" },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["1", "14164"]);
    expect(rows[1].label).toBe("GSE107613");
  });

  it("prefers the catalogue's row where it has one", () => {
    const rows = resolveRecentExperiments(stored, [
      {
        experiment_id: "1",
        short_name: "GSE1-renamed",
        title: "live title",
        taxon: "mouse",
      },
    ]);
    expect(rows[0]).toMatchObject({
      label: "GSE1-renamed",
      title: "live title",
      taxon: "mouse",
    });
  });

  it("drops the experiment already on screen", () => {
    expect(
      resolveRecentExperiments(stored, [], 1).map((r) => r.id),
    ).toEqual(["14164"]);
    // The route id is a string, the catalogue's is a number — the
    // comparison has to survive both.
    expect(
      resolveRecentExperiments(stored, [], "14164").map((r) => r.id),
    ).toEqual(["1"]);
  });
});
