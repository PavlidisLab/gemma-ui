/**
 * Pure-model tests for the ticket queue's finding-disposition filter
 * (handoff 2026-07-23). The scenarios mirror the auto-triage workflow:
 * `agent-triage` dismisses the bulk with a reason chip, a curator
 * touches a few, and the pile that matters is `needs_more_info`.
 */
import { describe, expect, it } from "vitest";
import type { AuditReport } from "@/api/auditTypes";
import {
  DISPOSITION_FILTER_ANY,
  dispositionBadgeNoun,
  isDispositionFilterActive,
  mergeTriageRows,
  triageRowMatches,
  triageRowsForReport,
} from "./dispositionFilter";

/** Minimal report with just the fields the fold reads. */
function report(
  findings: Array<{ target_id: string; severity?: string }>,
  dispositions: Array<{
    target_id: string;
    status: string;
    reviewer?: string;
    reviewed_at?: string | null;
    dismiss_reason?: string | null;
    accept_reason?: string | null;
  }>,
): AuditReport {
  return {
    findings: findings.map((f) => ({
      target_id: f.target_id,
      severity: f.severity ?? "minor",
    })),
    dispositions: dispositions.map((d) => ({
      reviewed_at: null,
      notes: "",
      ...d,
    })),
  } as unknown as AuditReport;
}

describe("triageRowsForReport", () => {
  it("defaults an undispositioned target to pending", () => {
    const rows = triageRowsForReport(1, report([{ target_id: "t1" }], []));
    expect(rows).toEqual([
      {
        experimentId: 1,
        targetId: "t1",
        status: "pending",
        reason: null,
        reviewer: null,
      },
    ]);
  });

  it("collapses multiple findings on one target to a single triage row", () => {
    const rows = triageRowsForReport(
      1,
      report([{ target_id: "t1" }, { target_id: "t1" }], []),
    );
    expect(rows).toHaveLength(1);
  });

  it("excludes targets whose findings are all severity ok", () => {
    const rows = triageRowsForReport(
      1,
      report(
        [
          { target_id: "green", severity: "ok" },
          { target_id: "real", severity: "major" },
        ],
        [],
      ),
    );
    expect(rows.map((r) => r.targetId)).toEqual(["real"]);
  });

  it("takes the LATEST disposition per target regardless of server order", () => {
    const rows = triageRowsForReport(
      1,
      report(
        [{ target_id: "t1" }],
        [
          // Newest first — the ordering that broke the old in-order fold.
          {
            target_id: "t1",
            status: "dismissed",
            reviewer: "agent-triage",
            reviewed_at: "2026-07-23T02:00:00Z",
            dismiss_reason: "redundant",
          },
          {
            target_id: "t1",
            status: "pending",
            reviewer: "agent-triage",
            reviewed_at: null,
          },
        ],
      ),
    );
    expect(rows[0].status).toBe("dismissed");
    expect(rows[0].reason).toBe("redundant");
    expect(rows[0].reviewer).toBe("agent-triage");
  });

  it("reads whichever structured reason the status carries", () => {
    const rows = triageRowsForReport(
      1,
      report(
        [{ target_id: "a" }, { target_id: "b" }],
        [
          {
            target_id: "a",
            status: "accepted",
            reviewer: "local-curator",
            reviewed_at: "2026-07-23T02:00:00Z",
            accept_reason: "well_evidenced",
          },
          {
            target_id: "b",
            status: "dismissed",
            reviewer: "agent-triage",
            reviewed_at: "2026-07-23T02:00:00Z",
            dismiss_reason: "out_of_scope",
          },
        ],
      ),
    );
    const byId = new Map(rows.map((r) => [r.targetId, r]));
    expect(byId.get("a")?.reason).toBe("well_evidenced");
    expect(byId.get("b")?.reason).toBe("out_of_scope");
  });

  it("returns nothing for a missing report", () => {
    expect(triageRowsForReport(1, undefined)).toEqual([]);
  });
});

describe("triageRowMatches — the auto-triage question", () => {
  // Ticket-140 shape: 30 auto-dismissed, 1 curator-dismissed,
  // 7 needs_more_info.
  const rows = [
    ...Array.from({ length: 30 }, (_, i) => ({
      experimentId: 1,
      targetId: `auto${i}`,
      status: "dismissed" as const,
      reason: "correct_but_against_guidelines",
      reviewer: "agent-triage",
    })),
    {
      experimentId: 1,
      targetId: "manual",
      status: "dismissed" as const,
      reason: "weak_evidence",
      reviewer: "local-curator",
    },
    ...Array.from({ length: 7 }, (_, i) => ({
      experimentId: 1,
      targetId: `nmi${i}`,
      status: "needs_more_info" as const,
      reason: null,
      reviewer: "agent-triage",
    })),
  ];

  it("one click isolates the needs_more_info pile", () => {
    const f = { ...DISPOSITION_FILTER_ANY, status: "needs_more_info" as const };
    expect(rows.filter((r) => triageRowMatches(r, f))).toHaveLength(7);
  });

  it("axes AND together — agent-dismissed with a specific reason", () => {
    const f = {
      status: "dismissed" as const,
      reason: "correct_but_against_guidelines",
      reviewer: "agent-triage",
    };
    expect(rows.filter((r) => triageRowMatches(r, f))).toHaveLength(30);
  });

  it("reviewer alone splits agent triage from curator calls", () => {
    const f = { ...DISPOSITION_FILTER_ANY, reviewer: "local-curator" };
    expect(rows.filter((r) => triageRowMatches(r, f))).toHaveLength(1);
  });

  it("the ANY filter matches everything and reads as inactive", () => {
    expect(rows.every((r) => triageRowMatches(r, DISPOSITION_FILTER_ANY))).toBe(
      true,
    );
    expect(isDispositionFilterActive(DISPOSITION_FILTER_ANY)).toBe(false);
    expect(
      isDispositionFilterActive({
        ...DISPOSITION_FILTER_ANY,
        reason: "redundant",
      }),
    ).toBe(true);
  });
});

describe("mergeTriageRows — audit-kind ∪ proposal-kind", () => {
  const pending = {
    experimentId: 1,
    targetId: "shared",
    status: "pending" as const,
    reason: null,
    reviewer: null,
  };
  const decided = {
    ...pending,
    status: "dismissed" as const,
    reason: "redundant",
    reviewer: "agent-triage",
  };

  it("unions distinct targets from both kinds", () => {
    const merged = mergeTriageRows(
      [{ ...pending, targetId: "a" }],
      [{ ...pending, targetId: "b" }],
    );
    expect(merged.map((r) => r.targetId).sort()).toEqual(["a", "b"]);
  });

  it("on a shared target, a decision beats a pending — from either side", () => {
    expect(mergeTriageRows([pending], [decided])[0].status).toBe("dismissed");
    expect(mergeTriageRows([decided], [pending])[0].status).toBe("dismissed");
    expect(mergeTriageRows([pending], [decided])).toHaveLength(1);
  });
});

describe("dispositionBadgeNoun", () => {
  it("is status-specific when the status axis is set, generic otherwise", () => {
    expect(
      dispositionBadgeNoun({
        ...DISPOSITION_FILTER_ANY,
        status: "needs_more_info",
      }),
    ).toBe("need info");
    expect(
      dispositionBadgeNoun({ ...DISPOSITION_FILTER_ANY, reason: "redundant" }),
    ).toBe("matching");
  });
});
