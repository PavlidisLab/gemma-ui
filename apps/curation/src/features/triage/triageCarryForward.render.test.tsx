/**
 * @vitest-environment jsdom
 *
 * Closing a screen that has `unsure` rows.
 *
 * The carry-forward creates a real second ticket and then closes this
 * one, and the summary that replaced the page said only "Triage
 * finalized" plus a script to run. A curator who had just escalated
 * candidates had no way back to the ticket now holding them — the id
 * existed only in the response we threw away. These pin that the
 * spawned ticket is named, linked, and carries the parent's priority.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { Ticket } from "@/api/tickets";
import { TriageView } from "./TriageView";

const createTicket = vi.hoisted(() => vi.fn());
const finalize = vi.hoisted(() => vi.fn());

vi.mock("@/api/tickets", () => ({
  useFinalizeTriage: () => ({
    mutateAsync: finalize,
    isPending: false,
    isError: false,
  }),
  usePatchTicketTarget: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
    isError: false,
  }),
  useCreateTicket: () => ({ mutateAsync: createTicket, isPending: false }),
}));

/** A screen with one decided row and one the curator marked `unsure`. */
function mkTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 180,
    title: "March GEO sweep",
    type: "SCREENING",
    priority: "URGENT",
    targets: [
      {
        target_id: 52,
        target_type: "GEO_ACCESSION",
        status: "DONE",
        triage_disposition: "include",
      },
      {
        target_id: 53,
        target_type: "GEO_ACCESSION",
        status: "DONE",
        triage_disposition: "unsure",
        triage_disposition_reason: "unclear if in scope",
      },
    ],
    payload_json: JSON.stringify({
      candidates: {
        "52": { accession: "GSE343489", preboarding_id: 52 },
        "53": { accession: "GSE343367", preboarding_id: 53 },
      },
    }),
    ...overrides,
  } as unknown as Ticket;
}

function open(ticket: Ticket = mkTicket()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TriageView ticket={ticket} />
    </QueryClientProvider>,
  );
}

/** Walk the close flow to the point where the follow-up is spawned. */
async function carryForward() {
  await userEvent.click(screen.getByRole("button", { name: /finalize/i }));
  await userEvent.click(screen.getByRole("button", { name: /Carry 1 forward/ }));
}

describe("carrying unsure rows forward", () => {
  beforeEach(() => {
    createTicket.mockReset();
    createTicket.mockResolvedValue({
      id: 181,
      assignee_name: null,
      targets: [{ target_id: 53, target_type: "GEO_ACCESSION" }],
    });
    finalize.mockReset();
    finalize.mockResolvedValue({
      ticket_id: 180,
      included: [{ accession: "GSE343489" }],
      excluded: [],
      undecided_count: 0,
    });
  });

  it("spawns a SCREENING ticket holding only the unsure row", async () => {
    open();
    await carryForward();
    expect(createTicket).toHaveBeenCalledTimes(1);
    const body = createTicket.mock.calls[0][0];
    expect(body.type).toBe("SCREENING");
    expect(body.targets).toEqual([
      { target_type: "GEO_ACCESSION", target_id: 53, status: "NOT_DONE" },
    ]);
  });

  it("the follow-up inherits the parent's priority", async () => {
    // Spawning this by hand used to drop `priority`, so the unresolved
    // rows of an URGENT screen came back NORMAL.
    open();
    await carryForward();
    expect(createTicket.mock.calls[0][0].priority).toBe("URGENT");
  });

  it("the summary names and links the ticket now holding them", async () => {
    open();
    await carryForward();
    const link = await screen.findByRole("link", { name: "ticket #181" });
    expect(link.getAttribute("href")).toBe("#/tickets/181");
  });

  it("names the assignee when the carry-forward was an escalation", async () => {
    createTicket.mockResolvedValue({
      id: 181,
      assignee_name: "pavlidis",
      targets: [{ target_id: 53, target_type: "GEO_ACCESSION" }],
    });
    open();
    await carryForward();
    expect(await screen.findByText(/assigned to pavlidis/)).toBeTruthy();
  });

  it("says nothing about a follow-up when there was none", async () => {
    // A clean close must not imply an escalation happened.
    open(
      mkTicket({
        targets: [
          {
            target_id: 52,
            target_type: "GEO_ACCESSION",
            status: "DONE",
            triage_disposition: "include",
          },
        ],
      } as unknown as Partial<Ticket>),
    );
    await userEvent.click(screen.getByRole("button", { name: /finalize/i }));
    expect(createTicket).not.toHaveBeenCalled();
    expect(screen.queryByText(/carried into/)).toBeNull();
  });
});
