/**
 * @vitest-environment jsdom
 *
 * The preboarding candidate page carries the ticket's decision.
 *
 * A curator drills in from a screen to READ the candidate, which is
 * exactly when they are best placed to decide it — so the two buttons
 * live in the title bar rather than back on the table. The decision is
 * the same row in the store either way, so this pins that the page
 * writes what the triage row writes, and that the control only appears
 * when a ticket actually gave it somewhere to write.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { Ticket } from "@/api/tickets";
import { PreboardingDetailPage } from "./PreboardingDetailPage";

const navigate = vi.hoisted(() => vi.fn());

vi.mock("@/routes", async (orig) => ({
  ...(await orig<typeof import("@/routes")>()),
  navigate,
}));

const ticket = vi.hoisted(() => ({ current: null as Ticket | null }));
const mutate = vi.hoisted(() => vi.fn());

vi.mock("@/api/tickets", () => ({
  useTicket: () => ({ data: ticket.current }),
  usePatchTicketTarget: () => ({ mutate, isPending: false, error: null }),
}));

// Mock `api` only — `snakeify` stays real, because `parsePayload`
// normalizes the ticket payload through it. Stubbing the whole module
// leaves `snakeify` undefined and every payload reads as empty.
vi.mock("@/api/client", async (orig) => ({
  ...(await orig<typeof import("@/api/client")>()),
  api: { get: vi.fn().mockResolvedValue({ short_name: "GSE999", name: "A study" }) },
}));

function mkTicket(decision?: Record<string, string>): Ticket {
  return {
    id: 180,
    targets: [
      { target_id: 7, target_type: "GEO_ACCESSION", status: "NOT_DONE" },
    ],
    payload_json: JSON.stringify({
      candidates: { "7": { accession: "GSE999", preboarding_id: 52 } },
      decision,
    }),
  } as unknown as Ticket;
}

/** A three-candidate screen with the current page in the middle. */
function mkQueue(): Ticket {
  return {
    id: 180,
    targets: [
      { target_id: 6, target_type: "GEO_ACCESSION" },
      { target_id: 7, target_type: "GEO_ACCESSION" },
      { target_id: 8, target_type: "GEO_ACCESSION" },
    ],
    payload_json: JSON.stringify({
      candidates: {
        "6": { accession: "GSE1", preboarding_id: 51 },
        "7": { accession: "GSE999", preboarding_id: 52 },
        "8": { accession: "GSE3", preboarding_id: 53 },
      },
    }),
  } as unknown as Ticket;
}

