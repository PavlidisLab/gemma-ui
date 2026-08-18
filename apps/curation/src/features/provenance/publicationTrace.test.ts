/**
 * A linked paper's provenance, against the bytes gemma2 actually sends.
 *
 * The association block below is copied verbatim out of
 * `GET https://gemma2.msl.ubc.ca/rest/v2/datasets/1658/publications`
 * on 2026-08-17, then snakeified the way `api.client` snakeifies every
 * response. Captured rather than hand-written for the same reason
 * `provenanceWire.test.tsx` captures its payload: a case mismatch here
 * fails silently and renders identically to "nothing recorded".
 */
import { describe, expect, it } from "vitest";

import type { Publication } from "@/features/experiment/types";

import { publicationTraces, traceFromPublication } from "./publicationTrace";
import { publicationRefId, provenanceRefs } from "./refs";

/** eid 1658 / GSE11630's primary publication, as the wire has it. */
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
      "Backfilled 2026-08-17: dataset was imported from GEO and carries a " +
      "primary publication, and the GEO importer is the only writer that " +
      "sets one automatically, so this is taken to be GEO's " +
      "!Series_pubmed_id. Inferred from the import path, not verified " +
      "against GEO, and not distinguishable here from a link a curator set " +
      "by hand.",
    supporting_evidence: null,
    evidence_code: "IIA",
    confidence: null,
    asserted_by: null,
    asserted_at: "2026-08-17T21:44:02.364+00:00",
  },
};

describe("a link that can account for itself", () => {
  it("reads the GEO backfill as an import, with its date and its code", () => {
    const trace = traceFromPublication(GEO_BACKFILL);
    expect(trace).toBeTruthy();
    expect(trace?.ref_id).toBe("publication:pmid:18156441");
    expect(trace?.events).toHaveLength(1);
    const e = trace!.events[0];
    expect(e.kind).toBe("imported");
    expect(e.actor).toEqual({ kind: "import" });
    expect(e.at).toBe("2026-08-17T21:44:02.364+00:00");
    expect(e.evidence_code).toBe("IIA");
    expect(e.reason).toContain("not verified");
  });

  it("does not turn Gemma's accepted status into a human's verdict", () => {
    // 🛑 `status: accepted` says the LINK stands, not that anybody
    // reviewed it. 23,066 of these rows were written by a migration.
    expect(traceFromPublication(GEO_BACKFILL)?.review_state).toBeNull();
  });

  it("keeps a curator's own words and names them the curator's", () => {
    const trace = traceFromPublication({
      ...GEO_BACKFILL,
      association: {
        status: "accepted",
        role: "primary",
        source: "curator",
        evidence: "The series title names this paper almost verbatim.",
        evidence_code: "IC",
        asserted_by: "rachel",
        asserted_at: "2026-08-17T18:00:00.000+00:00",
      },
    });
    expect(trace?.events[0].kind).toBe("curator_added");
    expect(trace?.events[0].actor).toEqual({ kind: "curator", name: "rachel" });
    expect(trace?.events[0].reason).toContain("series title");
  });

  it("marks an agent's link as an agent's", () => {
    const trace = traceFromPublication({
      ...GEO_BACKFILL,
      association: { status: "accepted", source: "agent", evidence: "" },
    });
    expect(trace?.events[0].kind).toBe("agent_applied");
    expect(trace?.events[0].actor).toEqual({ kind: "agent" });
  });
});

describe("silence over a confident lie", () => {
  it("says nothing for a link with no association at all", () => {
    // The local store does not carry the field, and Gemma itself has
    // writers that set a publication without recording one.
    const { association: _drop, ...bare } = GEO_BACKFILL;
    expect(traceFromPublication(bare)).toBeNull();
  });

  it("says nothing for a legacy row", () => {
    // 🛑 `legacy` IS Gemma's word for "no recorded basis" — 108 rows,
    // lowest rank, no evidence. Rendering it as an origin would answer
    // "where did this come from" with a row that exists to say nobody
    // knows.
    expect(
      traceFromPublication({
        ...GEO_BACKFILL,
        association: { status: "accepted", source: "legacy", evidence: null },
      }),
    ).toBeNull();
  });

  it("says nothing for a paper that was ruled out", () => {
    expect(
      traceFromPublication({
        ...GEO_BACKFILL,
        association: {
          status: "rejected",
          source: "curator",
          evidence: "GEO's !Series_pubmed_id names a different NAR 2024 paper.",
        },
      }),
    ).toBeNull();
  });

  it("says nothing for a row with neither a PMID nor a DOI", () => {
    expect(
      traceFromPublication({ ...GEO_BACKFILL, pubmed_id: "", doi: "" }),
    ).toBeNull();
  });
});

describe("the run covers publications", () => {
  it("asks about every linked paper, traced or not", () => {
    const refs = provenanceRefs({
      experiment_id: 1658,
      experiment_short_name: "GSE11630",
      factors: [],
      biomaterials: [],
      tags: [],
      publications: [
        GEO_BACKFILL,
        { pubmed_id: "", doi: "10.1234/x", citation: "", title: "" },
        // No handle, no question.
        { pubmed_id: "", doi: "", citation: "", title: "untraceable" },
      ],
    });
    expect(refs.map((r) => r.ref_id)).toEqual([
      "publication:pmid:18156441",
      "publication:doi:10.1234/x",
    ]);
    expect(refs.every((r) => r.kind === "publication")).toBe(true);
    expect(refs[0].pubmed_id).toBe("18156441");
  });

  it("keys a derived trace under the handle the disc looks up", () => {
    const traces = publicationTraces([GEO_BACKFILL]);
    expect(traces.get(publicationRefId(GEO_BACKFILL))).toBeTruthy();
    expect(traces.size).toBe(1);
  });
});
