/**
 * Tests for the accession-string parsing logic in BulkIntakeForm
 * (ScreeningQueue.tsx).
 *
 * SKIP RATIONALE: the parsing logic is inlined inside BulkIntakeForm's
 * submit() function and is NOT exported.  BulkIntakeForm itself is a
 * local (non-exported) component that depends on
 * useCreateCandidatesBulk() (TanStack Mutation) which would require a
 * QueryClientProvider to render.  We cannot reach the function through
 * a component render without significant mock infrastructure.
 *
 * The formula is extracted verbatim from ScreeningQueue.tsx ~l65:
 *
 *   rawAccessions.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
 *
 * The same regex also drives the live count in the submit-button label
 * (~l158).  If ScreeningQueue.tsx's parsing regex changes, update this
 * file in the same commit.
 *
 * If parseAccessions is ever extracted to a standalone exported helper,
 * replace the inline formula below with an import and drop this comment.
 */

import { describe, expect, it } from "vitest";

/** The accession-parsing formula extracted verbatim from
 *  BulkIntakeForm.submit() in ScreeningQueue.tsx. */
function parseAccessions(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("parseAccessions — bulk-intake tokeniser", () => {
  it("splits comma-separated accessions", () => {
    expect(parseAccessions("GSE1, GSE2, GSE3")).toEqual(["GSE1", "GSE2", "GSE3"]);
  });

  it("splits newline-separated accessions", () => {
    expect(parseAccessions("GSE1\nGSE2\nGSE3")).toEqual(["GSE1", "GSE2", "GSE3"]);
  });

  it("splits semicolon-separated accessions", () => {
    expect(parseAccessions("GSE1; GSE2")).toEqual(["GSE1", "GSE2"]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parseAccessions("")).toEqual([]);
  });

  it("returns an empty array for a whitespace-only string (NOT [\"\"])", () => {
    expect(parseAccessions("   ")).toEqual([]);
    expect(parseAccessions("\n\t")).toEqual([]);
  });

  it("drops a trailing comma — \"GSE1,GSE2,\" → [\"GSE1\",\"GSE2\"]", () => {
    expect(parseAccessions("GSE1,GSE2,")).toEqual(["GSE1", "GSE2"]);
  });

  it("handles mixed delimiters in the same string", () => {
    expect(parseAccessions("GSE1,GSE2; GSE3\nGSE4")).toEqual([
      "GSE1", "GSE2", "GSE3", "GSE4",
    ]);
  });

  it("collapses repeated delimiters (e.g. double comma)", () => {
    expect(parseAccessions("GSE1,,GSE2")).toEqual(["GSE1", "GSE2"]);
  });
});