function open(props: { ticketContext?: string } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PreboardingDetailPage
        experimentId="preboarding:52"
        preloaded={{ short_name: "GSE999", name: "A study" } as never}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("preboarding decision in the title bar", () => {
  beforeEach(() => {
    ticket.current = null;
    mutate.mockClear();
  });

  it("shows the ticket's own verbs, not Include / Exclude", () => {
    ticket.current = mkTicket({
      confirm_label: "Confirm",
      reject_label: "Reject",
    });
    open({ ticketContext: "180" });
    expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Include" })).toBeNull();
  });

  it("falls back to Include / Exclude when the ticket didn't spec verbs", () => {
    ticket.current = mkTicket();
    open({ ticketContext: "180" });
    expect(screen.getByRole("button", { name: "Include" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Exclude" })).toBeTruthy();
  });

  it("writes the same patch the triage row writes", async () => {
    ticket.current = mkTicket();
    open({ ticketContext: "180" });
    await userEvent.click(screen.getByRole("button", { name: "Include" }));
    expect(mutate).toHaveBeenCalledWith({
      target_type: "GEO_ACCESSION",
      target_id: 7,
      patch: { triage_disposition: "include", status: "DONE" },
    });
  });

  it("shows no decision at all without a ticket in the URL", () => {
    ticket.current = null;
    open();
    expect(screen.queryByRole("button", { name: "Include" })).toBeNull();
  });

  it("shows no decision when the candidate isn't on that ticket", () => {
    ticket.current = {
      id: 180,
      targets: [{ target_id: 7, target_type: "GEO_ACCESSION" }],
      payload_json: JSON.stringify({
        candidates: { "7": { accession: "GSE1", preboarding_id: 999 } },
      }),
    } as unknown as Ticket;
    open({ ticketContext: "180" });
    expect(screen.queryByRole("button", { name: "Include" })).toBeNull();
  });

  it("renders the ticket's prompt beside the buttons when it has one", () => {
    ticket.current = mkTicket({
      confirm_label: "Keep",
      reject_label: "Drop",
      prompt: "Is this the right paper?",
    });
    open({ ticketContext: "180" });
    expect(screen.getByText("Is this the right paper?")).toBeTruthy();
  });

  it("clicking the lit side again clears the decision", async () => {
    ticket.current = {
      ...mkTicket(),
      targets: [
        {
          target_id: 7,
          target_type: "GEO_ACCESSION",
          triage_disposition: "include",
        },
      ],
    } as unknown as Ticket;
    open({ ticketContext: "180" });
    await userEvent.click(screen.getByRole("button", { name: /^Include/ }));
    expect(mutate).toHaveBeenCalledWith({
      target_type: "GEO_ACCESSION",
      target_id: 7,
      patch: { triage_disposition: null, status: "NOT_DONE" },
    });
  });

  it("says so, rather than leaving the undo hidden", () => {
    ticket.current = {
      ...mkTicket(),
      targets: [
        {
          target_id: 7,
          target_type: "GEO_ACCESSION",
          triage_disposition: "include",
        },
      ],
    } as unknown as Ticket;
    open({ ticketContext: "180" });
    // The accessible name stays the verb; the hint rides in the
    // tooltip, and the pressed state is what assistive tech reads.
    const lit = screen.getByRole("button", { name: "Include" });
    expect(lit.getAttribute("title")).toMatch(/click again to clear/);
    expect(lit.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("walking the candidate queue", () => {
  beforeEach(() => {
    ticket.current = null;
    navigate.mockClear();
  });

  it("shows the position in the queue", () => {
    ticket.current = mkQueue();
    open({ ticketContext: "180" });
    expect(screen.getByText("2 of 3")).toBeTruthy();
  });

  it("steps to the next candidate, keeping the ticket context", async () => {
    ticket.current = mkQueue();
    open({ ticketContext: "180" });
    await userEvent.click(screen.getByRole("button", { name: "→" }));
    expect(navigate).toHaveBeenCalledWith(
      "#/experiments/preboarding:53?ticket=180",
    );
  });

  it("steps back", async () => {
    ticket.current = mkQueue();
    open({ ticketContext: "180" });
    await userEvent.click(screen.getByRole("button", { name: "←" }));
    expect(navigate).toHaveBeenCalledWith(
      "#/experiments/preboarding:51?ticket=180",
    );
  });

  it("binds Shift + arrows", async () => {
    ticket.current = mkQueue();
    open({ ticketContext: "180" });
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(navigate).toHaveBeenCalledWith(
      "#/experiments/preboarding:53?ticket=180",
    );
  });

  it("leaves a plain arrow alone so the page still scrolls", async () => {
    ticket.current = mkQueue();
    open({ ticketContext: "180" });
    await userEvent.keyboard("{ArrowRight}");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("shows no queue controls when the ticket has one candidate", () => {
    ticket.current = mkTicket();
    open({ ticketContext: "180" });
    expect(screen.queryByRole("button", { name: "→" })).toBeTruthy();
    expect(screen.getByText("1 of 1")).toBeTruthy();
  });

  it("shows no queue controls with no ticket at all", () => {
    open();
    expect(screen.queryByRole("button", { name: "→" })).toBeNull();
  });
});
