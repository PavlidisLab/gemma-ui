/**
 * @vitest-environment jsdom
 *
 * Getting from the triage table into a candidate.
 *
 * The row's most prominent link used to go OUT to NCBI, and the way
 * further into our own app was a 10px "view ↗" underneath it. These pin
 * the corrected priority — the accession opens the candidate, GEO is
 * still there but secondary — plus the wider click targets, because a
 * curator working a 19-row screen should not have to aim.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { Ticket } from "@/api/tickets";
import { TriageView } from "./TriageView";

const navigate = vi.hoisted(() => vi.fn());

vi.mock("@/routes", async (orig) => ({
  ...(await orig<typeof import("@/routes")>()),
  navigate,
}));

vi.mock("@/api/tickets", () => ({
  useFinalizeTriage: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
  usePatchTicketTarget: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));

/** A legacy GEO-scrape ticket: no display_fields anywhere, which is the
 *  shape that fell through to the fixed table (and, before this, lost
 *  the bulk bar entirely). */
function mkTicket(): Ticket {
  return {
    id: 180,
    targets: [
      { target_id: 52, target_type: "GEO_ACCESSION", status: "NOT_DONE" },
      { target_id: 53, target_type: "GEO_ACCESSION", status: "NOT_DONE" },
    ],
    payload_json: JSON.stringify({
      candidates: {
        "52": {
          accession: "GSE343489",
          preboarding_id: 52,
          identifying_metadata: { title: "A brain study" },
        },
        "53": { accession: "GSE343367", preboarding_id: 53 },
      },
    }),
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

describe("reaching a candidate from the triage table", () => {
  beforeEach(() => navigate.mockClear());

  it("the accession opens the candidate, not NCBI", () => {
    open();
    const acc = screen.getByRole("link", { name: "GSE343489" });
    expect(acc.getAttribute("href")).toBe(
      "#/experiments/preboarding:52?ticket=180",
    );
  });

  it("GEO is still one click, just no longer the default one", () => {
    open();
    const geo = screen.getAllByRole("link", { name: "GEO ↗" })[0];
    expect(geo.getAttribute("href")).toContain(
      "ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE343489",
    );
    expect(geo.getAttribute("target")).toBe("_blank");
  });

  it("gives every row a full-size chevron target too", () => {
    open();
    expect(
      screen.getByRole("link", { name: "Open GSE343489" }).getAttribute("href"),
    ).toBe("#/experiments/preboarding:52?ticket=180");
  });

  it("clicking anywhere in the row opens it", async () => {
    open();
    await userEvent.click(screen.getByText("A brain study"));
    expect(navigate).toHaveBeenCalledWith(
      "#/experiments/preboarding:52?ticket=180",
    );
  });

  it("clicking the checkbox selects instead of navigating", async () => {
    open();
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Select GSE343489" }),
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("clicking a decision button decides instead of navigating", async () => {
    open();
    await userEvent.click(screen.getAllByRole("button", { name: "Include" })[0]);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("bulk decisions on a legacy GEO-scrape ticket", () => {
  it("offers select-all — it used to render only for display_fields tickets", () => {
    open();
    expect(screen.getByLabelText(/Select all/)).toBeTruthy();
  });

  it("offers an undecide path once rows are selected", async () => {
    open();
    await userEvent.click(screen.getByLabelText(/Select all/));
    expect(
      screen.getByRole("button", { name: "Undecide selected" }),
    ).toBeTruthy();
    // "Clear selection" must read as clearing the SELECTION, not the
    // decisions, now that both live in the same bar.
    expect(screen.getByRole("button", { name: "Clear selection" })).toBeTruthy();
  });
});
