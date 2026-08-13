import { describe, expect, it } from "vitest";
import type { Ticket } from "@/api/tickets";
import { followUpTicketBody, nextStageFor } from "./nextStage";

// Two close flows spawn a follow-up ticket — the ticket-detail
// close-confirm (PRELOAD → CURATION, every EE target) and the triage
// close dialog (SCREENING → SCREENING, the unsure rows only). They
// were two hand-rolled literals and they disagreed; these tests pin
// what has to stay shared and what is genuinely per-caller.

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

const EE = (id: number) =>
  ({ target_type: "EXPRESSION_EXPERIMENT", target_id: id }) as const;

describe("nextStageFor", () => {
  it("sends PRELOAD to a CURATION ticket", () => {
    const stage = nextStageFor(mkTicket({ type: "PRELOAD" }))!;
    expect(stage.type).toBe("CURATION");
    expect(stage.actionLabel).toBe("Close & start curation");
  });

  it("strips the 'Preload —' prefix so the curation title isn't 'Curate: Preload — X'", () => {
    const stage = nextStageFor(mkTicket({ type: "PRELOAD" }))!;
    expect(stage.title(mkTicket({ type: "PRELOAD", title: "Preload — March GEO sweep" }))).toBe(
      "Curate: March GEO sweep",
    );
  });

  it("falls back to the ticket number when stripping leaves nothing", () => {
    const stage = nextStageFor(mkTicket({ type: "PRELOAD" }))!;
    expect(stage.title(mkTicket({ id: 42, type: "PRELOAD", title: "Preload:" }))).toBe(
      "Curate: ticket #42",
    );
  });

  it("sends SCREENING to another SCREENING ticket — unresolved rows get re-screened, not curated", () => {
    // An `unsure` row is one nobody could resolve. Sending it into a
    // CURATION ticket would assert a screening decision that was never
    // made.
    const stage = nextStageFor(mkTicket({ type: "SCREENING" }))!;
    expect(stage.type).toBe("SCREENING");
    expect(stage.title(mkTicket({ type: "SCREENING", title: "March GEO sweep" }))).toBe(
      "Unresolved from: March GEO sweep",
    );
  });

  it("names the carried count in the SCREENING body — the follow-up holds a SUBSET", () => {
    const stage = nextStageFor(mkTicket({ type: "SCREENING" }))!;
    const body = stage.body(mkTicket({ id: 7, type: "SCREENING" }), 3);
    expect(body).toContain("ticket #7");
    expect(body).toContain("3 candidate(s)");
  });

  it("offers no follow-up for a ticket type with no defined destination", () => {
    expect(nextStageFor(mkTicket({ type: "GENERIC" }))).toBeNull();
    expect(nextStageFor(mkTicket({ type: "CURATION" }))).toBeNull();
  });
});

describe("followUpTicketBody", () => {
  it("inherits the parent's priority — leftovers of an urgent ticket are still urgent", () => {
    // The triage flow used to build this literal by hand and omit
    // `priority`, so the unresolved rows of an URGENT screen came back
    // as a NORMAL ticket.
    const parent = mkTicket({ type: "SCREENING", priority: "URGENT" });
    const body = followUpTicketBody(nextStageFor(parent)!, parent, [EE(11), EE(12)]);
    expect(body.priority).toBe("URGENT");
  });

  it("is always MANUAL — a follow-up exists because a human has to look", () => {
    const parent = mkTicket({ type: "PRELOAD", mode: "AUTO" });
    const body = followUpTicketBody(nextStageFor(parent)!, parent, [EE(11)]);
    expect(body.mode).toBe("MANUAL");
  });

  it("carries exactly the targets it was handed, all NOT_DONE", () => {
    const parent = mkTicket({ type: "SCREENING" });
    const body = followUpTicketBody(nextStageFor(parent)!, parent, [EE(11), EE(12)]);
    expect(body.targets).toEqual([
      { target_type: "EXPRESSION_EXPERIMENT", target_id: 11, status: "NOT_DONE" },
      { target_type: "EXPRESSION_EXPERIMENT", target_id: 12, status: "NOT_DONE" },
    ]);
  });

  it("counts the body against the targets actually carried, not the parent's", () => {
    const parent = mkTicket({ type: "SCREENING", targets: [] });
    const body = followUpTicketBody(nextStageFor(parent)!, parent, [EE(11), EE(12)]);
    expect(body.body).toContain("2 candidate(s)");
  });

  it("sets an assignee when one is named — that is what makes it an escalation", () => {
    const parent = mkTicket({ type: "SCREENING" });
    const body = followUpTicketBody(nextStageFor(parent)!, parent, [EE(11)], {
      assignee: "pavlidis",
    });
    expect(body.assignee).toBe("pavlidis");
  });

  it("omits the assignee key entirely when blank or whitespace — blank keeps the same owner", () => {
    // An empty string is not "assign to nobody"; sending it would ask
    // the server to resolve a user named "".
    const parent = mkTicket({ type: "SCREENING" });
    expect(
      followUpTicketBody(nextStageFor(parent)!, parent, [EE(11)], { assignee: "   " }),
    ).not.toHaveProperty("assignee");
    expect(followUpTicketBody(nextStageFor(parent)!, parent, [EE(11)])).not.toHaveProperty(
      "assignee",
    );
  });
});
