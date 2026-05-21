import { describe, expect, it } from "vitest";
import {
  AGENT_NO_DETAILS_SENTINEL,
  isActionPrefixRationale,
  isProposerSuggestionRedundant,
  isSuggestedFixRedundant,
  parseProposerSuggestion,
  pickJudgeRowText,
  s10MatchesHeaderUri,
} from "./auditorDetails";

describe("isActionPrefixRationale", () => {
  it("matches Add factor / tag prefixes (case-insensitive)", () => {
    expect(isActionPrefixRationale("Add factor `timepoint` to the design.")).toBe(true);
    expect(isActionPrefixRationale("add tag `cell type: neuron`")).toBe(true);
    expect(isActionPrefixRationale("ADD FACTOR `treatment`")).toBe(true);
  });

  it("matches Remove / Swap / Rename / Keep prefixes", () => {
    expect(isActionPrefixRationale("Remove factor `age` from the design.")).toBe(true);
    expect(isActionPrefixRationale("Remove tag `disease: cancer`.")).toBe(true);
    expect(isActionPrefixRationale("Swap factor `genotype` for `treatment`")).toBe(true);
    expect(isActionPrefixRationale("Rename factor `timepoint` to `dose`")).toBe(true);
    expect(isActionPrefixRationale("Keep factor `treatment` as-is.")).toBe(true);
  });

  it("does not match substantive rationales that happen to start with similar words", () => {
    // "Add evidence ..." is NOT an action prefix — the verb is followed by
    // something other than factor/tag, so the rationale carries content.
    expect(isActionPrefixRationale("Add evidence to support this finding.")).toBe(false);
    // Real WHY-style rationales the curator needs.
    expect(
      isActionPrefixRationale(
        "Study explicitly collects biopsies at two timepoints (7d, 6mo).",
      ),
    ).toBe(false);
    expect(isActionPrefixRationale("")).toBe(false);
    expect(isActionPrefixRationale(null)).toBe(false);
    expect(isActionPrefixRationale(undefined)).toBe(false);
  });
});

describe("isSuggestedFixRedundant", () => {
  it("is redundant when it equals the rationale (modulo punctuation + case)", () => {
    expect(
      isSuggestedFixRedundant(
        "Add factor `timepoint` to the design.",
        null,
        "ADD FACTOR `timepoint` to the design",
      ),
    ).toBe(true);
  });

  it("is redundant when it equals the header action", () => {
    expect(
      isSuggestedFixRedundant(
        "Remove factor `age`.",
        "remove factor `age`",
        null,
      ),
    ).toBe(true);
  });

  it("is not redundant when it carries genuinely different prose", () => {
    expect(
      isSuggestedFixRedundant(
        "Resolve the free-text label to an ontology term.",
        "Add factor `timepoint`",
        "Add factor `timepoint` to the design.",
      ),
    ).toBe(false);
  });

  it("treats empty as redundant (nothing to render)", () => {
    expect(isSuggestedFixRedundant("", "anything", "anything")).toBe(true);
    expect(isSuggestedFixRedundant(null, null, null)).toBe(true);
  });
});

describe("parseProposerSuggestion", () => {
  it("parses the bracketed list shape", () => {
    expect(
      parseProposerSuggestion(
        "timepoint: [7 days post-ICU discharge, 6 months post-ICU discharge]",
      ),
    ).toEqual({
      category: "timepoint",
      values: ["7 days post-ICU discharge", "6 months post-ICU discharge"],
    });
  });

  it("parses the bare comma-separated shape", () => {
    expect(parseProposerSuggestion("treatment: drug, vehicle")).toEqual({
      category: "treatment",
      values: ["drug", "vehicle"],
    });
  });

  it("parses a single-value tag suggestion", () => {
    expect(parseProposerSuggestion("cell type: neuron")).toEqual({
      category: "cell type",
      values: ["neuron"],
    });
  });

  it("returns null when there's no colon", () => {
    expect(parseProposerSuggestion("just some prose without a colon")).toBeNull();
    expect(parseProposerSuggestion("")).toBeNull();
    expect(parseProposerSuggestion(null)).toBeNull();
  });
});

