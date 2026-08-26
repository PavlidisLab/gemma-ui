import { describe, expect, it } from "vitest";
import {
  actionLabels,
  acceptLabel,
  blockedReasonOf,
  findingActionShape,
} from "./actionLabels";
import type { AuditFinding } from "@/api/auditTypes";

/** Build a minimal AuditFinding shape sufficient for
 *  ``findingActionShape``. The function reads `issue_code` (and
 *  `severity` only for the legacy `calibration_factor_match` code),
 *  so the rest can stay unpopulated / stubbed. */
function f(
  issue_code: string,
  severity: AuditFinding["severity"] = "minor",
): AuditFinding {
  return {
    id: "stub-id",
    audit_id: "stub-audit",
    target_kind: "factor",
    target_id: "stub",
    issue_code,
    severity,
    rationale: "",
    proposer_flags: [],
    proposer_term: null,
    proposer_defense: null,
    defender_verdict: null,
    partition_mismatch: null,
    apply_action: null,
    disposition_status: "pending",
    disposition_reason: null,
    disposition_note: null,
    applied_fix: null,
    suggested_fix: null,
    fix_applied_at: null,
    created_at: "2026-05-21T00:00:00Z",
    updated_at: "2026-05-21T00:00:00Z",
  } as unknown as AuditFinding;
}

describe("findingActionShape", () => {
  it("calibration_factor_extra → add (new factor)", () => {
    expect(findingActionShape(f("calibration_factor_extra"))).toBe("add");
  });

  it("calibration_agent_extra → add (new tag — the design review's screenshot)", () => {
    expect(findingActionShape(f("calibration_agent_extra"))).toBe("add");
  });

  it("calibration_factor_gold_only_miss → remove", () => {
    expect(findingActionShape(f("calibration_factor_gold_only_miss"))).toBe(
      "remove",
    );
  });

  it("calibration_gold_only_miss → remove (tag removal)", () => {
    expect(findingActionShape(f("calibration_gold_only_miss"))).toBe("remove");
  });

  it("calibration_factor_match_near → change (per-FV edit)", () => {
    expect(findingActionShape(f("calibration_factor_match_near"))).toBe(
      "change",
    );
  });

  it("calibration_factor_match_close → change (older alias)", () => {
    expect(findingActionShape(f("calibration_factor_match_close"))).toBe(
      "change",
    );
  });

  it("calibration_factor_partition_mismatch → change (FV reorg)", () => {
    expect(findingActionShape(f("calibration_factor_partition_mismatch"))).toBe(
      "change",
    );
  });

  it("calibration_factor_rename → change", () => {
    expect(findingActionShape(f("calibration_factor_rename"))).toBe("change");
  });

  it("calibration_factor_match_exact → match", () => {
    expect(findingActionShape(f("calibration_factor_match_exact"))).toBe(
      "match",
    );
  });

  it("calibration_match → match (tag exact)", () => {
    expect(findingActionShape(f("calibration_match"))).toBe("match");
  });

  it("legacy calibration_factor_match at ok severity → match", () => {
    expect(findingActionShape(f("calibration_factor_match", "ok"))).toBe(
      "match",
    );
  });

  it("legacy calibration_factor_match at minor severity → change", () => {
    expect(findingActionShape(f("calibration_factor_match", "minor"))).toBe(
      "change",
    );
  });

  it("unknown issue_code → change (safe default)", () => {
    expect(findingActionShape(f("some_future_code"))).toBe("change");
  });
});

describe("actionLabels", () => {
  it("add → (don't add, add)", () => {
    expect(actionLabels("add")).toEqual({ keep: "don't add", adopt: "add" });
  });

  it("remove → (don't remove, remove)", () => {
    expect(actionLabels("remove")).toEqual({
      keep: "don't remove",
      adopt: "remove",
    });
  });

  it("change → (don't change, adopt)", () => {
    expect(actionLabels("change")).toEqual({
      keep: "don't change",
      adopt: "adopt",
    });
  });

  it("match → (disagree, confirm) — never two identical labels", () => {
    // Two buttons reading "confirm", one of which opened a dialog
    // titled "Disagree" (2026-08-09). Rows that collapse the pair show
    // only the adopt verb; rows that don't must still read correctly.
    expect(actionLabels("match")).toEqual({
      keep: "disagree",
      adopt: "confirm",
    });
  });

  it("no shape produces the same label on both buttons", () => {
    for (const shape of ["add", "remove", "change", "match"] as const) {
      const { keep, adopt } = actionLabels(shape);
      expect(keep).not.toBe(adopt);
    }
  });
});

