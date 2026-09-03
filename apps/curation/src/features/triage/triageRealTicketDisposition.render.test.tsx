/**
 * @vitest-environment jsdom
 *
 * Clicking Include/Exclude on a real Gemma ticket.
 *
 * TriageRow's `apply` hardcoded `target_type: "GEO_ACCESSION"` on every
 * disposition patch — harmless in local mode (the store never carries
 * anything else), but `patchGemmaTargetStatus` resolves the target ROW id
 * by matching BOTH target_type AND target_id (api/tickets.ts::
 * findTicketTarget), and a real target's type is PREBOARDED_EXPERIMENT /
 * EXPRESSION_EXPERIMENT / etc. — never GEO_ACCESSION. The lookup silently
 * never matched, and the mutation threw. Confirmed live 2026-09-03.
 *
 * This exercises the REAL usePatchTicketTarget -> patchGemmaTargetStatus
 * chain (only @/api/client's transport is mocked) via an actual click,
 * so it proves the fix routes correctly end to end at the component
 * level -- the API side of this exact PATCH shape was separately proven
 * live against gemma2.msl.ubc.ca (ticket #18) before this test was written.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Ticket } from "@/api/tickets";

vi.mock("@/api/tickets", async (orig) => ({
  ...(await orig<typeof import("@/api/tickets")>()),
  useFinalizeTriage: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
  useCreateTicket: () => ({ mutateAsync: vi.fn(), isPending: false }),
  // usePatchTicketTarget / patchGemmaTargetStatus / findTicketTarget /
  // gemmaScreeningResult are the REAL implementations, deliberately not
  // mocked here -- that's the whole point of this test.
}));

vi.mock("@/lib/gemmaMode", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/gemmaMode")>("@/lib/gemmaMode");
  return {
    ...actual,
    useGemmaMode: vi.fn(),
    // usePatchTicketTarget's mutationFn calls the plain resolveGemmaMode()
    // directly, NOT the useGemmaMode() hook -- two separate entry points
    // into the same mode resolution, and mocking only the hook (as the
    // /preboarded fallback test does) silently leaves this one on its
    // real, unmocked, local-mode-by-default behavior. Caught by this
    // test's first run: the PATCH went to /curation/v1/... instead of
    // gemma2's real route.
    resolveGemmaMode: vi.fn(),
  };
});

const getMock = vi.fn();
const patchMock = vi.fn();
vi.mock("@/api/client", () => ({
  api: {
    get: (...args: unknown[]) => getMock(...args),
    patch: (...args: unknown[]) => patchMock(...args),
  },
}));

import { resolveGemmaMode, useGemmaMode } from "@/lib/gemmaMode";
import { TriageView } from "./TriageView";

// Exactly what _create_real_screening_ticket (scripts/scrape_geo_and_open_
// triage.py) produces: no payload_json, one PREBOARDED_EXPERIMENT target
// whose own row id (551) is DIFFERENT from its targetId (93463) -- the
// distinction the bug conflated.
function mkRealTicket(): Ticket {
  return {
    id: 18,
    type: "SCREENING",
    targets: [
      {
        id: 551,
        target_id: 93463,
        target_type: "PREBOARDED_EXPERIMENT",
        status: "NOT_DONE",
      },
    ],
  } as unknown as Ticket;
}

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TriageView ticket={mkRealTicket()} />
    </QueryClientProvider>,
  );
}

describe("Include/Exclude on a real Gemma ticket", () => {
  beforeEach(() => {
    vi.mocked(useGemmaMode).mockReturnValue({ mode: "remote" } as ReturnType<
      typeof useGemmaMode
    >);
    vi.mocked(resolveGemmaMode).mockReturnValue({ mode: "remote" } as ReturnType<
      typeof resolveGemmaMode
    >);
    getMock.mockReset();
    patchMock.mockReset();
    // The preboarded-fallback fetch TriageRow also makes — irrelevant to
    // this test but must resolve so the row renders without erroring.
    getMock.mockImplementation((path: string) => {
      if (path.includes("/preboarded/")) {
        return Promise.resolve({
          accession: "GSE343297",
          identifying_metadata: JSON.stringify({ title: "A brain study" }),
        });
      }
      // patchGemmaTargetStatus's fallback re-fetch of the ticket, if it
      // isn't already cached under ["ticket", 18].
      return Promise.resolve(mkRealTicket());
    });
    patchMock.mockResolvedValue(mkRealTicket());
  });
  afterEach(() => {
    vi.mocked(useGemmaMode).mockReset();
    vi.mocked(resolveGemmaMode).mockReset();
  });

  it("PATCHes the target's real row id, not its targetId", async () => {
    open();
    await screen.findByText("A brain study");
    await userEvent.click(screen.getAllByRole("button", { name: "Include" })[0]);
    expect(patchMock).toHaveBeenCalledWith(
      expect.stringContaining("/tickets/18/targets/551"),
      expect.anything(),
    );
  });

  it("sends the real screeningResult vocabulary, not the local one", async () => {
    open();
    await screen.findByText("A brain study");
    await userEvent.click(screen.getAllByRole("button", { name: "Include" })[0]);
    const [, body] = patchMock.mock.calls[0];
    expect(body.screeningResult).toBe("INCLUDE");
  });

  it("does not PATCH a GEO_ACCESSION-addressed URL for a real target", async () => {
    open();
    await screen.findByText("A brain study");
    await userEvent.click(screen.getAllByRole("button", { name: "Include" })[0]);
    const [path] = patchMock.mock.calls[0];
    expect(path).not.toContain("GEO_ACCESSION");
    expect(path).not.toContain("/targets/93463");
  });
});
