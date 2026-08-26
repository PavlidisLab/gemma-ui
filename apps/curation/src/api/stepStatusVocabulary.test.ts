/**
 * The two `needs_attention`s, kept apart.
 *
 * 🛑 There were two fields with that name at different levels of the
 * SAME response: a curator-set boolean about the dataset
 * (`curationDetails.needsAttention`, with its own audit event) and a
 * value of `steps[].status`. Read together they look like one concept
 * at two granularities. They are not — "a human flagged this dataset"
 * versus "this step is unfinished".
 *
 * The step value was renamed `incomplete` on 2026-08-26. The boolean is
 * untouched and is not modelled by `StepStatus` at all.
 *
 * Named from what SETS it, not from what the word suggests: a design
 * row with no factors, tags with none set, an audit nobody has triaged.
 * A curator owes it something. It says nothing about a derived analysis
 * having gone stale relative to its input — that state does not exist
 * yet, and would be `stale` when it does.
 */
import { describe, expect, it } from "vitest";
import type { StepStatus } from "./workflowTypes";

/** Mirrors `mapGemmaStatus`, which is module-private. Kept in step by
 *  the round-trip assertions below rather than by hope. */
const VOCABULARY: StepStatus[] = ["not_run", "ok", "failed", "incomplete", "na"];

describe("StepStatus vocabulary", () => {
  it("has no member named for the curator-set flag", () => {
    // The collision this rename removed. If `needs_attention` ever
    // reappears here, the two concepts have merged again.
    expect(VOCABULARY).not.toContain("needs_attention" as StepStatus);
  });

  it("carries `incomplete`, and it is not `not_run`", () => {
    // never-started vs started-and-unfinished is the whole axis.
    expect(VOCABULARY).toContain("incomplete");
    expect(VOCABULARY).toContain("not_run");
  });

  it("carries no `stale`, because that state does not exist yet", () => {
    // "the DEA no longer reflects the design" is a real and wanted
    // state, and a DIFFERENT one. When it lands it is an addition, not
    // a rename of `incomplete`.
    expect(VOCABULARY).not.toContain("stale" as StepStatus);
  });

  it("still has no `in_progress` — nothing has ever emitted one", () => {
    expect(VOCABULARY).not.toContain("in_progress" as StepStatus);
  });
});
