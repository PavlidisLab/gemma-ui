import { describe, expect, it } from "vitest";
import { ticketPayload as triageTicketPayload } from "@/features/triage/triagePayload";
import { ticketPayload } from "./ticketPayload";
import { ticketBaselineSource, type Ticket } from "./tickets";

/**
 * ``ticketBaselineSource`` — which comparison baseline a ticket's
 * findings were computed against.
 *
 * Two accepted homes so the agents side can land the field either
 * way (handoff AGENTS_ASK_2026_08_09_TICKET_SHOULD_PIN_ITS_BASELINE):
 * the top-level column, or inside the free-form ``payload_json``.
 * Everything else — absent, blank, malformed — reads as "no pin",
 * which leaves the chip strip on its own defaults.
 */

function ticket(patch: Partial<Ticket>): Ticket {
  return {
    id: 169,
    title: "Category policy — 4 questions",
    type: "REVIEW" as Ticket["type"],
    state: "OPEN" as Ticket["state"],
    priority: "NORMAL" as Ticket["priority"],
    due_date: null,
    reporter_id: null,
    reporter_name: null,
    assignee_id: null,
    assignee_name: "paul",
    created_at: "2026-08-09T14:28:55Z",
    updated_at: "2026-08-09T14:28:55Z",
    external_issue_url: null,
    body: "",
    mode: "MANUAL",
    targets: [],
    ...patch,
  } as Ticket;
}

describe("ticketBaselineSource", () => {
  it("reads the top-level field", () => {
    expect(ticketBaselineSource(ticket({ baseline_source: "polished:gold" })))
      .toBe("polished:gold");
  });

  it("reads it out of payload_json when the column is absent", () => {
    expect(
      ticketBaselineSource(
        ticket({
          payload_json: JSON.stringify({
            baseline_source: "polished:consensus_strict_consensus",
            batch_id: "category-policy-2026-08-09",
          }),
        }),
      ),
    ).toBe("polished:consensus_strict_consensus");
  });

  it("prefers the column over the payload when both are set", () => {
    expect(
      ticketBaselineSource(
        ticket({
          baseline_source: "polished:gold",
          payload_json: JSON.stringify({ baseline_source: "live" }),
        }),
      ),
    ).toBe("polished:gold");
  });

  it("trims incidental whitespace", () => {
    expect(ticketBaselineSource(ticket({ baseline_source: "  live  " })))
      .toBe("live");
  });

  it("reads no pin from a ticket that predates the field", () => {
    expect(ticketBaselineSource(ticket({}))).toBeNull();
    expect(ticketBaselineSource(ticket({ payload_json: "{}" }))).toBeNull();
    expect(ticketBaselineSource(ticket({ baseline_source: null }))).toBeNull();
    expect(ticketBaselineSource(ticket({ baseline_source: "   " }))).toBeNull();
  });

  it("reads no pin from a malformed or wrong-typed payload", () => {
    // Not an error: a broken blob just means the chip strip keeps
    // its defaults, which is what it did before the field existed.
    expect(ticketBaselineSource(ticket({ payload_json: "{not json" }))).toBeNull();
    expect(ticketBaselineSource(ticket({ payload_json: "[]" }))).toBeNull();
    expect(
      ticketBaselineSource(ticket({ payload_json: JSON.stringify({ baseline_source: 7 }) })),
    ).toBeNull();
  });

  it("reads no pin with no ticket at all", () => {
    expect(ticketBaselineSource(null)).toBeNull();
    expect(ticketBaselineSource(undefined)).toBeNull();
  });
});

/**
 * The blob the pin can arrive in has two field names: the curation
 * store serves `payload_json`, Gemma serves `payload`
 * (`TicketValueObject.payload`, live 2026-09-03). Which one a ticket
 * carries depends on which backend served it, so `ticketBaselineSource`
 * resolves it through `ticketPayload` rather than naming a field — it
 * used to inline `payload_json ?? payload`, a second copy of the rule
 * beside the triage surfaces' copy.
 */
describe("ticketBaselineSource across both ticket shapes", () => {
  const pin = JSON.stringify({ baseline_source: "polished:gold" });

  it("reads the pin out of a store-served ticket's payload_json", () => {
    expect(ticketBaselineSource(ticket({ payload_json: pin }))).toBe(
      "polished:gold",
    );
  });

  it("reads the pin out of a Gemma-served ticket's payload", () => {
    expect(ticketBaselineSource(ticket({ payload: pin }))).toBe(
      "polished:gold",
    );
  });

  it("takes the store's field when a mid-migration ticket has both", () => {
    expect(
      ticketBaselineSource(
        ticket({
          payload_json: JSON.stringify({ baseline_source: "store" }),
          payload: JSON.stringify({ baseline_source: "gemma" }),
        }),
      ),
    ).toBe("store");
  });

  it("still prefers the top-level column over a Gemma payload", () => {
    expect(
      ticketBaselineSource(
        ticket({ baseline_source: "live", payload: pin }),
      ),
    ).toBe("live");
  });

  it("reads no pin from a malformed Gemma payload", () => {
    expect(ticketBaselineSource(ticket({ payload: "{not json" }))).toBeNull();
    expect(ticketBaselineSource(ticket({ payload: "{}" }))).toBeNull();
  });

  it("resolves the blob through the same helper the triage surfaces use", () => {
    // One definition, two import paths: `triagePayload` re-exports it
    // because `api/` cannot import from `features/`. A second copy
    // reappearing here is the failure this asserts against.
    expect(triageTicketPayload).toBe(ticketPayload);
    expect(ticketPayload({ payload_json: "store" })).toBe("store");
    expect(ticketPayload({ payload: "gemma" })).toBe("gemma");
    expect(ticketPayload({ payload_json: "store", payload: "gemma" })).toBe(
      "store",
    );
    expect(ticketPayload({})).toBeUndefined();
  });
});
