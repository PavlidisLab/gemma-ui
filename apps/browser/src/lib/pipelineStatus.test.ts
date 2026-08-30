/**
 * The pipeline-status badges rendered, and were wrong, for as long as
 * they existed: the type declared `state` where the server sends
 * `status`, so `s.state` was `undefined` on every step. Nothing threw.
 * `undefined !== "notApplicable"` is true, so the not-applicable steps
 * were never filtered out, and `undefined` matched neither "ok" nor
 * "failed", so every badge took the grey default — six grey chips on a
 * dataset whose analyses had actually run, failed, or been skipped.
 * Three sibling fields were misspelled the same way, one of which
 * (`troubled` vs `isTroubled`) kept the troubled badge from ever
 * appearing.
 *
 * A type cannot catch this: reading a field the interface does not
 * declare is `undefined`, not a compile error, and the interface was
 * the thing that was wrong. So the guard has to be a real response.
 *
 * FIXTURE: `GET https://gemma2.msl.ubc.ca/rest/v2/datasets/1658/pipelineStatus`
 * (GSE11630), captured 2026-08-29, trimmed to the fields we read. The
 * same spellings were confirmed on GSE270825 and GSE11630 by short
 * name.
 */
import { describe, expect, it } from "vitest";
import type { PipelineStatus } from "./types";

/** Captured verbatim — keys are the assertion, so do not "tidy" them.
 *
 *  `satisfies` rather than a type annotation or a cast: it applies
 *  excess-property checking to this literal (so a field the server
 *  sends under a name the type does not declare is a typecheck
 *  failure) while keeping the literal's own narrow types for the
 *  assertions below. A cast would defeat the entire point of the
 *  fixture. */
const CAPTURED = {
  datasetId: 1658,
  hasBatchInformation: true,
  hasDea: true,
  hasCoexpressionAnalysis: false,
  isTroubled: false,
  troubleDetails: "",
  needsAttention: false,
  isPublic: true,
  steps: [
    {
      step: "batchInfo",
      status: "ok",
      lastRun: "2011-02-22T23:53:46.000+00:00",
      eventType: "BatchInformationFetchingEvent",
      details: "AffyScanDateExtractor; 2 batches.",
    },
    {
      step: "batchCorrection",
      status: "notRun",
      lastRun: null,
      eventType: null,
      details: null,
    },
    {
      step: "missingValue",
      status: "notApplicable",
      lastRun: null,
      eventType: null,
      details: null,
    },
  ],
} satisfies PipelineStatus;

describe("PipelineStatus mirrors the wire", () => {
  it("satisfies the declared type without a cast", () => {
    // The real assertion is the `satisfies` on the fixture: a field
    // renamed on either side is a typecheck failure. This body just
    // keeps the case honest at runtime.
    const ps: PipelineStatus = CAPTURED;
    expect(ps.datasetId).toBe(1658);
  });

  it("carries `status` on a step, never `state`", () => {
    for (const s of CAPTURED.steps) {
      expect(s).toHaveProperty("status");
      expect(s).not.toHaveProperty("state");
    }
  });

  it("carries `details` on a step, never `message`", () => {
    for (const s of CAPTURED.steps) {
      expect(s).toHaveProperty("details");
      expect(s).not.toHaveProperty("message");
    }
  });

  it("names the dataset `datasetId`, trouble `isTroubled`, DEA `hasDea`", () => {
    expect(CAPTURED).toHaveProperty("datasetId");
    expect(CAPTURED).not.toHaveProperty("experimentId");
    expect(CAPTURED).toHaveProperty("isTroubled");
    expect(CAPTURED).not.toHaveProperty("troubled");
    expect(CAPTURED).toHaveProperty("hasDea");
    expect(CAPTURED).not.toHaveProperty("hasDifferentialExpressionAnalysis");
  });
});

describe("what the badge row does with it", () => {
  // Mirrors PipelineStatusRow's filter. Reading the wrong field made
  // this keep every step, including the ones the server said do not
  // apply to this dataset.
  const shown = CAPTURED.steps.filter((s) => s.status !== "notApplicable");

  it("drops the steps the server marked notApplicable", () => {
    expect(shown.map((s) => s.step)).toEqual(["batchInfo", "batchCorrection"]);
  });

  it("distinguishes ok from not-yet-run", () => {
    expect(shown.map((s) => s.status)).toEqual(["ok", "notRun"]);
  });
});