describe("tag-side match codes (2026-08-09)", () => {
  // GSE198756 rendered "don't change" / "adopt Auditor's" on a card
  // reading "TAG MATCH — developmental stage : embryo stage", because
  // `calibration_tag_match_exact` was absent from the mapping and fell
  // to the "change" default. A match offers ONE confirm.
  it("calibration_tag_match_exact → match", () => {
    expect(findingActionShape(f("calibration_tag_match_exact", "ok"))).toBe(
      "match",
    );
    expect(
      actionLabels(findingActionShape(f("calibration_tag_match_exact", "ok"))),
    ).toEqual({ keep: "disagree", adopt: "confirm" });
  });

  it("calibration_tag_match_near → change (a different term IS a change)", () => {
    expect(findingActionShape(f("calibration_tag_match_near", "minor"))).toBe(
      "change",
    );
  });

  it("still downgrades to add when the displayed baseline is empty", () => {
    // The match-downgrade rule owns the goldEmpty case; the new
    // mappings must not shadow it.
    expect(
      findingActionShape(f("calibration_match", "ok"), { goldEmpty: true }),
    ).toBe("add");
  });
});

/**
 * The fallback verb — an action the agent could not express.
 *
 * Real fixture: audit 45cc7771 on GSE274093. `term_grounding_judge`
 * asks whether `Rosa26fsTRAP X Nav1.8-Cre` resolves to a strain term,
 * finds nothing (it is a custom mouse line), and says so. Every other
 * field on the action is null, so there is nothing whatsoever to adopt
 * — and the card offered "adopt Auditor's" until this shape existed.
 *
 * 🛑 These pin the SHAPE, not the kind's name. The kind is being
 * renamed away from `needs_curator_decision`; a test matching the
 * string would have to be edited to keep passing, which is the bug it
 * is supposed to catch.
 */
function undecidable(issue_code = "ungrounded_term"): AuditFinding {
  return {
    ...f(issue_code, "minor"),
    apply_action: {
      kind: "needs_curator_decision",
      blocked_reason:
        "`Rosa26fsTRAP X Nav1.8-Cre` resolves to no term in the `strain` namespace; a slot URI is looked up, never invented",
    },
  } as unknown as AuditFinding;
}

describe("actions the agent could not express", () => {
  it("reads the reason off the payload without naming the kind", () => {
    expect(blockedReasonOf(undecidable())).toMatch(/no term in the .strain./);
    // No action at all, and an action with no reason, are both absent.
    expect(blockedReasonOf(f("ungrounded_term"))).toBeNull();
  });

  it("treats a blank reason as no reason", () => {
    const blank = {
      ...f("ungrounded_term"),
      apply_action: { kind: "needs_curator_decision", blocked_reason: "   " },
    } as unknown as AuditFinding;
    expect(blockedReasonOf(blank)).toBeNull();
    // ...and therefore does NOT claim the decide shape on an empty punt.
    expect(findingActionShape(blank)).toBe("change");
  });

  it("shapes as a decision, not the change default", () => {
    expect(findingActionShape(undecidable())).toBe("decide");
  });

  it("never offers to adopt something that does not exist", () => {
    const labels = actionLabels(findingActionShape(undecidable()));
    expect(labels.adopt).not.toMatch(/adopt/i);
    expect(labels.keep).not.toBe("don't change");
  });

  it("drops the possessive — there is no auditor's proposal to take", () => {
    // "needs action Auditor's" is the hanging possessive in its worst
    // form: it names a proposal the finding exists to say is absent.
    const s = acceptLabel(findingActionShape(undecidable()), "Auditor");
    expect(s).not.toMatch(/Auditor/);
  });

  it("beats the goldEmpty downgrade — an Add that cannot add is worse", () => {
    // goldEmpty turns match codes into "add". For an inexpressible
    // action that would render an Add button with nothing to add.
    expect(
      findingActionShape(undecidable("calibration_match"), { goldEmpty: true }),
    ).toBe("decide");
  });
});
