/**
 * isSubsumedByParentFactor — severity-rank gate regression tests.
 *
 * SKIP REASON: ``isSubsumedByParentFactor`` is NOT exported. It is
 * defined as a method on the ``suppression`` object returned by a
 * ``useMemo`` call inside the ``FindingList`` component
 * (``findingList.tsx``, line ~422). Extracting or re-exporting it
 * would be a separate refactor — this test file is left as a
 * documented placeholder so the spec is visible even though the
 * production code isn't reachable from a unit test today.
 *
 * LOGIC TO LOCK WHEN EXPORTED:
 *
 *   The function returns ``true`` (suppress this FV finding) iff:
 *     1. ``f.target_kind === "fv"``                       (not a factor-level finding)
 *     2. ``parseTargetId(f.target_id)?.kind === "fv"``    (target parses as FV)
 *     3. The parent factor slug IS in ``factorWorstRank`` (a non-ok factor finding exists)
 *     4. ``SEVERITY_RANK[f.severity] >= parentRank``
 *
 *   Condition (4) is the rank-direction gate. SEVERITY_RANK maps:
 *     { blocker: 0, major: 1, minor: 2, ok: 3 }
 *   Lower number = more severe.
 *
 *   So ``>= parentRank`` means "same or LESS severe than the parent".
 *   A BLOCKER FV (rank 0) under a MINOR factor (rank 2) satisfies
 *   ``0 >= 2 === false`` → NOT suppressed. This is the intended
 *   behaviour: a more-severe FV finding must surface even when a
 *   less-severe parent factor finding already exists.
 *
 *   The regression this covers: if the comparison were reversed to
 *   ``<= parentRank``, a blocker FV (rank 0) under any parent would
 *   ALWAYS be suppressed (``0 <= anything >= 0``), causing the curator
 *   to miss the most urgent per-FV finding.
 *
 * TO ENABLE THESE TESTS: export ``isSubsumedByParentFactor`` from
 * ``findingList.tsx`` (or extract it to its own module) and update this
 * file to import and call it directly.
 *
 * SEVERITY_RANK direction test (pure, no import needed):
 */

import { describe, expect, it } from "vitest";
import { SEVERITY_RANK } from "./auditPresentation";

describe("SEVERITY_RANK direction — lower number is MORE severe", () => {
  it("blocker has a lower rank than major", () => {
    expect(SEVERITY_RANK["blocker"]).toBeLessThan(SEVERITY_RANK["major"]);
  });

  it("major has a lower rank than minor", () => {
    expect(SEVERITY_RANK["major"]).toBeLessThan(SEVERITY_RANK["minor"]);
  });

  it("minor has a lower rank than ok", () => {
    expect(SEVERITY_RANK["minor"]).toBeLessThan(SEVERITY_RANK["ok"]);
  });

  it("blocker FV under minor factor: rank(blocker) < rank(minor), so >= comparison is false — NOT suppressed", () => {
    // This is the key direction check. isSubsumedByParentFactor returns
    // SEVERITY_RANK[fv.severity] >= parentRank.
    // blocker FV rank=0, minor factor rank=2 → 0 >= 2 === false → card shows.
    const fvRank = SEVERITY_RANK["blocker"];
    const parentRank = SEVERITY_RANK["minor"];
    expect(fvRank >= parentRank).toBe(false);
  });

  it("minor FV under minor factor: same severity → IS suppressed (no new information)", () => {
    const fvRank = SEVERITY_RANK["minor"];
    const parentRank = SEVERITY_RANK["minor"];
    expect(fvRank >= parentRank).toBe(true);
  });

  it("major FV under blocker factor: rank(major) > rank(blocker) → IS suppressed (parent is worse)", () => {
    const fvRank = SEVERITY_RANK["major"];
    const parentRank = SEVERITY_RANK["blocker"];
    expect(fvRank >= parentRank).toBe(true);
  });

  it("blocker FV under blocker factor: same rank → IS suppressed", () => {
    const fvRank = SEVERITY_RANK["blocker"];
    const parentRank = SEVERITY_RANK["blocker"];
    expect(fvRank >= parentRank).toBe(true);
  });
});
