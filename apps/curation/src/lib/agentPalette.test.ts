import { describe, expect, it } from "vitest";
import { isLlmModelId, isProseModel } from "./agentPalette";

/**
 * `isLlmModelId` decides what the identity pill CLAIMS about a row —
 * "model" vs "batch" — so the fixtures below are the real strings out
 * of the curation store, not invented ones. Of 573 proposal rows, 389
 * read `adhoc-decision-ticket` and 130 `evaluations`; exactly two named
 * an LLM. Calling that population "MODEL" is the defect this guards.
 */

// Every distinct non-LLM value observed in curation_review.model.
const BATCH_LABELS = [
  "adhoc-decision-ticket",
  "evaluations",
  "difficult-set-29-boss-on-2026-06-30",
  "category-policy-rebuild-2026-08-09",
  "boss-dedup-rerun-2026-07-01",
  "runs",
];

const MODEL_IDS = [
  "claude-sonnet-5",
  "claude-haiku-4-5-20251001",
  "claude-opus-5",
  "gpt-4o",
  "gemini-2.5-pro",
];

describe("isLlmModelId", () => {
  it("recognises the model ids that really appear on rows", () => {
    for (const m of MODEL_IDS) {
      expect(isLlmModelId(m), m).toBe(true);
    }
  });

  it("does NOT call a named batch a model", () => {
    for (const m of BATCH_LABELS) {
      expect(isLlmModelId(m), m).toBe(false);
    }
  });

  it("treats an unknown string as a batch, not a model", () => {
    // The safe direction: calling a run a run is never wrong, calling
    // it a model is. Batch names are free text and unguessable.
    expect(isLlmModelId("some-new-eval-sweep-2027")).toBe(false);
    expect(isLlmModelId("hybrid-v6")).toBe(false);
  });

  it("is empty-safe", () => {
    expect(isLlmModelId(null)).toBe(false);
    expect(isLlmModelId(undefined)).toBe(false);
    expect(isLlmModelId("")).toBe(false);
    expect(isLlmModelId("   ")).toBe(false);
  });

  it("does not claim a prose review-context string is a model", () => {
    // Inter-curator audits write a sentence here; the pill renders
    // those as "review" and must not race that branch.
    const prose = "inter-curator audit · Curator B's curation applied";
    expect(isProseModel(prose)).toBe(true);
    expect(isLlmModelId(prose)).toBe(false);
  });

  it("matches on the family prefix, not a substring anywhere", () => {
    // A batch that merely mentions a model is still a batch.
    expect(isLlmModelId("rerun-with-claude-sonnet-5")).toBe(false);
  });
});
