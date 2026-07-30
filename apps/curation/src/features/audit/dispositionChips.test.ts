import { describe, expect, it } from "vitest";
import type { AuditFinding } from "@/api/auditTypes";
import {
  CAL_EXTRA_FACTOR_DISMISS_CHIPS,
  CAL_EXTRA_TAG_DISMISS_CHIPS,
  CAL_MISS_FACTOR_DISMISS_CHIPS,
  CAL_MISS_TAG_DISMISS_CHIPS,
  DISMISS_CHIPS,
  TAG_DISMISS_CHIPS,
  dismissChipsFor,
} from "./dispositionChips";

/**
 * Contract tests for the dismiss-chip router.
 *
 * Motivating change (the reviewer, 2026-06-12): "a disposition for a tag like
 * 'Only applies to some samples' would be more helpful than 'weak
 * evidence' or 'out of scope'." The reason already existed wire-side
 * (``not_sample_applicable``) but the server gated it to
 * ``calibration_agent_extra`` only. The agents side widened the gate to all
 * tag-target findings; the curation UI now
 * surfaces "Subset only" + "Redundant" on every tag-target dismiss
 * dialog that isn't already routed to a calibration-specific set.
 *
 * Pin the routing so:
 *   - calibration_agent_extra (tag) keeps its existing chip set
 *     (Subset only is already in there, but in the original
 *     calibration shape — don't accidentally double-shadow).
 *   - calibration_*_gold_only_miss keeps CAL_MISS.
 *   - calibration_factor_extra keeps the factor-flavoured set.
 *   - Every OTHER tag-target finding routes to TAG_DISMISS_CHIPS
 *     (which includes both Subset only + Redundant).
 *   - Factor-target findings without a calibration-specific route
 *     fall through to the generic DISMISS_CHIPS.
 */

function mkFinding(
  partial: Partial<AuditFinding> & Pick<AuditFinding, "issue_code" | "target_kind">,
): AuditFinding {
  return {
    target_id: "test:1",
    severity: "minor",
    rationale: "",
    citation: "",
    citation_url: "",
    suggested_fix: "",
    proposer_suggestion: "",
    ...partial,
  };
}

describe("dismissChipsFor — calibration routing (unchanged)", () => {
  it("routes calibration_gold_only_miss (tag) to CAL_MISS_TAG — tags have no FVs/partition/structure", () => {
    // Design review 2026-06-15: tag-side removal dismiss must NOT show
    // factor-flavoured chips like "Wrong partition" / "Structure
    // correct, FVs wrong" — tags don't have those concepts.
    expect(
      dismissChipsFor(
        mkFinding({ issue_code: "calibration_gold_only_miss", target_kind: "tag" }),
      ),
    ).toBe(CAL_MISS_TAG_DISMISS_CHIPS);
  });

  it("routes calibration_factor_gold_only_miss to CAL_MISS_FACTOR — factor-shaped vocab", () => {
    expect(
      dismissChipsFor(
        mkFinding({
          issue_code: "calibration_factor_gold_only_miss",
          target_kind: "factor",
        }),
      ),
    ).toBe(CAL_MISS_FACTOR_DISMISS_CHIPS);
  });

  it("routes calibration_agent_extra (tag) to CAL_EXTRA_TAG", () => {
    expect(
      dismissChipsFor(
        mkFinding({ issue_code: "calibration_agent_extra", target_kind: "tag" }),
      ),
    ).toBe(CAL_EXTRA_TAG_DISMISS_CHIPS);
  });

  it("routes calibration_factor_extra to CAL_EXTRA_FACTOR", () => {
    expect(
      dismissChipsFor(
        mkFinding({
          issue_code: "calibration_factor_extra",
          target_kind: "factor",
        }),
      ),
    ).toBe(CAL_EXTRA_FACTOR_DISMISS_CHIPS);
  });
});

