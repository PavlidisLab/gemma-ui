/**
 * @vitest-environment jsdom
 *
 * A real Gemma ticket carries no local `payload_json` at all — confirmed
 * 2026-09-02, no such field exists on the real API's CreateTicketRequest.
 * Every column TriageRow renders (title, taxon, samples, PMIDs, matched
 * criteria) used to fall back to blank for these tickets, because they
 * all read off `payload_json.candidates`.
 *
 * The fix: when a target has no local candidate metadata AND the app is
 * in remote mode, fetch `GET /rest/v2/preboarded/{targetId}` — the same
 * id the target already carries as `target_id` (`EXPRESSION_EXPERIMENT`
 * is used loosely for a not-yet-imported candidate, confirmed live
 * against ticket #15) — and read the descriptive fields from there
 * instead.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Ticket } from "@/api/tickets";

vi.mock("@/api/tickets", async (orig) => ({
  ...(await orig<typeof import("@/api/tickets")>()),
  useFinalizeTriage: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
  usePatchTicketTarget: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useCreateTicket: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/gemmaMode", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/gemmaMode")>("@/lib/gemmaMode");
  return { ...actual, useGemmaMode: vi.fn() };
});

const getMock = vi.fn();
// 🛑 Mock `api.get` ONLY — `snakeify` stays real. TriageView normalizes the
// parsed `identifyingMetadata` blob through it, so stubbing it out would let
// the test agree with itself about key casing while the real code read the
// wrong names. That is the exact failure this file was written to catch.
vi.mock("@/api/client", async (orig) => ({
  ...(await orig<typeof import("@/api/client")>()),
  api: { get: (...args: unknown[]) => getMock(...args) },
}));

import { useGemmaMode } from "@/lib/gemmaMode";
import { TriageView } from "./TriageView";

// A real ticket: no payload_json, one EXPRESSION_EXPERIMENT target whose
// targetId is actually a preboardedId, exactly what
// _create_real_screening_ticket (scripts/scrape_geo_and_open_triage.py)
// produces.
function mkRealTicket(): Ticket {
  return {
    id: 15,
    type: "SCREENING",
    targets: [
      { target_id: 93453, target_type: "EXPRESSION_EXPERIMENT", status: "NOT_DONE" },
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

describe("a real Gemma ticket falls back to /preboarded for candidate metadata", () => {
  beforeEach(() => {
    vi.mocked(useGemmaMode).mockReturnValue({ mode: "remote" } as ReturnType<
      typeof useGemmaMode
    >);
    getMock.mockReset();
    // api.get runs every response through client.ts's snakeify() before a
    // real caller ever sees it (confirmed 2026-09-03 — this is what the
    // bug actually was: the mock here originally returned the RAW
    // camelCase wire shape, which bypassed snakeify entirely and let the
    // test pass while the real code silently read the wrong key name).
    // Mock what api.get actually hands back, not what Gemma sends over
    // the wire.
    getMock.mockResolvedValue({
      accession: "GSE344586",
      // `api.get` snakeifies the RESPONSE, so the envelope key arrives
      // as `identifying_metadata` — but its value is a STRING, so the
      // keys INSIDE it reach TriageView in whatever case the writer
      // used. Verbatim from preboarded 93453 on prod (2026-09-03):
      // camelCase, and `matched_criteria` is NOT among its 16 keys.
      // Gemma stores the blob `@Lob` and never parses it, so this is
      // the documented contract, not drift.
      identifying_metadata: JSON.stringify({
        title: "Metabolic and transcriptomic profiles of glioblastoma invasion",
        organisms: ["Mus musculus", "Homo sapiens"],
        numSamples: 39,
        seriesType: "Expression profiling by high throughput sequencing",
        librarySource: "transcriptomic single cell",
      }),
    });
  });
  afterEach(() => vi.mocked(useGemmaMode).mockReset());

  it("fetches the preboarded row by the target's id", async () => {
    open();
    await screen.findByText(
      "Metabolic and transcriptomic profiles of glioblastoma invasion",
    );
    expect(getMock).toHaveBeenCalledWith("/rest/v2/preboarded/93453");
  });

  it("renders the title from the fallback instead of blank", async () => {
    open();
    expect(
      await screen.findByText(
        "Metabolic and transcriptomic profiles of glioblastoma invasion",
      ),
    ).toBeTruthy();
  });

  it("renders the accession from the fallback, not a bare target-id placeholder", async () => {
    open();
    expect(await screen.findByText("GSE344586")).toBeTruthy();
    expect(screen.queryByText("target 93453")).toBeNull();
  });

  it("does not fetch the fallback in local mode", () => {
    vi.mocked(useGemmaMode).mockReturnValue({ mode: "local" } as ReturnType<
      typeof useGemmaMode
    >);
    open();
    expect(getMock).not.toHaveBeenCalled();
  });

  // 🛑 The blob's keys are camelCase and TriageView reads snake — the
  // join is `snakeify`, run once where the string is parsed. These
  // assert the normalization happens rather than trusting that it does.

  it("renders a camelCase numSamples through to the samples column", async () => {
    open();
    await screen.findByText(
      "Metabolic and transcriptomic profiles of glioblastoma invasion",
    );
    expect(screen.getByText("39")).toBeTruthy();
  });

  it("derives the type label from camelCase seriesType + librarySource", async () => {
    open();
    await screen.findByText(
      "Metabolic and transcriptomic profiles of glioblastoma invasion",
    );
    // `library_source` says single cell, so the Seq label carries the
    // sc marker — which only happens if BOTH camelCase keys normalized.
    expect(screen.getByText("Seq · sc")).toBeTruthy();
  });

  it("🛑 leaves Matched empty when the blob has no matched_criteria", async () => {
    // Preboarded 93453 genuinely has no such key — 4 of 10 rows sampled
    // on prod carry it, 6 do not. An empty column is the honest render;
    // this test exists so nobody "fixes" it by inventing a value.
    open();
    await screen.findByText(
      "Metabolic and transcriptomic profiles of glioblastoma invasion",
    );
    expect(screen.queryByText("brain")).toBeNull();
  });
});
