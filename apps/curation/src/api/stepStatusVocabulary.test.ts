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
 * having gone stale relative to its input — that state is `stale`, and
 * it arrived on 2026-09-02.
 */
import { describe, expect, it } from "vitest";
import type { StepStatus } from "./workflowTypes";

/** A hand-written mirror of `mapGemmaStatus`, and it can only assert
 *  what someone remembered to add — which is how `stale` reached the
 *  wire while the test below swore the state did not exist. The join to
 *  the real adapter is `pipelineStatusAdapter.test.ts`; this file is
 *  about the WORDS and what they must not become. */
const VOCABULARY: StepStatus[] = ["not_run", "ok", "failed", "incomplete", "stale", "na"];

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

  it("carries `stale`, and it is neither `incomplete` nor `not_run`", () => {
    // "the DEA no longer reflects the design" is a real state and a
    // DIFFERENT one, so it landed as an addition, not as a rename of
    // `incomplete`.
    //
    // 🛑 It was on the wire before it was in this list, and the gap was
    // silent: `mapGemmaStatus` fell through to `not_run`, so a step with
    // a real `lastRun` rendered "not run". gemma2 on 2026-09-02 answered
    // `stale` for preprocess, pca and dea on eid 1658.
    expect(VOCABULARY).toContain("stale");
    expect(VOCABULARY).toContain("incomplete");
    expect(VOCABULARY).toContain("not_run");
  });

  it("still has no `in_progress` — nothing has ever emitted one", () => {
    expect(VOCABULARY).not.toContain("in_progress" as StepStatus);
  });
});
