/**
 * @vitest-environment jsdom
 *
 * The camelCase → snake_case boundary for the provenance lookup,
 * pinned with bytes the live store actually returned.
 *
 * This project's most expensive recurring bug is a payload read in the
 * wrong case: every field comes back `undefined`, nothing throws, and
 * the surface renders as though the data were simply absent — which is
 * indistinguishable here from the expected "nothing recorded". A
 * hand-written camel fixture wouldn't catch it, because the mistake is
 * always in a field nobody thought to write down. So the payload below
 * is captured verbatim from
 * `POST /rest/v2/datasets/17646/provenance/lookup` on the local store
 * (:8095, 2026-08-16) — trimmed to two events, otherwise untouched,
 * `headSha` / `runId` / `sourceUrl` and all.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { snakeify } from "@/api/client";
import type { ProvenanceLookupResponse } from "@/api/provenance";

import { ProvenanceDot } from "./ProvenanceDot";
import {
  ProvenanceRunContext,
  type ProvenanceRunValue,
} from "./ProvenanceContext";

/** Verbatim wire bytes — GSE17646's `timepoint` factor: an agent
 *  proposed dropping it, a curator declined. Both halves of a trace in
 *  one annotation, which is the case the feature exists for. */
const WIRE = {
  byRefId: {
    "factor:1": {
      refId: "factor:1",
      reviewState: "rejected",
      events: [
        {
          kind: "curator_rejected",
          at: "2026-07-21T04:06:49.400241+00:00",
          actor: {
            kind: "curator",
            name: "local-curator",
            model: null,
            headSha: null,
          },
          runId: null,
          summary: null,
          confidence: null,
          reason: "agent_real_miss",
          evidence: [],
          before: null,
          after: null,
        },
        {
          kind: "agent_proposed",
          at: "2026-07-21T03:07:17+00:00",
          actor: {
            kind: "agent",
            name: null,
            model: "adhoc-decision-ticket",
            headSha: null,
          },
          runId: null,
          summary: "Factor `timepoint` (4 values) — Am dropped it; keep or remove?",
          confidence: null,
          reason: null,
          evidence: [
            {
              quote:
                "embryonic day 14.5 → e.g. Chd8_WT_E14.5_cortex_RNA_REP3 ; Chd8_WT_E14.5_cortex_RNA_REP2",
              source: "sample_names",
              location: "GSM4222693, GSM4222689",
              context: "",
              sourceUrl: "",
              highlights: [],
              verified: null,
            },
          ],
          before: null,
          after: null,
        },
      ],
    },
  },
};

/** What `api.post` hands the caller. */
function asClientSees(): ProvenanceLookupResponse {
  return snakeify(WIRE) as ProvenanceLookupResponse;
}

function withWire(children: React.ReactNode) {
  const res = asClientSees();
  const byRef = new Map(Object.entries(res.by_ref_id));
  const run: ProvenanceRunValue = {
    status: "ready",
    byRef,
    asked: byRef.size,
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

describe("provenance lookup wire", () => {
  it("lands every field the UI reads in snake_case", () => {
    const res = asClientSees();
    const trace = res.by_ref_id["factor:1"];
    expect(trace).toBeTruthy();
    // 🛑 The ref_id keys are OUR handles, not wire fields. snakeify
    // must pass `factor:1` through untouched or the trace never finds
    // the annotation it describes.
    expect(trace.ref_id).toBe("factor:1");
    expect(trace.review_state).toBe("rejected");
    const [declined, proposed] = trace.events;
    expect(declined.kind).toBe("curator_rejected");
    expect(declined.reason).toBe("agent_real_miss");
    expect(proposed.evidence?.[0].source).toBe("sample_names");
    // The nested actor object is the easiest thing to miss — it's two
    // levels down and only one of its fields is multi-word.
    expect(typeof proposed.actor).toBe("object");
    expect((proposed.actor as { model?: string }).model).toBe(
      "adhoc-decision-ticket",
    );
    expect("head_sha" in (proposed.actor as object)).toBe(true);
  });

  // Newest-first is the server's contract, and the hover renders in
  // array order — so a trace reads "what happened to this" before
  // "where it came from".
  it("keeps the server's newest-first event order", () => {
    const events = asClientSees().by_ref_id["factor:1"].events;
    expect(events.map((e) => e.kind)).toEqual([
      "curator_rejected",
      "agent_proposed",
    ]);
  });

  // 🛑 A declined proposal is not a defect in the annotation. The
  // factor is sound; a curator looked at a proposed change and said
  // no. Wording that reads as "this factor is rejected" would send a
  // curator hunting for a problem that doesn't exist.
  it("says a change was declined, not that the annotation is bad", () => {
    render(withWire(<ProvenanceDot refId="factor:1" />));
    expect(
      screen.getByTitle("a curator declined the change proposed here"),
    ).toBeTruthy();
  });
});