describe("dismissChipsFor — tag-target widening (2026-06-12)", () => {
  // 2026-06-14 chip-vocab restructure (per design review + the agents-side open-enum
  // wire). The previous "everything-tag routes to TAG_DISMISS_CHIPS"
  // assumption was too coarse — match findings need "not a match"
  // chips, add/remove findings need their own asymmetric chip sets.
  // The tests below pin the new per-code routing.
  it("routes TAG MATCH (calibration_match) to TAG_MATCH_DISMISS_CHIPS — 'not a match' framing with sample-applicability chip", () => {
    const chips = dismissChipsFor(
      mkFinding({ issue_code: "calibration_match", target_kind: "tag" }),
    );
    expect(chips.map((c) => c.key)).toContain("category_mismatch");
    // Tag matches get the sample-applicability chip, NOT the
    // partition chip (partitions are a factor concept). The reviewer
    // 2026-06-14.
    expect(chips.map((c) => c.key)).toContain("not_sample_applicable");
    expect(chips.map((c) => c.key)).not.toContain("partition_mismatch");
  });

  it("routes entity-frame tag_proposed_match_with_design to TAG_MATCH_DISMISS_CHIPS", () => {
    const chips = dismissChipsFor(
      mkFinding({
        issue_code: "tag_proposed_match_with_design",
        target_kind: "tag",
      }),
    );
    expect(chips.map((c) => c.key)).toContain("category_mismatch");
  });

  it("routes entity-frame tag_proposed_new to CAL_EXTRA_TAG_DISMISS_CHIPS — 'don't add tag' framing", () => {
    const chips = dismissChipsFor(
      mkFinding({ issue_code: "tag_proposed_new", target_kind: "tag" }),
    );
    expect(chips.map((c) => c.key)).toContain("not_sample_applicable");
  });

  it("routes entity-frame tag_design_missing_from_agent to CAL_MISS_TAG — 'don't remove tag' framing", () => {
    // Design review 2026-06-15 split: tag-side removal-dismiss now uses tag
    // vocab ("Agent missed it" / "Applies broadly" / …) — factor
    // vocab ("Factor needed" / "Wrong partition") no longer leaks
    // into tag cards.
    const chips = dismissChipsFor(
      mkFinding({
        issue_code: "tag_design_missing_from_agent",
        target_kind: "tag",
      }),
    );
    expect(chips).toBe(CAL_MISS_TAG_DISMISS_CHIPS);
    expect(chips.map((c) => c.key)).toContain("agent_missed_it");
  });

  it("routes unknown tag-target issue codes to TAG_DISMISS_CHIPS (forward-compat)", () => {
    // New tag-side issue codes the agents side might emit later: route to the
    // tag-flavoured vocab automatically rather than falling through
    // to the generic set (which lacks the tag-shape chips).
    expect(
      dismissChipsFor(
        mkFinding({ issue_code: "tag_some_future_code", target_kind: "tag" }),
      ),
    ).toBe(TAG_DISMISS_CHIPS);
  });

  it("TAG_DISMISS_CHIPS leads with the tag-shape chips ahead of the generic ones", () => {
    // The curator-discoverability argument hinges on the
    // tag-shape chips appearing FIRST. Lock the ordering so a
    // future-me refactoring the list can't accidentally bury them.
    expect(TAG_DISMISS_CHIPS[0].key).toBe("not_sample_applicable");
    expect(TAG_DISMISS_CHIPS[1].key).toBe("redundant_with_bm_source");
  });
});

describe("dismissChipsFor — factor-target fallback (unchanged)", () => {
  it("routes unknown factor-target codes to generic DISMISS_CHIPS", () => {
    // No tag-shape chips on the factor side — factor values define
    // their sample groupings explicitly, so 'Subset only' doesn't
    // apply structurally.
    const chips = dismissChipsFor(
      mkFinding({ issue_code: "factor_some_code", target_kind: "factor" }),
    );
    expect(chips).toBe(DISMISS_CHIPS);
    expect(chips.map((c) => c.key)).not.toContain("not_sample_applicable");
  });

  it("routes experiment-target codes to generic DISMISS_CHIPS", () => {
    expect(
      dismissChipsFor(
        mkFinding({
          issue_code: "experiment_some_code",
          target_kind: "experiment",
        }),
      ),
    ).toBe(DISMISS_CHIPS);
  });
});
