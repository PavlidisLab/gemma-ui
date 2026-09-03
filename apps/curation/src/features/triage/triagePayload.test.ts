import { describe, expect, it } from "vitest";
import {
  decisionLabels,
  findTargetForPreboarding,
  parsePayload,
  preboardingRowId,
  preboardingSiblings,
  ticketPayload,
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

/**
 * Gemma serves the same JSON under a different field name —
 * `TicketValueObject.payload`, live on gemma2 `408843792f`
 * (2026-09-03), beside `payloadSchemaVersion`. The store keeps
 * `payload_json`. Reading one only goes blank against the other host.
 */
describe("ticketPayload", () => {
  it("reads the store's payload_json", () => {
    expect(ticketPayload({ payload_json: "{}" })).toBe("{}");
  });

  it("reads Gemma's payload", () => {
    expect(ticketPayload({ payload: "{}" })).toBe("{}");
  });

  it("prefers the store's field when a ticket carries both", () => {
    // A ticket with both is mid-migration, and the store's copy is the
    // one its own targets were keyed against.
    expect(
      ticketPayload({ payload_json: "store", payload: "gemma" }),
    ).toBe("store");
  });

  it("returns undefined when neither is set — the value gembro serializes", () => {
    // Nulls are serialized rather than elided, so "no payload" is a
    // value to test for, not a missing key.
    expect(ticketPayload({})).toBeUndefined();
  });
});

/**
 * 🛑 The payload is a JSON STRING, so the client boundary renames the
 * field HOLDING it and stops — `JSON.parse` returns whatever case the
 * producer wrote. Same trap as `identifyingMetadata`.
 */
describe("parsePayload normalizes the keys inside the blob", () => {
  it("reads a camelCase payload as if it were snake", () => {
    const camel = JSON.stringify({
      screenSummary: "what this screen did",
      scrapeWindow: { since: "2026-01-01", until: "2026-02-01" },
      decision: { confirmLabel: "Confirm", rejectLabel: "Reject" },
      candidates: {},
    });
    const out = parsePayload(camel);
    expect(out.screen_summary).toBe("what this screen did");
    expect(out.scrape_window?.since).toBe("2026-01-01");
    expect(decisionLabels(out)).toEqual({
      confirmLabel: "Confirm",
      rejectLabel: "Reject",
    });
  });

  it("leaves an already-snake payload untouched — snakeify is idempotent", () => {
    const snake = JSON.stringify({
      screen_summary: "s",
      decision: { confirm_label: "Confirm", reject_label: "Reject" },
      candidates: {},
    });
    const out = parsePayload(snake);
    expect(out.screen_summary).toBe("s");
    expect(decisionLabels(out)).toEqual({
      confirmLabel: "Confirm",
      rejectLabel: "Reject",
    });
  });

  it("🛑 does NOT rewrite the candidate keys — they are target ids", () => {
    // `snakeify` renames field names, not the keys of a map. A target
    // id mangled here would unlink every candidate from its row.
    const out = parsePayload(
      JSON.stringify({ candidates: { "93453": { accession: "GSE344586" } } }),
    );
    expect(Object.keys(out.candidates)).toEqual(["93453"]);
    expect(out.candidates["93453"].accession).toBe("GSE344586");
  });

  it("normalizes display_fields, which switch the whole renderer", () => {
    // Any candidate carrying display_fields opts the ticket into the
    // self-describing card view; camelCase here would silently drop the
    // ticket back to the fixed GEO table.
    const out = parsePayload(
      JSON.stringify({
        candidates: {
          "7": { displayFields: [{ label: "Confidence", value: "high", type: "tier" }] },
        },
      }),
    );
    expect(out.candidates["7"].display_fields).toHaveLength(1);
    expect(out.candidates["7"].display_fields?.[0].label).toBe("Confidence");
  });

  it("survives a payload that is not JSON at all", () => {
    expect(parsePayload("not json")).toEqual({ candidates: {} });
  });
});
