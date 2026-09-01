/**
 * @vitest-environment jsdom
 *
 * The recents menu stores ticket IDS and resolves them against the
 * server every time it opens. The whole point is that a stored title
 * goes stale — tickets get renamed, closed, deleted, or stop being
 * visible to this curator — and a menu confidently offering one that no
 * longer exists is worse than an empty menu.
 *
 * `visibleRecentTickets` is where that rule is enforced, so it is
 * pinned: the failure it prevents (offering a dead ticket) looks
 * perfectly normal until someone clicks it.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  forgetRecentTicketId,
  getRecentTicketIds,
  pushRecentTicketId,
  visibleRecentTickets,
} from "./recentTickets";

const KEY = "gca:recent-tickets:v1";

/** 🛑 This environment has no `localStorage` — jsdom here is configured
 *  without it, which `DesignDraftContext.render.test.tsx` also works
 *  around. That absence is exactly what the module's try/catch is for,
 *  so the stub is installed to test the LOGIC; the no-storage path is
 *  covered separately below. */
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
    pushRecentTicketId(6);
    pushRecentTicketId(12);
    pushRecentTicketId(6);
    expect(getRecentTicketIds()).toEqual([6, 12]);
  });

  it("caps the list so the menu stays scannable", () => {
    for (let i = 1; i <= 10; i++) pushRecentTicketId(i);
    expect(getRecentTicketIds()).toHaveLength(6);
    expect(getRecentTicketIds()[0]).toBe(10);
  });

  it("accepts the string ids the router hands out", () => {
    pushRecentTicketId("6");
    expect(getRecentTicketIds()).toEqual([6]);
  });

  it("🛑 never yields an id that would be requested as /tickets/NaN", () => {
    window.localStorage.setItem(KEY, JSON.stringify(["", "abc", null, 0, -3, 6]));
    expect(getRecentTicketIds()).toEqual([6]);
    expect(pushRecentTicketId("not-a-ticket")).toEqual([6]);
  });

  it("survives junk in storage rather than throwing on open", () => {
    window.localStorage.setItem(KEY, "{not json");
    expect(getRecentTicketIds()).toEqual([]);
    window.localStorage.setItem(KEY, JSON.stringify({ not: "an array" }));
    expect(getRecentTicketIds()).toEqual([]);
  });

  it("forgets one without disturbing the rest", () => {
    pushRecentTicketId(6);
    pushRecentTicketId(12);
    expect(forgetRecentTicketId(6)).toEqual([12]);
  });
});

describe("visibleRecentTickets", () => {
  const RESOLVED = [
    { id: 6, title: "Reference 500 — ongoing curation review" },
    { id: 12, title: "Batch info needed" },
  ];

  it("keeps MRU order, not the server's", () => {
    expect(visibleRecentTickets([12, 6], RESOLVED).map((t) => t.id)).toEqual([
      12, 6,
    ]);
  });

  it("🛑 drops an id the server did not return", () => {
    // Closed, deleted, or not visible to this curator — all three mean
    // "do not offer it", and the menu cannot tell them apart.
    expect(visibleRecentTickets([6, 99], RESOLVED).map((t) => t.id)).toEqual([6]);
  });

  it("🛑 resolving nothing shows nothing, never everything", () => {
    // The dangerous inversion: a failed or empty resolution must not
    // fall back to rendering the raw MRU.
    expect(visibleRecentTickets([6, 12], [])).toEqual([]);
  });

  it("omits tickets already listed elsewhere in the menu", () => {
    // The dataset's own tickets get their own section; repeating them
    // under "recent" is noise.
    expect(visibleRecentTickets([6, 12], RESOLVED, [6]).map((t) => t.id)).toEqual(
      [12],
    );
  });

  it("no recents is an empty list, not a crash", () => {
    expect(visibleRecentTickets([], RESOLVED)).toEqual([]);
  });
});

describe("when storage is unavailable", () => {
  it("reads and writes degrade to an empty list rather than throwing", () => {
    // A private window, cleared site data, or a browser blocking site
    // storage. The menu simply has no recents; it must not take the
    // banner down with it.
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage disabled");
      },
    });
    expect(getRecentTicketIds()).toEqual([]);
    expect(pushRecentTicketId(6)).toEqual([]);
    expect(forgetRecentTicketId(6)).toEqual([]);
  });
});
