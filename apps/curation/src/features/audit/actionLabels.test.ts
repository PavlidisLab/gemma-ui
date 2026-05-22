import { describe, expect, it } from "vitest";
import { actionLabels, findingActionShape } from "./actionLabels";
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

  it("calibration_agent_extra → add (new tag — Paul's screenshot)", () => {
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

  it("match → (confirm, confirm)", () => {
    expect(actionLabels("match")).toEqual({
      keep: "confirm",
      adopt: "confirm",
    });
  });
});
