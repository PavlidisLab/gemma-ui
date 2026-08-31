import { describe, expect, it } from "vitest";
import { groupAuditEvents, GROUP_GAP_MS } from "./auditGroups";
import type { AuditEvent } from "@/api/history";

const ev = (
  over: Partial<AuditEvent> & { date: string; event_type: string },
): AuditEvent => ({
  id: Math.random(),
  performer: "administrator",
  action: "U",
  note: "",
  detail: "",
  shape: null,
  ...over,
});

/** Newest first, as the panel renders. */
const T = (min: number) => new Date(Date.UTC(2026, 7, 30, 12, min)).toISOString();

describe("groupAuditEvents", () => {
  it("folds a standard postprocessing run into one row", () => {
    // The real run on 27103: 12:05 → 12:10.
    const rows = [
      ev({ date: T(10), event_type: "GeeqEvent" }),
      ev({ date: T(8), event_type: "PCAAnalysisEvent" }),
      ev({ date: T(8), event_type: "MeanVarianceUpdateEvent" }),
      ev({ date: T(8), event_type: "SampleCorrelationAnalysisEvent" }),
      ev({ date: T(7), event_type: "ProcessedVectorComputationEvent" }),
      ev({ date: T(5), event_type: "DataReplacedEvent" }),
    ];
    const out = groupAuditEvents(rows);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("group");
    if (out[0].type !== "group") throw new Error("unreachable");
    expect(out[0].group.kind).toBe("postprocessing");
    expect(out[0].group.events).toHaveLength(6);
    expect(out[0].group.from).toBe(T(5));
    expect(out[0].group.to).toBe(T(10));
  });

  it("folds a curation commit spanning 13 minutes", () => {
    // Paul's case: DesignChange 02:05, tags 02:18 — one act.
    const rows = [
      ev({ date: T(18), event_type: "TagAddedEvent" }),
      ev({ date: T(18), event_type: "TagRemovedEvent" }),
      ev({ date: T(5), event_type: "DesignChangeEvent" }),
    ];
    const out = groupAuditEvents(rows);
    expect(out).toHaveLength(1);
    if (out[0].type !== "group") throw new Error("unreachable");
    expect(out[0].group.kind).toBe("curation");
    expect(out[0].group.events).toHaveLength(3);
  });

  it("🛑 never folds a failure — it stays its own row and splits the run", () => {
    const rows = [
      ev({ date: T(10), event_type: "GeeqEvent" }),
      ev({ date: T(9), event_type: "FailedProcessedVectorComputationEvent" }),
      ev({ date: T(8), event_type: "PCAAnalysisEvent" }),
      ev({ date: T(7), event_type: "MeanVarianceUpdateEvent" }),
    ];
    const out = groupAuditEvents(rows);
    // Geeq alone, the failure alone, then the two that ran before it.
    expect(out.map((r) => r.type)).toEqual(["event", "event", "group"]);
    if (out[1].type !== "event") throw new Error("unreachable");
    expect(out[1].event.event_type).toBe(
      "FailedProcessedVectorComputationEvent",
    );
  });

  it("keeps the two families apart", () => {
    const rows = [
      ev({ date: T(10), event_type: "TagAddedEvent" }),
      ev({ date: T(9), event_type: "GeeqEvent" }),
      ev({ date: T(8), event_type: "PCAAnalysisEvent" }),
    ];
    const out = groupAuditEvents(rows);
    expect(out.map((r) => r.type)).toEqual(["event", "group"]);
  });

  it("a different performer starts a new group, however close in time", () => {
    const rows = [
      ev({ date: T(10), event_type: "GeeqEvent", performer: "ama" }),
      ev({ date: T(10), event_type: "PCAAnalysisEvent", performer: "rogic" }),
      ev({ date: T(10), event_type: "MeanVarianceUpdateEvent", performer: "rogic" }),
    ];
    const out = groupAuditEvents(rows);
    expect(out.map((r) => r.type)).toEqual(["event", "group"]);
  });

  it("breaks the run when the gap is too wide", () => {
    const far = new Date(
      Date.parse(T(10)) - GROUP_GAP_MS - 1000,
    ).toISOString();
    const rows = [
      ev({ date: T(10), event_type: "GeeqEvent" }),
      ev({ date: far, event_type: "PCAAnalysisEvent" }),
    ];
    expect(groupAuditEvents(rows).map((r) => r.type)).toEqual([
      "event",
      "event",
    ]);
  });

  it("a run of one stays a plain row", () => {
    const out = groupAuditEvents([ev({ date: T(10), event_type: "GeeqEvent" })]);
    expect(out.map((r) => r.type)).toEqual(["event"]);
  });

  it("passes ungrouped kinds through in order", () => {
    const rows = [
      ev({ date: T(10), event_type: "CommentedEvent" }),
      ev({ date: T(9), event_type: "" , action: "C" }),
    ];
    expect(groupAuditEvents(rows).map((r) => r.type)).toEqual([
      "event",
      "event",
    ]);
  });
});
