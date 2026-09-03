/**
 * Whose scratchpad is this?
 *
 * A curator sees other curators' scratchpads in the ticket queue, and
 * on gemma2 two of them read "Scratchpad: admin" and plain "Scratchpad"
 * side by side with nothing marking which was the reader's own (Paul,
 * 2026-09-02).
 *
 * The bare title is not a second kind of scratchpad: Gemma's
 * ``scratchpadTitle`` and ``TicketValueObject.from`` both read
 * ``Contact.getName()``, which is NOT the username, so a curator whose
 * contact name was never filled in gets a null ``reporterName`` AND a
 * title with no suffix from one null. Ticket 13 on gemma2 is that case
 * (``reporterId: 52731``).
 *
 * The rule under test: claim ownership only where it can be
 * established, and never tell a curator their own pile is someone
 * else's.
 */
import { describe, expect, it } from "vitest";

import {
  scratchpadOwner,
  scratchpadOwnerLabel,
  scratchpadOwnerTitle,
  type Ticket,
  type TicketType,
} from "./tickets";

function ticket(
  id: number,
  type: TicketType = "SCRATCHPAD",
  reporter: { id: number | null; name: string | null } = { id: 1, name: null },
): Ticket {
  return {
    id,
    title: reporter.name ? `Scratchpad: ${reporter.name}` : "Scratchpad",
    type,
    state: "OPEN",
    priority: "NORMAL",
    due_date: null,
    reporter_id: reporter.id,
    reporter_name: reporter.name,
    assignee_id: null,
    assignee_name: null,
    created_at: "2026-09-02T00:00:00Z",
    updated_at: "2026-09-02T00:00:00Z",
    external_issue_url: null,
    targets: [],
  } as unknown as Ticket;
}

describe("scratchpadOwner", () => {
  it("says nothing about a ticket that is not a scratchpad", () => {
    const t = ticket(3, "CURATION", { id: 1, name: "admin" });
    expect(scratchpadOwner(t, { myScratchpadId: 7 })).toBeNull();
  });

  it("is mine when the id matches the one the scratchpad route returned", () => {
    expect(scratchpadOwner(ticket(7), { myScratchpadId: 7 })).toEqual({
      kind: "mine",
    });
  });

  // The id match must win even when the ticket carries a name that is
  // NOT the session's username: gemma2 answers /users/me with
  // "administrator" while that same account's contact name is "admin".
  it("is mine on an id match whose name disagrees with the session", () => {
    const t = ticket(7, "SCRATCHPAD", { id: 1, name: "admin" });
    expect(
      scratchpadOwner(t, { myScratchpadId: 7, myUsername: "administrator" }),
    ).toEqual({ kind: "mine" });
  });

  // 🛑 The name colliding with the reader's own. Synthetic ids and a
  // synthetic name on purpose: no such collision exists on prod (gembro
  // checked on 2026-09-02 — no account's contact name equals another
  // account's username), and a fixture built from real ids would read
  // as a record that one did.
  //
  // It is guarded anyway. One scratchpad per curator is a unique index
  // (TICKET_ONE_SCRATCHPAD_PER_CURATOR, V40), so a different id is
  // proof on its own and the name gets no vote once the id is known.
  it("is not mine on a different id, even carrying the session's own name", () => {
    const t = ticket(902, "SCRATCHPAD", { id: 9002, name: "same-name" });
    expect(
      scratchpadOwner(t, { myScratchpadId: 901, myUsername: "same-name" }),
    ).toEqual({ kind: "named", name: "same-name" });
  });

  it("is mine on a name matching the session when the route gave no id", () => {
    const t = ticket(7, "SCRATCHPAD", { id: 1, name: "Admin" });
    expect(scratchpadOwner(t, { myUsername: "admin" })).toEqual({
      kind: "mine",
    });
  });

  it("names another curator's scratchpad when Gemma sent a name", () => {
    const t = ticket(7, "SCRATCHPAD", { id: 1, name: "admin" });
    expect(scratchpadOwner(t, { myScratchpadId: 13 })).toEqual({
      kind: "named",
      name: "admin",
    });
  });

  // Ticket 13 on gemma2: a real reporter id, no name, and a bare title.
  it("reads an unnamed one as another curator's, carrying the id", () => {
    const t = ticket(13, "SCRATCHPAD", { id: 52731, name: null });
    expect(scratchpadOwner(t, { myScratchpadId: 7 })).toEqual({
      kind: "other",
      reporterId: 52731,
    });
  });

  // 🛑 The whole point of the null returns. Before the scratchpad route
  // answers — and forever on a host that never grows it — we do not know
  // which scratchpad is ours, so an unnamed one must not be labelled
  // somebody else's. The curator would be told their own pile is not.
  it("says nothing about an unnamed one before ownership is established", () => {
    const t = ticket(13, "SCRATCHPAD", { id: 52731, name: null });
    expect(scratchpadOwner(t, {})).toBeNull();
    expect(scratchpadOwner(t, { myUsername: "administrator" })).toBeNull();
  });

  // A named one is a fact off the wire, independent of who is reading.
  it("still names a named one when ownership is unestablished", () => {
    const t = ticket(7, "SCRATCHPAD", { id: 1, name: "admin" });
    expect(scratchpadOwner(t, {})).toEqual({ kind: "named", name: "admin" });
  });

  it("treats a whitespace-only name as no name at all", () => {
    const t = ticket(13, "SCRATCHPAD", { id: 52731, name: "   " });
    expect(scratchpadOwner(t, { myScratchpadId: 7 })).toEqual({
      kind: "other",
      reporterId: 52731,
    });
  });
});

describe("scratchpadOwnerLabel", () => {
  it("reads as a possessive the curator can scan", () => {
    expect(scratchpadOwnerLabel({ kind: "mine" })).toBe("yours");
    expect(scratchpadOwnerLabel({ kind: "named", name: "admin" })).toBe(
      "admin's",
    );
    expect(
      scratchpadOwnerLabel({ kind: "other", reporterId: 52731 }),
    ).toBe("another curator");
  });
});

describe("scratchpadOwnerTitle", () => {
  // The gap gets named rather than hidden: the curator sees that Gemma
  // sent an id and no name, which is the bug to report, not ours to
  // paper over.
  it("names the contact id when Gemma sent no name for it", () => {
    expect(scratchpadOwnerTitle({ kind: "other", reporterId: 52731 })).toMatch(
      /contact #52731/,
    );
  });

  it("does not invent a contact id when there is none", () => {
    const s = scratchpadOwnerTitle({ kind: "other", reporterId: null });
    expect(s).not.toMatch(/#/);
    expect(s).toMatch(/no name/);
  });

  it("says plainly that a named one is not yours", () => {
    expect(scratchpadOwnerTitle({ kind: "named", name: "admin" })).toBe(
      "admin's scratchpad, not yours.",
    );
  });
});
