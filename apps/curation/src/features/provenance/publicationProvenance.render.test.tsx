/**
 * @vitest-environment jsdom
 *
 * What a curator sees on a linked paper after running "populate
 * provenance": a disc on the row, and on hover the three things that
 * distinguish "GEO said so" from "a human read both papers" — who
 * asserted it, when, and how much anybody checked.
 *
 * The failure this exists to prevent is a four-day one, on the record:
 * GEO's `!Series_pubmed_id` for GSE227854 names the wrong one of the
 * submitter's two NAR 2024 papers, a curator caught it, and a cache
 * rebuild silently re-installed GEO's mistake — because nothing on
 * screen or in the record said where the link had come from.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/api/pubmed", () => ({ usePubmedMetadata: () => ({ data: null }) }));

import type { Publication } from "@/features/experiment/types";

import { PublicationRow } from "@/features/overview/publications";
import { ProvenanceDot, ProvenanceTraceCard, originOf } from "./ProvenanceDot";
import {
  ProvenanceRunContext,
  type ProvenanceRunValue,
} from "./ProvenanceContext";
import { publicationTraces, traceFromPublication } from "./publicationTrace";
import { publicationRefId } from "./refs";

const GEO_BACKFILL: Publication = {
  pubmed_id: "18156441",
  doi: "",
  citation: "",
  title: "HOCl-induced Nrf2 activation in airway epithelial cells",
  association: {
    status: "accepted",
    role: "primary",
    source: "geo_submitter_link",
    evidence:
      "Backfilled 2026-08-17: inferred from the import path, not verified " +
      "against GEO.",
    supporting_evidence: null,
    evidence_code: "IIA",
    confidence: null,
    asserted_by: null,
    asserted_at: "2026-08-17T21:44:02.364+00:00",
  },
};

function withRun(pubs: Publication[], children: React.ReactNode) {
  const byRef = publicationTraces(pubs);
  const run: ProvenanceRunValue = {
    status: "ready",
    byRef,
    asked: pubs.length,
    traced: byRef.size,
    populate: () => {},
    clear: () => {},
  };
  return (
    <ProvenanceRunContext.Provider value={run}>
      {children}
    </ProvenanceRunContext.Provider>
  );
}

describe("the disc on a linked paper", () => {
  it("appears once the run has covered it", () => {
    render(
      withRun([GEO_BACKFILL], <PublicationRow publication={GEO_BACKFILL} />),
    );
    expect(screen.getByTitle("Imported with the dataset · 2026-08-17")).toBeTruthy();
  });

  it("stays away on a backend that carries no association", () => {
    // Every link on the local store today. "Nothing recorded" is the
    // expected answer and must not read as a marker.
    const { association: _drop, ...bare } = GEO_BACKFILL;
    render(withRun([bare], <PublicationRow publication={bare} />));
    expect(screen.queryByTitle(/Imported with the dataset/)).toBeNull();
    // …and the row itself still renders.
    expect(screen.getByText(/PMID 18156441/)).toBeTruthy();
  });

  it("looks itself up under the same handle the run keyed it by", () => {
    render(
      withRun(
        [GEO_BACKFILL],
        <ProvenanceDot refId={publicationRefId(GEO_BACKFILL)} />,
      ),
    );
    expect(screen.getByTitle(/Imported with the dataset/)).toBeTruthy();
  });
});

describe("what the hover says", () => {
  it("states the basis and the evidence code, in words", () => {
    const trace = traceFromPublication(GEO_BACKFILL)!;
    render(<ProvenanceTraceCard origin={originOf(trace)!} />);
    expect(
      screen.getByText("IIA — Inferred from Imported Annotation (GEO)"),
    ).toBeTruthy();
    // 🛑 The one sentence that answers "on what grounds". A trace whose
    // only event IS the decision used to drop it on the floor.
    expect(screen.getByText(/not verified against GEO/)).toBeTruthy();
  });

  it("names the curator who chose it, and quotes their reason", () => {
    const trace = traceFromPublication({
      ...GEO_BACKFILL,
      association: {
        status: "accepted",
        source: "curator",
        evidence: "The series title names this paper almost verbatim.",
        evidence_code: "IC",
        asserted_by: "rachel",
        asserted_at: "2026-08-17T18:00:00.000+00:00",
      },
    })!;
    render(<ProvenanceTraceCard origin={originOf(trace)!} />);
    expect(screen.getByText("Added by rachel · 2026-08-17")).toBeTruthy();
    expect(screen.getByText(/series title/)).toBeTruthy();
  });
});
