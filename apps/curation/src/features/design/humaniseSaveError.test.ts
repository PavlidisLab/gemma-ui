/**
 * The error a curator actually reads.
 *
 * Two backends answer through one client — the agent relay speaks
 * FastAPI's `{detail}`, Gemma speaks `{error:{code,message}}` — and
 * losing either one shows a bare status with the reason discarded.
 * Bytes below are from the 400 Paul hit deleting a factor value on
 * GSE32473 (cab, 2026-09-04).
 */
import { describe, expect, it } from "vitest";

import { humaniseSaveError } from "./CommitBar";

const GEMMA_400 =
  'POST /curation-preflight/5391 failed: 400 Bad Request ' +
  JSON.stringify({
    error: {
      code: 400,
      message:
        'Unrecognized field "baselineRelevance" (class ubic.gemma.rest.' +
        'DatasetsWebService$FactorCommit), not marked as ignorable ' +
        '(8 known properties: "factorValues", "clientRef", "type", "name", ' +
        '"description", "gemmaId", "supportingEvidence", "category")',
    },
  });

describe("🛑 Gemma's error envelope", () => {
  it("shows the message that names the field", () => {
    const out = humaniseSaveError(GEMMA_400);
    expect(out).toContain("baselineRelevance");
    expect(out).toContain("8 known properties");
  });

  it("no longer stops at the bare status", () => {
    // The regression: "save rejected: 400 Bad Request" and nothing
    // else, while the body named the exact problem.
    expect(humaniseSaveError(GEMMA_400)).not.toBe("400 Bad Request");
  });

  it("keeps the status alongside it", () => {
    expect(humaniseSaveError(GEMMA_400)).toContain("400 Bad Request");
  });
});

describe("FastAPI's envelope still works", () => {
  it("reads a string detail", () => {
    const raw =
      'PUT /rest/v2/x failed: 409 Conflict ' +
      JSON.stringify({ detail: "stale baseline" });
    expect(humaniseSaveError(raw)).toBe("409 Conflict — stale baseline");
  });

  it("reads a validation array", () => {
    const raw =
      'POST /x failed: 422 Unprocessable ' +
      JSON.stringify({
        detail: [{ loc: ["body", "id"], msg: "must be an integer" }],
      });
    expect(humaniseSaveError(raw)).toContain("body.id: must be an integer");
  });
});

describe("degrading", () => {
  it("passes a non-JSON message through unchanged", () => {
    expect(humaniseSaveError("network unreachable")).toBe(
      "network unreachable",
    );
  });
});
