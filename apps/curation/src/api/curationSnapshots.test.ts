/**
 * Undo — the snapshot history and the compare.
 *
 * Pins the two things that are cheap to get wrong and expensive to
 * notice: which ROUTE each call goes at, and the fact that the
 * mutating restore has nowhere to go yet.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "./client";
import {
  previewRestore,
  restoreSnapshot,
  snapshotsPath,
} from "./curationCommit";

afterEach(() => vi.restoreAllMocks());

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
  it("goes through the agent relay, never straight at Gemma", () => {
    // Restore is a write and writes go through the agent. cab built
    // /curation-restore 2026-09-04; before that this threw rather than
    // offering a button that could not work.
    const calls: string[] = [];
    vi.spyOn(api, "post").mockImplementation(((path: string) => {
      calls.push(path);
      return Promise.resolve({} as never);
    }) as never);

    void restoreSnapshot(2706, 2116);
    expect(calls[0]).toContain("/curation-restore/2706/2116");
    expect(calls[0]).not.toContain("/rest/v2/");
  });

  it("🛑 omits `force` unless it is explicitly asked for", () => {
    // Consent after reviewing consequences, never a default. cab
    // asserts the same on their side; this is the client half.
    const calls: string[] = [];
    vi.spyOn(api, "post").mockImplementation(((path: string) => {
      calls.push(path);
      return Promise.resolve({} as never);
    }) as never);

    void restoreSnapshot(2706, 2116);
    expect(calls[0]).not.toContain("force");

    void restoreSnapshot(2706, 2116, { force: true });
    expect(calls[1]).toContain("force=true");
  });

  it("previews through the SAME relay — the dry run is not a special case", () => {
    const calls: string[] = [];
    vi.spyOn(api, "post").mockImplementation(((path: string) => {
      calls.push(path);
      return Promise.resolve({} as never);
    }) as never);

    void previewRestore(2706, 2116);
    expect(calls[0]).toContain("/curation-restore/2706/2116");
    expect(calls[0]).toContain("dryRun=true");
  });
});
