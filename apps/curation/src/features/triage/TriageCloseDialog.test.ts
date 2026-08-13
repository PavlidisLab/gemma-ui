import { describe, expect, it } from "vitest";

import { groupUndecided, type UndecidedRow } from "./TriageCloseDialog";

const row = (targetId: number, label: string, reason?: string | null): UndecidedRow => ({
  targetId,
  label,
  reason: reason ?? null,
});

describe("groupUndecided", () => {
  // A leftover pile is a CLASS-level signal: twelve rows saying the
  // same thing is one policy decision, not twelve escalations. So the
  // biggest class has to surface first — that's the one most likely to
  // be resolvable in a single call.
  it("puts the largest class first", () => {
    const groups = groupUndecided([
      row(1, "GSE1", "unclear if in scope"),
      row(2, "GSE2", "single-cell, unsure"),
      row(3, "GSE3", "unclear if in scope"),
      row(4, "GSE4", "unclear if in scope"),
    ]);
    expect(groups[0].reason).toBe("unclear if in scope");
    expect(groups[0].rows).toHaveLength(3);
    expect(groups[1].rows).toHaveLength(1);
  });

  // Today's real case: `triage_disposition` is include|exclude|null and
  // a null carries no reason, so everything lands in one bucket. It has
  // to render as a plain list rather than a group with a blank heading.
  it("collapses reasonless rows into a single unlabelled bucket", () => {
    const groups = groupUndecided([row(1, "GSE1"), row(2, "GSE2")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBeNull();
    expect(groups[0].rows).toHaveLength(2);
  });

  it("puts the reasonless bucket last when reasons exist", () => {
    const groups = groupUndecided([
      row(1, "GSE1"),
      row(2, "GSE2", "unclear if in scope"),
      row(3, "GSE3", "unclear if in scope"),
    ]);
    expect(groups[0].reason).toBe("unclear if in scope");
    expect(groups[groups.length - 1].reason).toBeNull();
  });

  it("treats whitespace-only reasons as no reason", () => {
    const groups = groupUndecided([row(1, "GSE1", "   ")]);
    expect(groups[0].reason).toBeNull();
  });

  it("returns nothing for an empty pile", () => {
    expect(groupUndecided([])).toEqual([]);
  });
});
