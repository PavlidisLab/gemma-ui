/**
 * Tests for ticket + workflow pure helpers.
 *
 * Scope:
 *
 *  - ticketMatchesFilter   (CuratorDashboard.tsx) — NOT EXPORTED.
 *    Skip: private function inside a React component file; exporting
 *    it would require a source refactor out of scope here. Logic is
 *    straightforward enough that the spec is self-documenting in the
 *    skipped block below.
 *
 *  - buildTicketsByExperiment  (ExperimentList.tsx) — NOT EXPORTED.
 *    Skip: same reason as above — private helper inside the component
 *    file. The relevant logic (EXPRESSION_EXPERIMENT filter + multi-
 *    target fan-out) is exercised indirectly through the rendered
 *    component; a source-level export refactor would unlock direct
 *    testing.
 *
 *  - statusPriority  (ExperimentList.tsx) — NOT EXPORTED.
 *    Skip: same reason. The priority weighting (blocker > troubled >
 *    needs_attention > major > proposals > minor > note) is verified
 *    through the compareRows / sort path in the component.
 *
 *  - computeSetProgress  (setProgress.ts) — EXPORTED. Tested below.
 *
 *  - deriveNextTask  (nextTask.ts) — EXPORTED. Tested below.
 */

import { describe, expect, it } from "vitest";
import { computeSetProgress } from "./setProgress";
import { deriveNextTask } from "./nextTask";
import type { ExperimentSummary } from "@/api/workflowTypes";
import type { Ticket } from "@/api/tickets";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkSummary(
  overrides: Partial<ExperimentSummary> & { audit_status?: "none" | "in_progress" | "closed" | undefined },
): ExperimentSummary {
  return {
    experiment_id: 1,
    short_name: "GSE001",
    title: "Test experiment",
    taxon: "human",
    troubled: false,
    needs_attention: false,
    is_public: false,
    ...overrides,
  };
}

