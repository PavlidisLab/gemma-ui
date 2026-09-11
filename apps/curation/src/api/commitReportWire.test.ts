/**
 * The commit report, as it actually reaches a read site.
 *
 * 🐍 Gemma answers `preflight` / `commit` / `sign` / `restore` in
 * camelCase, and every response leaves `api.post` through `snakeify`
 * (`api/client.ts`). So the type a caller reads has to be spelled the
 * way the transform leaves it — declared camel, every field on
 * `CommitReport` was `undefined` at runtime and nothing said so:
 *
 *   - `newBaseline` fed the commit's optimistic-concurrency stamp, so
 *     the stale-baseline 409 had nothing to compare against;
 *   - `deletedIdentities` was the removal notice, which never rendered;
 *   - `changes.curationDetails` matched no section label.
 *
 * A fixture spelled in the declared casing cannot catch that. This one
 * runs Gemma's own payload through the boundary instead.
 */
import { describe, expect, it } from "vitest";

import { snakeify } from "./client";
import type { CommitReport } from "./curationCommit";

/** A report verbatim in Gemma's spelling, off `CurationCommitReport`. */
const SERVED = {
  applied: true,
  idMap: { "tag-9018": 9021, "fv-77280": 77300 },
  changes: {
    design: { created: 1, updated: 2, deleted: 0, unchanged: 7 },
    tags: { created: 0, updated: 0, deleted: 1, unchanged: 4 },
    curationDetails: { updated: 1 },
  },
  reidentified: { "1101": 2201 },
  deletedIdentities: [9018],
  error: null,
  auditEventIds: [5501, 5502],
  canonicalizations: [],
  commitAnnotationSetId: 812,
  newBaseline: "2026-09-10T18:04:11Z",
  snapshotAnnotationSetId: 811,
};

/** Exactly what `api.post` hands back. */
const report = snakeify(SERVED) as CommitReport;

describe("CommitReport is declared in the casing that arrives", () => {
  it("carries the baseline token the next commit threads", () => {
    expect(report.new_baseline).toBe("2026-09-10T18:04:11Z");
  });

  it("carries the ids that go away", () => {
    expect(report.deleted_identities).toEqual([9018]);
  });

  it("carries the created-row map, its data keys untouched", () => {
    // `clientRef`s are the builder's own strings — `fv-77280`, not a
    // field name — and nothing may rewrite them.
    expect(report.id_map).toEqual({ "tag-9018": 9021, "fv-77280": 77300 });
  });

  it("carries the audit events, the snapshot and the commit set", () => {
    expect(report.audit_event_ids).toEqual([5501, 5502]);
    expect(report.snapshot_annotation_set_id).toBe(811);
    expect(report.commit_annotation_set_id).toBe(812);
  });

  it("🛑 names the curation-details section as it lands", () => {
    // The transform rewrites the keys of `changes` as well, so the
    // renderer's section list has to be spelled the same way.
    expect(Object.keys(report.changes)).toContain("curation_details");
    expect(Object.keys(report.changes)).not.toContain("curationDetails");
  });

  it("leaves the single-word fields alone", () => {
    expect(report.applied).toBe(true);
    expect(report.error).toBeNull();
    expect(report.reidentified).toEqual({ "1101": 2201 });
    expect(report.canonicalizations).toEqual([]);
  });
});
