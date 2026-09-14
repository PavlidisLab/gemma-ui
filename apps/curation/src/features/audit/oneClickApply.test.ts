import { describe, expect, it } from "vitest";

import type { AuditFinding, AuditReport } from "@/api/auditTypes";
import kindList from "../../../generated/applyActionKinds.json";

import {
  annotationSetIdOf,
  EXECUTING_KINDS,
  oneClickEligible,
} from "./oneClickApply";

const KINDS = (
  kindList as unknown as { kinds: { kind: string; executes: boolean }[] }
).kinds;

const finding = (kind: string, findingId: string | null = "f1") =>
  ({
    finding_id: findingId,
    target_id: "tag:strain/c57bl-6",
    apply_action: { kind },
  }) as unknown as AuditFinding;

const report = (auditId: string | null = "20113") =>
  ({ audit_id: auditId }) as unknown as AuditReport;

describe("oneClickEligible — read off the agents' kind list", () => {
  it("every kind the agent executes is eligible in remote mode", () => {
    const executing = KINDS.filter((k) => k.executes);
    expect(executing.length).toBeGreaterThan(0);
    for (const { kind } of executing) {
      expect(oneClickEligible(finding(kind), report(), "remote")).toBe(true);
    }
  });

  it("a kind the agent does not execute keeps the existing path", () => {
    const idle = KINDS.filter((k) => !k.executes);
    expect(idle.map((k) => k.kind)).toContain("needs_curator_decision");
    for (const { kind } of idle) {
      expect(oneClickEligible(finding(kind), report(), "remote")).toBe(false);
    }
    expect(oneClickEligible(finding("not_a_kind"), report(), "remote")).toBe(false);
  });

  it("the multi-edit shape is executable", () => {
    expect(EXECUTING_KINDS.has("edit_set")).toBe(true);
  });

  it("never in local mode", () => {
    expect(oneClickEligible(finding("remove_tag"), report(), "local")).toBe(false);
  });

  it("needs a finding id and a stored annotation set", () => {
    expect(oneClickEligible(finding("remove_tag", null), report(), "remote")).toBe(false);
    expect(oneClickEligible(finding("remove_tag"), report("test-audit-1"), "remote")).toBe(false);
    expect(oneClickEligible(finding("remove_tag"), null, "remote")).toBe(false);
  });
});

describe("annotationSetIdOf", () => {
  it("is the Gemma set id, or null for a report without one", () => {
    expect(annotationSetIdOf(report("20113"))).toBe("20113");
    expect(annotationSetIdOf(report(null))).toBeNull();
    expect(annotationSetIdOf(report("synth-override"))).toBeNull();
  });
});
