import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// Inline localStorage polyfill so the tests run in the default (node)
// vitest env without the jsdom dependency — mirrors the convention in
// ``proposalDispositions.test.ts``. The reconciler reads / writes /
// scans ``window.localStorage``, so we back it with a Map.
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

import type { Design } from "@/features/experiment/types";
import type { Ticket, TicketTarget } from "@/api/tickets";
import {
  DRAFT_KEY_PREFIX,
  readDirtyExperimentIds,
  writeCachedDraft,
  hashDesign,
} from "@/features/design/draftCache";
import { dirtyExperimentTargets, reconcileDirtyTargets } from "./exportTicket";

/**
 * Reconciliation contract for the ticket export / close "uncommitted
 * edits" warning. ``dirtyExperimentTargets`` trusts the mere PRESENCE of
 * a ``gca:draft:<id>`` localStorage key. A key lingers whenever the
 * server was re-saved since the draft was cached (a re-import /
 * calibration reload) — the editor discards that draft as stale on open,
 * yet the key still inflates the warning and the "Uncommitted (N)" chip,
 * with NO Commit button to clear it (the live draft equals saved).
 *
 * ``reconcileDirtyTargets`` fetches the live ``/design`` and keeps only
 * targets whose cached draft is a genuine uncommitted edit, clearing the
 * stale/no-op keys as a side effect so the chip corrects too.
 */

const design = (overrides: Partial<Design> = {}): Design => ({
  experiment_id: 1,
  experiment_short_name: "GSE-1",
  factors: [],
  biomaterials: [],
  tags: [],
  title: "title",
  description: "desc",
  publications: [],
  ...overrides,
});

const target = (target_id: number): TicketTarget =>
  ({
    target_id,
    target_type: "EXPRESSION_EXPERIMENT",
    status: "NOT_DONE",
  }) as TicketTarget;

const ticket = (targets: TicketTarget[]): Ticket =>
  ({ id: 1, targets }) as Ticket;

beforeEach(() => {
  window.localStorage.clear();
});

describe("reconcileDirtyTargets", () => {
  it("keeps a target whose cached draft genuinely differs from saved", async () => {
    const server = design({ experiment_id: 2755, title: "saved title" });
    const draft = design({ experiment_id: 2755, title: "edited title" });
    writeCachedDraft(2755, hashDesign(server), draft);

    const candidates = dirtyExperimentTargets(
      ticket([target(2755)]),
      readDirtyExperimentIds(),
    );
    expect(candidates).toHaveLength(1);

    const dirty = await reconcileDirtyTargets(candidates, async () => server);
    expect(dirty.map((r) => r.target.target_id)).toEqual([2755]);
    // A genuine edit is NOT cleared — the curator can still commit it.
    expect(readDirtyExperimentIds().has("2755")).toBe(true);
  });

  it("drops + clears a STALE key (server re-saved since the draft was cached)", async () => {
    // Draft cached against an OLD baseline; the server has moved on, so
    // the cached baselineHash no longer matches the live design — exactly
    // the "re-saved on the server since" case the editor discards.
    const oldServer = design({ experiment_id: 2755, title: "old baseline" });
    const draft = design({ experiment_id: 2755, title: "edited on old" });
    writeCachedDraft(2755, hashDesign(oldServer), draft);
    const newServer = design({ experiment_id: 2755, title: "re-saved baseline" });

    const candidates = dirtyExperimentTargets(
      ticket([target(2755)]),
      readDirtyExperimentIds(),
    );
    const dirty = await reconcileDirtyTargets(candidates, async () => newServer);

    expect(dirty).toEqual([]);
    // Key cleared → the chip / warning stop counting it.
    expect(readDirtyExperimentIds().has("2755")).toBe(false);
    expect(window.localStorage.getItem(DRAFT_KEY_PREFIX + "2755")).toBeNull();
  });

  it("drops + clears a no-op key (cached draft equals current saved)", async () => {
    const server = design({ experiment_id: 2755, title: "same" });
    // Same content, matching baseline hash — a key that should have been
    // cleared on commit but lingered.
    writeCachedDraft(2755, hashDesign(server), design({ experiment_id: 2755, title: "same" }));

    const candidates = dirtyExperimentTargets(
      ticket([target(2755)]),
      readDirtyExperimentIds(),
    );
    const dirty = await reconcileDirtyTargets(candidates, async () => server);

    expect(dirty).toEqual([]);
    expect(readDirtyExperimentIds().has("2755")).toBe(false);
  });

  it("keeps a target whose design won't load (can't prove stale → over-warn)", async () => {
    const draft = design({ experiment_id: 2755, title: "edited" });
    writeCachedDraft(2755, hashDesign(design({ experiment_id: 2755 })), draft);

    const candidates = dirtyExperimentTargets(
      ticket([target(2755)]),
      readDirtyExperimentIds(),
    );
    const dirty = await reconcileDirtyTargets(candidates, async () => {
      throw new Error("not imported");
    });

    expect(dirty.map((r) => r.target.target_id)).toEqual([2755]);
    // shortName is null (no design to read) → caller falls back to the
    // ticket target's own label.
    expect(dirty[0].shortName).toBeNull();
    // Key left in place — a transient fetch error must not drop a
    // possibly-real uncommitted edit.
    expect(readDirtyExperimentIds().has("2755")).toBe(true);
  });

  it("surfaces the accession as the short label from the fetched design", async () => {
    const server = design({
      experiment_id: 2755,
      experiment_short_name: "GSE28293",
      external_source: { database: "GEO", accession: "GSE28293", uri: null },
      title: "A very long publication title that should not be the label",
    });
    const draft = design({ experiment_id: 2755, title: "edited" });
    writeCachedDraft(2755, hashDesign(server), draft);

    const candidates = dirtyExperimentTargets(
      ticket([target(2755)]),
      readDirtyExperimentIds(),
    );
    const dirty = await reconcileDirtyTargets(candidates, async () => server);
    expect(dirty[0].shortName).toBe("GSE28293");
  });
});
