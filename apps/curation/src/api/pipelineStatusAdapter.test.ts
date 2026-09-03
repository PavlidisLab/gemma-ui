/**
 * The wire→UI boundary for `GET /rest/v2/datasets/{id}/pipeline-status`.
 *
 * 🛑 This file exists because a status value arrived that the adapter
 * had no case for, and the failure was silent: `stale` fell through to
 * the `default` arm and rendered as "not run" on a step carrying a real
 * `lastRun`. Nothing broke, nothing threw, and the vocabulary test next
 * door passed the whole time — it mirrored the list by hand, so it
 * could only assert what someone had already remembered to write down.
 *
 * The fixtures below are the shape `client.ts` hands the adapter, i.e.
 * AFTER snakeifying: Gemma sends `lastRun`, the adapter sees `last_run`.
 */
import { describe, expect, it } from "vitest";
import { adaptPipelineStatus } from "./workflow";
import type { StepStatus } from "./workflowTypes";

/** Every value Gemma's `pipeline-status` can put in `steps[].status`.
 *  Add here when the server's enum grows — an unmapped value is the
 *  bug this file is named for. */
const GEMMA_STATUSES = ["ok", "failed", "notRun", "notApplicable", "stale"] as const;

const step = (name: string, status: string, lastRun: string | null = null) => ({
  step: name,
  status,
  last_run: lastRun,
  event_type: null,
  details: null,
});

describe("adaptPipelineStatus", () => {
  it("maps every Gemma status to something other than the default arm", () => {
    // `not_run` is the default, so a value that maps to it must have
    // asked for it. Only `notRun` does.
    for (const wire of GEMMA_STATUSES) {
      const out = adaptPipelineStatus({ steps: [step("preprocess", wire)] }, 1);
      const got = out.analysis.preprocessing.status;
      if (wire === "notRun") {
        expect(got).toBe("not_run");
      } else {
        expect(got, `Gemma "${wire}" fell through to the default arm`).not.toBe("not_run");
      }
    }
  });

  it("carries `stale` through as itself, with its last_run intact", () => {
    // Observed on gemma2 2026-09-02, eid 1658: preprocess / pca / dea
    // all `stale` with run dates from 2015, 2020 and 2022.
    const out = adaptPipelineStatus(
      {
        steps: [
          step("batchInfo", "ok", "2011-02-22T23:53:46.000+00:00"),
          step("preprocess", "stale", "2015-08-20T00:34:10.000+00:00"),
          step("pca", "stale", "2020-03-27T11:51:04.000+00:00"),
          step("sampleCorrelation", "notRun"),
          step("meanVariance", "notRun"),
          step("dea", "stale", "2022-09-01T16:08:21.000+00:00"),
        ],
      },
      1658,
    );
    expect(out.analysis.preprocessing.status).toBe("stale");
    expect(out.analysis.preprocessing.last_run).toBe("2015-08-20T00:34:10.000+00:00");
    expect(out.analysis.dea.status).toBe("stale");
    expect(out.analysis.batch_info.status).toBe("ok");
  });

  it("lets a stale sub-step win the diagnostics bucket over a never-run one", () => {
    // pca / sampleCorrelation / meanVariance collapse to one badge,
    // worst-wins. A recompute that is owed outranks a step that is
    // simply at rest.
    const out = adaptPipelineStatus(
      {
        steps: [
          step("pca", "stale", "2020-03-27T11:51:04.000+00:00"),
          step("sampleCorrelation", "notRun"),
          step("meanVariance", "notRun"),
        ],
      },
      1658,
    );
    expect(out.analysis.diagnostics.status).toBe("stale");
  });

  it("still lets a failure outrank a stale result", () => {
    const out = adaptPipelineStatus(
      {
        steps: [
          step("pca", "stale", "2020-03-27T11:51:04.000+00:00"),
          step("sampleCorrelation", "failed", "2014-06-12T20:31:46.000+00:00"),
          step("meanVariance", "ok"),
        ],
      },
      1658,
    );
    expect(out.analysis.diagnostics.status).toBe("failed");
  });

  it("passes a local_api-shaped payload straight through", () => {
    // The store already speaks the UI shape; the adapter must not
    // re-derive it from an absent `steps[]`.
    const ui = {
      analysis: { preprocessing: { status: "stale" as StepStatus, last_run: null, details: null } },
      curation: {},
    };
    expect(adaptPipelineStatus(ui, 7)).toBe(ui);
  });
});
