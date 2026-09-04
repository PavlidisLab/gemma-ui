/**
 * @vitest-environment jsdom
 *
 * TriageRow's drill-in link.
 *
 * A candidate that turns out to already be a real, imported experiment
 * is typed EXPRESSION_EXPERIMENT (scrape_geo_and_open_triage.py's
 * _create_preboarded, 2026-09-04) and carries no preboarding_id at all
 * -- it isn't a preboarding row, so linking it to
 * `#/experiments/preboarding:<id>` 404s (confirmed live, 2026-09-04,
 * ticket #43: "No preboarded with id 16429"). Its own real experiment
 * page already exists at a bare, unprefixed id; the row should link
 * straight there instead of showing no link at all.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Ticket } from "@/api/tickets";

vi.mock("@/api/tickets", async (orig) => ({
  ...(await orig<typeof import("@/api/tickets")>()),
  useFinalizeTriage: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
  useCreateTicket: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePatchTicketTarget: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));

import { TriageView } from "./TriageView";

function mkTicket(candidates: Record<string, unknown>): Ticket {
  return {
    id: 45,
    type: "SCREENING",
    targets: [
      { target_id: 16429, target_type: "EXPRESSION_EXPERIMENT", status: "NOT_DONE" },
      { target_id: 93464, target_type: "PREBOARDED_EXPERIMENT", status: "NOT_DONE" },
    ],
    payload_json: JSON.stringify({ candidates }),
  } as unknown as Ticket;
}

function open(candidates: Record<string, unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TriageView ticket={mkTicket(candidates)} />
    </QueryClientProvider>,
  );
}

describe("TriageRow links an already-imported candidate to its real experiment page", () => {
  it("links an EXPRESSION_EXPERIMENT target to a bare-id experiment route, not preboarding:", () => {
    open({
      "16429": { accession: "GSE125581", identifying_metadata: { title: "Qk-KO study" } },
      "93464": { accession: "GSE141040", identifying_metadata: { title: "CreER mice" }, preboarding_id: 93464 },
    });
    // Two rows exist; scope to the one for GSE125581.
    const links = screen.getAllByTitle(
      "Open this candidate — full identifying metadata, and the decision.",
    ) as HTMLAnchorElement[];
    const eeLink = links.find((a) => a.textContent === "GSE125581");
    expect(eeLink?.getAttribute("href")).toBe("#/experiments/16429?ticket=45");
    expect(eeLink?.getAttribute("href")).not.toContain("preboarding:");
  });

  it("still links a PREBOARDED_EXPERIMENT target to the preboarding: route", () => {
    open({
      "16429": { accession: "GSE125581", identifying_metadata: { title: "Qk-KO study" } },
      "93464": { accession: "GSE141040", identifying_metadata: { title: "CreER mice" }, preboarding_id: 93464 },
    });
    const links = screen.getAllByTitle(
      "Open this candidate — full identifying metadata, and the decision.",
    ) as HTMLAnchorElement[];
    const preboardedLink = links.find((a) => a.textContent === "GSE141040");
    expect(preboardedLink?.getAttribute("href")).toBe(
      "#/experiments/preboarding:93464?ticket=45",
    );
  });
});