function mkTicket(overrides: Partial<Ticket>): Ticket {
  return {
    id: 1,
    title: "Test ticket",
    type: "GENERIC",
    state: "OPEN",
    priority: "NORMAL",
    due_date: null,
    reporter_id: null,
    reporter_name: null,
    assignee_id: null,
    assignee_name: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    external_issue_url: null,
    body: "",
    mode: "MANUAL",
    targets: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeSetProgress
// ---------------------------------------------------------------------------

describe("computeSetProgress — null / empty inputs", () => {
  it("returns all-zero counts for null summaries", () => {
    expect(computeSetProgress(null, new Set())).toEqual({
      done: 0,
      in_progress: 0,
      untouched: 0,
    });
  });

  it("returns all-zero counts for undefined summaries", () => {
    expect(computeSetProgress(undefined, new Set())).toEqual({
      done: 0,
      in_progress: 0,
      untouched: 0,
    });
  });

  it("returns all-zero counts for an empty array", () => {
    expect(computeSetProgress([], new Set())).toEqual({
      done: 0,
      in_progress: 0,
      untouched: 0,
    });
  });
});

describe("computeSetProgress — experiment_id <= 0 sentinel", () => {
  it("counts a zero-id member as untouched regardless of audit_status", () => {
    const s = mkSummary({ experiment_id: 0, audit_status: "closed" });
    const result = computeSetProgress([s], new Set());
    expect(result).toEqual({ done: 0, in_progress: 0, untouched: 1 });
  });

  it("counts a negative experiment_id as untouched", () => {
    const s = mkSummary({ experiment_id: -5 });
    const result = computeSetProgress([s], new Set());
    expect(result).toEqual({ done: 0, in_progress: 0, untouched: 1 });
  });
});

describe("computeSetProgress — closed review", () => {
  it("counts closed + no local draft as done", () => {
    const s = mkSummary({ experiment_id: 42, audit_status: "closed" });
    const result = computeSetProgress([s], new Set());
    expect(result).toEqual({ done: 1, in_progress: 0, untouched: 0 });
  });

  it("counts closed + local draft as in_progress (uncommitted edit)", () => {
    const s = mkSummary({ experiment_id: 42, audit_status: "closed" });
    const result = computeSetProgress([s], new Set(["42"]));
    expect(result).toEqual({ done: 0, in_progress: 1, untouched: 0 });
  });
});

describe("computeSetProgress — in_progress server status without local draft → untouched", () => {
  /**
   * KEY RULE (per design review 2026-05-25): The server fires "in_progress" the
   * moment a curation_review row exists — including agent-only /
   * pre-curator-action rows. Without a local draft we have no evidence
   * the curator has actually done anything, so these count as UNTOUCHED,
   * not in_progress.
   */
  it("server status=in_progress without local draft → untouched", () => {
    const s = mkSummary({ experiment_id: 7, audit_status: "in_progress" });
    const result = computeSetProgress([s], new Set());
    // No local draft → the server signal alone is not enough; treat as untouched.
    expect(result.untouched).toBe(1);
    expect(result.in_progress).toBe(0);
    expect(result.done).toBe(0);
  });

  it("server status=in_progress WITH local draft → in_progress", () => {
    const s = mkSummary({ experiment_id: 7, audit_status: "in_progress" });
    const result = computeSetProgress([s], new Set(["7"]));
    expect(result).toEqual({ done: 0, in_progress: 1, untouched: 0 });
  });
});

describe("computeSetProgress — none / undefined audit_status", () => {
  it("counts audit_status=none (no review row) as untouched", () => {
    const s = mkSummary({ experiment_id: 3, audit_status: "none" });
    expect(computeSetProgress([s], new Set())).toEqual({
      done: 0,
      in_progress: 0,
      untouched: 1,
    });
  });

  it("counts undefined audit_status as untouched", () => {
    const s = mkSummary({ experiment_id: 3, audit_status: undefined });
    expect(computeSetProgress([s], new Set())).toEqual({
      done: 0,
      in_progress: 0,
      untouched: 1,
    });
  });

  it("none + local draft → in_progress (curator started editing from scratch)", () => {
    const s = mkSummary({ experiment_id: 3, audit_status: "none" });
    expect(computeSetProgress([s], new Set(["3"]))).toEqual({
      done: 0,
      in_progress: 1,
      untouched: 0,
    });
  });
});

describe("computeSetProgress — mixed member list", () => {
  it("correctly tallies done / in_progress / untouched across multiple members", () => {
    const summaries: ExperimentSummary[] = [
      mkSummary({ experiment_id: 1, audit_status: "closed" }),      // done
      mkSummary({ experiment_id: 2, audit_status: "closed" }),      // in_progress (has draft)
      mkSummary({ experiment_id: 3, audit_status: "in_progress" }), // untouched (no draft)
      mkSummary({ experiment_id: 4, audit_status: "none" }),        // untouched
    ];
    const drafts = new Set(["2"]); // only experiment 2 has a local draft
    const result = computeSetProgress(summaries, drafts);
    expect(result).toEqual({ done: 1, in_progress: 1, untouched: 2 });
  });
});

// ---------------------------------------------------------------------------
// deriveNextTask
// ---------------------------------------------------------------------------

describe("deriveNextTask — returns null when nothing is pending", () => {
  it("returns null when no tickets and no pipeline status", () => {
    expect(deriveNextTask(1, undefined, null)).toBeNull();
  });

  it("returns null when all pipeline steps are ok/na and no ticket", () => {
    const status = {
      dataset_id: 1,
      is_public: false,
      is_troubled: false,
      needs_attention: false,
      curation_note: null,
      geeq_quality: null,
      geeq_suitability: null,
      candidate_provenance: null,
      curation: {
        design:          { status: "ok",  last_run: null, details: null },
        tags:            { status: "ok",  last_run: null, details: null },
        outlier_review:  { status: "na",  last_run: null, details: null },
        batch_decision:  { status: "ok",  last_run: null, details: null },
        audit:           { status: "ok",  last_run: null, details: null },
      },
      analysis: {
        missing_value_analysis: { status: "ok", last_run: null, details: null },
        batch_info:             { status: "ok", last_run: null, details: null },
        preprocessing:          { status: "ok", last_run: null, details: null },
        dea:                    { status: "ok", last_run: null, details: null },
        diagnostics:            { status: "ok", last_run: null, details: null },
      },
    };
    expect(deriveNextTask(1, status as never, [])).toBeNull();
  });
});

describe("deriveNextTask — ticket source wins over pipeline", () => {
  it("returns a ticket-sourced task even when the pipeline also has a pending step", () => {
    const ticket = mkTicket({
      id: 10,
      type: "PRELOAD",
      state: "OPEN",
      priority: "NORMAL",
      targets: [
        { target_id: 99, target_type: "EXPRESSION_EXPERIMENT", status: "NOT_DONE" },
      ],
    });
    const status = {
      dataset_id: 99,
      is_public: false,
      is_troubled: false,
      needs_attention: false,
      curation_note: null,
      geeq_quality: null,
      geeq_suitability: null,
      candidate_provenance: null,
      curation: {
        design:         { status: "failed", last_run: null, details: null },
        tags:           { status: "ok",     last_run: null, details: null },
        outlier_review: { status: "ok",     last_run: null, details: null },
        batch_decision: { status: "ok",     last_run: null, details: null },
        audit:          { status: "ok",     last_run: null, details: null },
      },
      analysis: {
        missing_value_analysis: { status: "ok", last_run: null, details: null },
        batch_info:             { status: "ok", last_run: null, details: null },
        preprocessing:          { status: "ok", last_run: null, details: null },
        dea:                    { status: "ok", last_run: null, details: null },
        diagnostics:            { status: "ok", last_run: null, details: null },
      },
    };

    const task = deriveNextTask(99, status as never, [ticket]);
    expect(task).not.toBeNull();
    expect(task!.source).toBe("ticket");
    expect(task!.label).toBe("Preload"); // PRELOAD ticket type → "Preload" verb
  });

  it("falls back to the pipeline when the only ticket is RESOLVED", () => {
    const ticket = mkTicket({
      state: "RESOLVED",
      targets: [
        { target_id: 5, target_type: "EXPRESSION_EXPERIMENT", status: "DONE" },
      ],
    });
    const status = {
      dataset_id: 5,
      is_public: false,
      is_troubled: false,
      needs_attention: false,
      curation_note: null,
      geeq_quality: null,
      geeq_suitability: null,
      candidate_provenance: null,
      curation: {
        design:         { status: "not_run", last_run: null, details: null },
        tags:           { status: "ok",      last_run: null, details: null },
        outlier_review: { status: "ok",      last_run: null, details: null },
        batch_decision: { status: "ok",      last_run: null, details: null },
        audit:          { status: "ok",      last_run: null, details: null },
      },
      analysis: {
        missing_value_analysis: { status: "ok", last_run: null, details: null },
        batch_info:             { status: "ok", last_run: null, details: null },
        preprocessing:          { status: "ok", last_run: null, details: null },
        dea:                    { status: "ok", last_run: null, details: null },
        diagnostics:            { status: "ok", last_run: null, details: null },
      },
    };

    const task = deriveNextTask(5, status as never, [ticket]);
    expect(task).not.toBeNull();
    expect(task!.source).toBe("pipeline");
  });
});

describe("deriveNextTask — DONE targets suppressed", () => {
  it("does not surface a ticket when the matching target is DONE", () => {
    const ticket = mkTicket({
      state: "OPEN",
      targets: [
        { target_id: 3, target_type: "EXPRESSION_EXPERIMENT", status: "DONE" },
      ],
    });
    // No pipeline status — should return null because the ticket target is DONE.
    const task = deriveNextTask(3, undefined, [ticket]);
    expect(task).toBeNull();
  });

  it("surfaces the ticket when the target is UNDERWAY (not yet fully done)", () => {
    const ticket = mkTicket({
      state: "OPEN",
      targets: [
        { target_id: 3, target_type: "EXPRESSION_EXPERIMENT", status: "UNDERWAY" },
      ],
    });
    const task = deriveNextTask(3, undefined, [ticket]);
    expect(task).not.toBeNull();
    expect(task!.source).toBe("ticket");
  });

  it("does not match tickets for a different experiment's DONE target", () => {
    const ticket = mkTicket({
      state: "OPEN",
      targets: [
        // This ticket's target is experiment 99, not 3.
        { target_id: 99, target_type: "EXPRESSION_EXPERIMENT", status: "NOT_DONE" },
      ],
    });
    const task = deriveNextTask(3, undefined, [ticket]);
    expect(task).toBeNull();
  });
});

describe("deriveNextTask — reviewNoun dispatches on taskKind vs groupType", () => {
  const auditPendingStatus = {
    dataset_id: 1,
    is_public: false,
    is_troubled: false,
    needs_attention: false,
    curation_note: null,
    geeq_quality: null,
    geeq_suitability: null,
    candidate_provenance: null,
    curation: {
      design:         { status: "ok",      last_run: null, details: null },
      tags:           { status: "ok",      last_run: null, details: null },
      outlier_review: { status: "ok",      last_run: null, details: null },
      batch_decision: { status: "ok",      last_run: null, details: null },
      audit:          { status: "not_run", last_run: null, details: null }, // pending
    },
    analysis: {
      missing_value_analysis: { status: "ok", last_run: null, details: null },
      batch_info:             { status: "ok", last_run: null, details: null },
      preprocessing:          { status: "ok", last_run: null, details: null },
      dea:                    { status: "ok", last_run: null, details: null },
      diagnostics:            { status: "ok", last_run: null, details: null },
    },
  } as const;

  it("task_kind=review_proposal → label contains 'proposal'", () => {
    const task = deriveNextTask(
      1,
      auditPendingStatus as never,
      [],
      "review",
      "review_proposal",
    );
    expect(task).not.toBeNull();
    expect(task!.label.toLowerCase()).toContain("proposal");
  });

  it("task_kind=audit_existing → label contains 'audit'", () => {
    const task = deriveNextTask(
      1,
      auditPendingStatus as never,
      [],
      "pipeline",
      "audit_existing",
    );
    expect(task).not.toBeNull();
    expect(task!.label.toLowerCase()).toContain("audit");
  });

  it("task_kind=curate_from_scratch → label contains 'curation'", () => {
    const task = deriveNextTask(
      1,
      auditPendingStatus as never,
      [],
      undefined,
      "curate_from_scratch",
    );
    expect(task).not.toBeNull();
    expect(task!.label.toLowerCase()).toContain("curation");
  });

  it("no task_kind, groupType=review → falls back to 'proposal'", () => {
    const task = deriveNextTask(
      1,
      auditPendingStatus as never,
      [],
      "review",
      undefined,
    );
    expect(task).not.toBeNull();
    expect(task!.label.toLowerCase()).toContain("proposal");
  });

  it("no task_kind, groupType=pipeline → falls back to 'audit'", () => {
    const task = deriveNextTask(
      1,
      auditPendingStatus as never,
      [],
      "pipeline",
      undefined,
    );
    expect(task).not.toBeNull();
    expect(task!.label.toLowerCase()).toContain("audit");
  });

  it("no task_kind, no groupType → generic 'review'", () => {
    const task = deriveNextTask(
      1,
      auditPendingStatus as never,
      [],
      undefined,
      undefined,
    );
    expect(task).not.toBeNull();
    expect(task!.label.toLowerCase()).toContain("review");
  });
});

describe("deriveNextTask — pipeline step ordering (curation before analysis)", () => {
  it("picks the first not-ok curation step before any analysis step", () => {
    const status = {
      dataset_id: 1,
      is_public: false,
      is_troubled: false,
      needs_attention: false,
      curation_note: null,
      geeq_quality: null,
      geeq_suitability: null,
      candidate_provenance: null,
      curation: {
        design:         { status: "ok",      last_run: null, details: null },
        tags:           { status: "ok",      last_run: null, details: null },
        outlier_review: { status: "ok",      last_run: null, details: null },
        batch_decision: { status: "failed",  last_run: null, details: null }, // first bad step
        audit:          { status: "not_run", last_run: null, details: null },
      },
      analysis: {
        missing_value_analysis: { status: "failed", last_run: null, details: null }, // also bad but lower priority
        batch_info:             { status: "ok",      last_run: null, details: null },
        preprocessing:          { status: "ok",      last_run: null, details: null },
        dea:                    { status: "ok",      last_run: null, details: null },
        diagnostics:            { status: "ok",      last_run: null, details: null },
      },
    };
    const task = deriveNextTask(1, status as never, []);
    expect(task).not.toBeNull();
    // batch_decision comes before audit in curation order, and curation before analysis.
    expect(task!.label.toLowerCase()).toContain("batch decision");
    expect(task!.source).toBe("pipeline");
  });

  it("sets tone=urgent for a failed step", () => {
    const status = {
      dataset_id: 1,
      is_public: false,
      is_troubled: false,
      needs_attention: false,
      curation_note: null,
      geeq_quality: null,
      geeq_suitability: null,
      candidate_provenance: null,
      curation: {
        design:         { status: "failed", last_run: null, details: null },
        tags:           { status: "ok",     last_run: null, details: null },
        outlier_review: { status: "ok",     last_run: null, details: null },
        batch_decision: { status: "ok",     last_run: null, details: null },
        audit:          { status: "ok",     last_run: null, details: null },
      },
      analysis: {
        missing_value_analysis: { status: "ok", last_run: null, details: null },
        batch_info:             { status: "ok", last_run: null, details: null },
        preprocessing:          { status: "ok", last_run: null, details: null },
        dea:                    { status: "ok", last_run: null, details: null },
        diagnostics:            { status: "ok", last_run: null, details: null },
      },
    };
    const task = deriveNextTask(1, status as never, []);
    expect(task!.tone).toBe("urgent");
  });
});

describe("deriveNextTask — ticket tone by priority and state", () => {
  function ticketFor(
    priority: Ticket["priority"],
    state: Ticket["state"],
  ): Ticket {
    return mkTicket({
      state,
      priority,
      targets: [
        { target_id: 55, target_type: "EXPRESSION_EXPERIMENT", status: "NOT_DONE" },
      ],
    });
  }

  it("URGENT priority → tone=urgent", () => {
    const task = deriveNextTask(55, undefined, [ticketFor("URGENT", "OPEN")]);
    expect(task!.tone).toBe("urgent");
  });

  it("HIGH priority → tone=attention", () => {
    const task = deriveNextTask(55, undefined, [ticketFor("HIGH", "OPEN")]);
    expect(task!.tone).toBe("attention");
  });

  it("NORMAL priority + IN_PROGRESS state → tone=active", () => {
    const task = deriveNextTask(55, undefined, [ticketFor("NORMAL", "IN_PROGRESS")]);
    expect(task!.tone).toBe("active");
  });

  it("NORMAL priority + OPEN state → tone=todo", () => {
    const task = deriveNextTask(55, undefined, [ticketFor("NORMAL", "OPEN")]);
    expect(task!.tone).toBe("todo");
  });
});

// ---------------------------------------------------------------------------
// deriveNextTask — SUMMARY tickets (bulk /datasets/tickets route)
// ---------------------------------------------------------------------------
//
// The queue hands `deriveNextTask` two shapes: full tickets from
// `useTicket`, and summary rows from `POST /rest/v2/datasets/tickets`
// that the caller casts to `Ticket`. A summary carries id / title /
// state / type / targetCount only — no `priority`, and its single
// target is synthesised, so no `status` either. Both absences reached
// production on /tickets/6 (2026-09-01) and threw
// `Cannot read properties of undefined (reading 'toLowerCase')`,
// unmounting the whole queue.

/** A summary row exactly as the bulk route serves it, cast the way
 *  `ExperimentQueue` casts it. Deliberately NOT built on `mkTicket` —
 *  the point is the fields that are missing. */
function mkSummaryTicket(id: number, datasetId: number): Ticket {
  return {
    id,
    title: "Reference 500 — ongoing curation review",
    state: "OPEN",
    type: "CURATION",
    targets: [{ target_type: "EXPRESSION_EXPERIMENT", target_id: datasetId }],
  } as unknown as Ticket;
}

describe("deriveNextTask — a summary ticket has no priority", () => {
  it("does not throw when priority is absent", () => {
    expect(() =>
      deriveNextTask(4242, undefined, [mkSummaryTicket(6, 4242)]),
    ).not.toThrow();
  });

  it("renders the ticket task with no priority qualifier", () => {
    const task = deriveNextTask(4242, undefined, [mkSummaryTicket(6, 4242)]);
    expect(task).not.toBeNull();
    expect(task!.source).toBe("ticket");
    expect(task!.tooltip).toBe(
      "Ticket: Reference 500 — ongoing curation review",
    );
    // Unknown priority must not be guessed as urgent/attention.
    expect(task!.tone).toBe("todo");
  });

  it("still appends the qualifier when the priority IS known", () => {
    const ticket = mkTicket({
      id: 7,
      title: "Realign me",
      priority: "HIGH",
      targets: [
        { target_id: 4242, target_type: "EXPRESSION_EXPERIMENT", status: "NOT_DONE" },
      ],
    });
    const task = deriveNextTask(4242, undefined, [ticket]);
    expect(task!.tooltip).toBe("Ticket: Realign me (high)");
  });
});