describe("isProposerSuggestionRedundant", () => {
  it("flags as redundant when all FV values are already visible", () => {
    const parsed = parseProposerSuggestion("timepoint: [7d, 6mo]");
    expect(isProposerSuggestionRedundant(parsed, ["7d", "6mo"])).toBe(true);
    // Order shouldn't matter.
    expect(isProposerSuggestionRedundant(parsed, ["6mo", "7d"])).toBe(true);
    // Case insensitive.
    expect(isProposerSuggestionRedundant(parsed, ["7D", "6MO"])).toBe(true);
  });

  it("is not redundant when at least one suggestion value is novel", () => {
    const parsed = parseProposerSuggestion("timepoint: [7d, 6mo, 12mo]");
    expect(isProposerSuggestionRedundant(parsed, ["7d", "6mo"])).toBe(false);
  });

  it("is not redundant when nothing above to compare against", () => {
    const parsed = parseProposerSuggestion("timepoint: [7d]");
    expect(isProposerSuggestionRedundant(parsed, [])).toBe(false);
  });

  it("is redundant when there are no values (bare category)", () => {
    const parsed = parseProposerSuggestion("timepoint:");
    expect(isProposerSuggestionRedundant(parsed, ["anything"])).toBe(true);
  });

  it("is not redundant when the string was unparseable", () => {
    expect(isProposerSuggestionRedundant(null, ["whatever"])).toBe(false);
  });
});

describe("pickJudgeRowText", () => {
  it("prefers defender_verdict.rationale when present", () => {
    expect(pickJudgeRowText("The samples are clearly bisected.", "weaker fallback")).toEqual({
      text: "The samples are clearly bisected.",
      isSentinel: false,
    });
  });

  it("falls back to proposer_defense when defender absent", () => {
    expect(pickJudgeRowText(null, "Study collects two timepoints.")).toEqual({
      text: "Study collects two timepoints.",
      isSentinel: false,
    });
    expect(pickJudgeRowText("", "Study collects two timepoints.")).toEqual({
      text: "Study collects two timepoints.",
      isSentinel: false,
    });
  });

  it("renders the sentinel when both are empty", () => {
    expect(pickJudgeRowText(null, null)).toEqual({
      text: AGENT_NO_DETAILS_SENTINEL,
      isSentinel: true,
    });
    expect(pickJudgeRowText("", "")).toEqual({
      text: AGENT_NO_DETAILS_SENTINEL,
      isSentinel: true,
    });
  });

  it("treats the producer-side sentinel string as empty too", () => {
    // Producer (gemma-curation-agents 6451c39) stamps the literal
    // sentinel into the field instead of "" — we should still render
    // it as a sentinel row, not as actual content.
    expect(
      pickJudgeRowText(AGENT_NO_DETAILS_SENTINEL, AGENT_NO_DETAILS_SENTINEL),
    ).toEqual({
      text: AGENT_NO_DETAILS_SENTINEL,
      isSentinel: true,
    });
    // Sentinel on defender side should fall through to proposer_defense.
    expect(
      pickJudgeRowText(AGENT_NO_DETAILS_SENTINEL, "real proposer reasoning"),
    ).toEqual({
      text: "real proposer reasoning",
      isSentinel: false,
    });
  });
});

describe("s10MatchesHeaderUri", () => {
  const headerUri = "http://purl.obolibrary.org/obo/UBERON_0000044";
  it("matches when the verdict carries the same CURIE", () => {
    expect(
      s10MatchesHeaderUri(
        {
          subtask: "S10_term_validator",
          verdict: '"dorsal root ganglion" → UBERON:0000044  (gemma-new)',
        },
        headerUri,
      ),
    ).toBe(true);
  });

  it("does not match other subtasks even with matching URI text", () => {
    expect(
      s10MatchesHeaderUri(
        {
          subtask: "S7_coverage",
          verdict: "all FVs cited; UBERON:0000044 used as anchor.",
        },
        headerUri,
      ),
    ).toBe(false);
  });

  it("does not match when the URI is different", () => {
    expect(
      s10MatchesHeaderUri(
        {
          subtask: "S10_term_validator",
          verdict: 'subject "ganglion" → UBERON:0000045 (no prior gemma use)',
        },
        headerUri,
      ),
    ).toBe(false);
  });

  it("does not match when no header URI is set", () => {
    expect(
      s10MatchesHeaderUri(
        {
          subtask: "S10_term_validator",
          verdict: '"X" → UBERON:0000044',
        },
        null,
      ),
    ).toBe(false);
  });
});
