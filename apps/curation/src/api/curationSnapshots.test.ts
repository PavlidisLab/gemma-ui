/**
 * Undo — the snapshot history and the compare.
 *
 * Pins the two things that are cheap to get wrong and expensive to
 * notice: which ROUTE each call goes at, and the fact that the
 * mutating restore has nowhere to go yet.
 */
import { describe, expect, it } from "vitest";

import {
  restoreSnapshot,
  snapshotsPath,
} from "./curationCommit";

describe("the snapshot history", () => {
  it("reads Gemma's annotation sets, filtered to snapshots", () => {
    // 🛑 `role=snapshot` is the filter that makes this the UNDO
    // history rather than every set on the dataset — 2,494 of gemma2's
    // 2,495 sets are snapshots, so dropping it returns the corpus.
    expect(snapshotsPath(2706)).toBe(
      "/rest/v2/datasets/2706/annotation-sets?role=snapshot",
    );
  });

  it("goes at Gemma, not the store and not the agent relay", () => {
    const p = snapshotsPath(5381);
    expect(p.startsWith("/rest/v2/")).toBe(true);
    expect(p).not.toContain("/curation/v1");
    expect(p).not.toContain("/curation-");
  });
});

describe("🛑 the mutating restore", () => {
  it("refuses rather than offering a button that cannot work", () => {
    // Restore is a write and writes go through the agent. The relays
    // are /curation-{draft,lock,disposition,finalize,reopen,preflight,
    // commit,sign} — there is no /curation-restore. Posting at Gemma
    // directly would be the UI writing curation.
    expect(() => restoreSnapshot()).toThrow(/agent relay/i);
  });

  it("names the route that is missing, so the error is actionable", () => {
    expect(() => restoreSnapshot()).toThrow(/curation-restore/);
  });
});
