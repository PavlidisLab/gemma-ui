/**
 * @vitest-environment jsdom
 *
 * The dashboard's ticket card skips straight to the experiment for a
 * "single-target ticket" — the only useful landing when there's nothing
 * else to see. That shortcut used to key off `expTargets.length === 1`
 * alone (exactly one EXPRESSION_EXPERIMENT-typed target), which was a
 * safe proxy for "this ticket has one target, period" back when a
 * SCREENING ticket's targets were always uniformly typed.
 *
 * That stopped being true once a scrape candidate could resolve to an
 * already-imported real experiment: scrape_geo_and_open_triage.py's
 * _create_preboarded now correctly types such a candidate
 * EXPRESSION_EXPERIMENT instead of a nonexistent PREBOARDED_EXPERIMENT
 * id. A two-candidate SCREENING ticket where exactly one candidate
 * happens to already be imported then has exactly one EE-typed target
 * AND a second, differently-typed one — `expTargets.length === 1` fires
 * anyway, and the whole ticket (its triage list, its other candidate)
 * becomes unreachable from the dashboard. Confirmed live, 2026-09-04,
 * ticket #43 / #45.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Ticket } from "@/api/tickets";
import { ToastProvider } from "@/components/ui/Toast";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@/routes", async (orig) => ({
  ...(await orig<typeof import("@/routes")>()),
  navigate,
}));

vi.mock("@/api/tickets", async (orig) => ({
  ...(await orig<typeof import("@/api/tickets")>()),
  useScratchpadOwner: () => null,
  usePatchTicket: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { TicketCard } from "./CuratorDashboard";

function mkTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 45,
    type: "SCREENING",
    state: "OPEN",
    priority: "NORMAL",
    title: "GEO scrape 2020-01-01 .. 2020-01-05",
    targets: [
      { target_id: 16429, target_type: "EXPRESSION_EXPERIMENT", status: "NOT_DONE" },
      { target_id: 93464, target_type: "PREBOARDED_EXPERIMENT", status: "NOT_DONE" },
    ],
    ...overrides,
  } as unknown as Ticket;
}

function open(ticket: Ticket, onOpenTarget = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <TicketCard
          ticket={ticket}
          onOpenTarget={onOpenTarget}
          pinned={false}
          onTogglePin={vi.fn()}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  // The card itself sets an explicit role="button" attribute; the pin
  // and close/reopen controls are native <button> elements with no such
  // attribute (an implicit ARIA role, not this literal one), so this
  // selector reaches only the card's own click target.
  const card = container.querySelector('[role="button"]');
  if (!card) throw new Error("ticket card root not found");
  return { onOpenTarget, card: card as HTMLElement };
}

describe("dashboard ticket card: single-target shortcut vs a mixed-type screening ticket", () => {
  beforeEach(() => navigate.mockClear());

  it("opens the ticket page for a 2-target SCREENING ticket with one EE-typed target", async () => {
    const { card, onOpenTarget } = open(mkTicket());
    await userEvent.click(card);
    expect(onOpenTarget).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("#/tickets/45");
  });

  it("still opens the ticket page when target_summary reports 2 total targets", async () => {
    const { card, onOpenTarget } = open(
      mkTicket({
        target_summary: { total: 2, done: 0, underway: 0, not_done: 2 },
      } as Partial<Ticket>),
    );
    await userEvent.click(card);
    expect(onOpenTarget).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("#/tickets/45");
  });

  it("never uses the shortcut for a SCREENING ticket, even with a genuine single target", async () => {
    const { card, onOpenTarget } = open(
      mkTicket({
        targets: [
          { target_id: 16429, target_type: "EXPRESSION_EXPERIMENT", status: "NOT_DONE" },
        ],
      } as Partial<Ticket>),
    );
    await userEvent.click(card);
    expect(onOpenTarget).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("#/tickets/45");
  });

  it("still uses the shortcut for a non-SCREENING single-target ticket", async () => {
    const { card, onOpenTarget } = open(
      mkTicket({
        type: "PRELOAD",
        targets: [
          { target_id: 16429, target_type: "EXPRESSION_EXPERIMENT", status: "NOT_DONE" },
        ],
      } as Partial<Ticket>),
    );
    await userEvent.click(card);
    expect(onOpenTarget).toHaveBeenCalledWith(16429, 45);
    expect(navigate).not.toHaveBeenCalled();
  });
});
