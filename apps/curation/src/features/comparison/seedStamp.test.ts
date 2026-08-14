import { describe, expect, it } from "vitest";
import { formatSeedDate, seedStamp } from "./seedStamp";
import type { CurationRow } from "./useSourceAvailability";

function row(patch: Partial<CurationRow>): CurationRow {
  return {
    curation_id: "polished:gold",
    experiment_id: 741,
    producer: "curator:gold",
    source_kind: "curator_polish",
    label: "Gold polished",
    design: {},
    tags: [],
    ...patch,
  } as CurationRow;
}

describe("seedStamp", () => {
  it("is null when the row carries no version at all — the local store's polished rows today", () => {
    expect(seedStamp(row({ created_at: null, metadata: { curator: "gold" } }))).toBeNull();
  });

  it("is null for a missing row rather than throwing", () => {
    expect(seedStamp(null)).toBeNull();
    expect(seedStamp(undefined)).toBeNull();
  });

  it("falls back to created_at when there is no sha", () => {
    const s = seedStamp(row({ created_at: "2026-08-13T16:51:26+00:00" }));
    expect(s).toBeTruthy();
    expect(s).toMatch(/13/);
  });

  it("prefers a content sha over the timestamp, shortened to 7", () => {
    expect(
      seedStamp(
        row({
          created_at: "2026-08-13T16:51:26+00:00",
          metadata: { content_sha: "7f3a1c9d4e5b6a7c8d9e" },
        }),
      ),
    ).toBe("7f3a1c9");
  });

  it("ignores a blank / non-string sha and falls through to the date", () => {
    const s = seedStamp(
      row({ created_at: "2026-08-13T16:51:26+00:00", metadata: { content_sha: "   " } }),
    );
    expect(s).toMatch(/13/);
    expect(
      seedStamp(row({ created_at: null, metadata: { content_sha: 12345 } })),
    ).toBeNull();
  });
});

describe("formatSeedDate", () => {
  it("drops the year within the current year and keeps it otherwise", () => {
    const thisYear = new Date().getFullYear();
    const same = formatSeedDate(`${thisYear}-08-13T12:00:00Z`);
    const older = formatSeedDate(`${thisYear - 2}-08-13T12:00:00Z`);
    expect(same).not.toMatch(String(thisYear));
    expect(older).toMatch(String(thisYear - 2));
  });

  it("returns null on junk rather than rendering 'Invalid Date'", () => {
    expect(formatSeedDate("not-a-date")).toBeNull();
    expect(formatSeedDate("")).toBeNull();
    expect(formatSeedDate(null)).toBeNull();
  });
});
