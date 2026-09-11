/**
 * Where a ticket's payload blob is spelled.
 *
 * Its own module, not a function inside ``tickets.ts``: both layers read
 * it — ``ticketBaselineSource`` in ``api/tickets.ts`` and the triage /
 * preboarding surfaces through ``features/triage/triagePayload.ts``, and
 * ``api/`` cannot import from ``features/``. It is kept out of
 * ``tickets.ts`` itself because eleven render tests replace that module
 * wholesale with a hooks-only ``vi.mock`` factory, which would blank a
 * pure helper parked there.
 */

/** The ticket's payload string, from whichever side served the ticket.
 *
 *  The store spells it `payload_json`; Gemma spells it `payload`
 *  (`TicketValueObject.payload`, live 2026-09-03). Same JSON, two field
 *  names, so every reader goes through here rather than picking one and
 *  going blank against the other host.
 *
 *  🛑 The store's field wins when both are present. A ticket carrying
 *  both is a ticket mid-migration, and the store's copy is the one its
 *  own targets were keyed against. */
export function ticketPayload(ticket: {
  payload_json?: string;
  payload?: string;
}): string | undefined {
  return ticket.payload_json ?? ticket.payload;
}
