import { describe, expect, it } from "vitest";
import {
  decisionLabels,
  findTargetForPreboarding,
  parsePayload,
  preboardingRowId,
  preboardingSiblings,
} from "./triagePayload";
import type { Ticket, TicketTarget } from "@/api/tickets";

/**
 * The triage table and the preboarding detail page read the same
 * payload. These pin the mapping that lets the detail page find which
 * ticket target it is looking at, and the per-ticket verbs — a screen
 * asking "is this the right paper?" must not present Include / Exclude.
 */

const mkTarget = (o: Partial<TicketTarget> = {}): TicketTarget =>
  ({
    target_id: 1,
    target_type: "GEO_ACCESSION",
    status: "NOT_DONE",
    ...o,
  }) as TicketTarget;

const mkTicket = (
  candidates: Record<string, unknown>,
  targets: TicketTarget[],
  decision?: Record<string, string>,
): Ticket =>
  ({
    id: 180,
    targets,
    payload_json: JSON.stringify({ candidates, decision }),
  }) as Ticket;

describe("preboardingRowId", () => {
  it("pulls the row id out of a prefixed experiment id", () => {
    expect(preboardingRowId("preboarding:52")).toBe(52);
  });

  it("is null for an imported experiment's numeric id", () => {
    expect(preboardingRowId(52)).toBeNull();
    expect(preboardingRowId("52")).toBeNull();
  });

  it("is null for anything else", () => {
    expect(preboardingRowId("preboarding:")).toBeNull();
    expect(preboardingRowId("preboarding:abc")).toBeNull();
  });
});

describe("findTargetForPreboarding", () => {
  const ticket = mkTicket(
    {
      "1": { accession: "GSE1", preboarding_id: 11 },
      "2": { accession: "GSE2", preboarding_id: 52 },
      "3": { accession: "GSE3", preboarding_id: null },
    },
    [mkTarget({ target_id: 1 }), mkTarget({ target_id: 2 }), mkTarget({ target_id: 3 })],
  );

  it("maps a preboarding row back to its ticket target", () => {
    expect(findTargetForPreboarding(ticket, 52)?.target_id).toBe(2);
  });

  it("is null when the candidate isn't on this ticket", () => {
    expect(findTargetForPreboarding(ticket, 999)).toBeNull();
  });

  it("is null with no ticket — a candidate can be opened without one", () => {
    expect(findTargetForPreboarding(null, 52)).toBeNull();
  });

  it("is null with no preboarding id", () => {
    expect(findTargetForPreboarding(ticket, null)).toBeNull();
  });

  it("does not match a null preboarding_id against a null query", () => {
    // A ticket predating preboard-at-scrape carries nulls; those must
    // never collide into a match and write a decision to a random row.
    expect(findTargetForPreboarding(ticket, null)).toBeNull();
  });

  it("tolerates a ticket with no targets or unparseable payload", () => {
    const broken = { id: 1, targets: [], payload_json: "{{{" } as unknown as Ticket;
    expect(findTargetForPreboarding(broken, 52)).toBeNull();
  });
});

describe("decisionLabels", () => {
  it("uses the ticket's own verbs when it specced them", () => {
    const parsed = parsePayload(
      JSON.stringify({
        candidates: {},
        decision: { confirm_label: "Confirm", reject_label: "Reject" },
      }),
    );
    expect(decisionLabels(parsed)).toEqual({
      confirmLabel: "Confirm",
      rejectLabel: "Reject",
    });
  });

  it("falls back to Include / Exclude", () => {
    expect(decisionLabels(parsePayload(undefined))).toEqual({
      confirmLabel: "Include",
      rejectLabel: "Exclude",
    });
  });

  it("fills in only the half the ticket left unspecced", () => {
    const parsed = parsePayload(
      JSON.stringify({ candidates: {}, decision: { confirm_label: "Keep" } }),
    );
    expect(decisionLabels(parsed)).toEqual({
      confirmLabel: "Keep",
      rejectLabel: "Exclude",
    });
  });
});

describe("preboardingSiblings", () => {
  const ticket = mkTicket(
    {
      "1": { accession: "GSE1", preboarding_id: 11 },
      "2": { accession: "GSE2", preboarding_id: 52 },
      "3": { accession: "GSE3", preboarding_id: null },
      "4": { accession: "GSE4", preboarding_id: 77 },
    },
    [
      mkTarget({ target_id: 1 }),
      mkTarget({ target_id: 2 }),
      mkTarget({ target_id: 3 }),
      mkTarget({ target_id: 4 }),
    ],
  );

  it("walks the ticket in target order", () => {
    const s = preboardingSiblings(ticket, 52);
    expect(s.ids).toEqual([11, 52, 77]);
    expect(s.index).toBe(1);
    expect(s.prev).toBe(11);
    expect(s.next).toBe(77);
  });

  it("skips candidates with no detail page to land on", () => {
    // target 3 carries preboarding_id null — stepping onto it would be
    // a dead route mid-queue.
    expect(preboardingSiblings(ticket, 52).ids).toHaveLength(3);
  });

  it("has no prev at the head and no next at the tail", () => {
    expect(preboardingSiblings(ticket, 11).prev).toBeNull();
    expect(preboardingSiblings(ticket, 11).next).toBe(52);
    expect(preboardingSiblings(ticket, 77).next).toBeNull();
    expect(preboardingSiblings(ticket, 77).prev).toBe(52);
  });

  it("reports index -1 for a candidate that isn't on the ticket", () => {
    const s = preboardingSiblings(ticket, 999);
    expect(s.index).toBe(-1);
    expect(s.prev).toBeNull();
    expect(s.next).toBeNull();
  });

  it("is empty with no ticket", () => {
    expect(preboardingSiblings(null, 52).ids).toEqual([]);
  });

  it("is empty when no candidate carries a preboarding id", () => {
    const old = mkTicket({ "1": { accession: "GSE1" } }, [mkTarget()]);
    expect(preboardingSiblings(old, 52).ids).toEqual([]);
  });
});
