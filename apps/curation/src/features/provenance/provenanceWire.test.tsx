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
import { render } from "@testing-library/react";

import { snakeify } from "@/api/client";
import type { ProvenanceLookupResponse } from "@/api/provenance";

import {
  ProvenanceDot,
  ProvenanceTraceCard,
  originOf,
} from "./ProvenanceDot";
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

/** GSE9121's `prime adult stage` tag — the case Paul screenshotted.
 *  One agent event, one grounding quote, and a `summary` phrased as a
 *  question about a tag that plainly exists. Captured verbatim from
 *  the same route. */
const WIRE_GSE9121 = {
  byRefId: {
    "tag:2": {
      refId: "tag:2",
      reviewState: "unreviewed",
      events: [
        {
          kind: "agent_proposed",
          at: "2026-07-22T10:18:03.148963",
          actor: {
            kind: "agent",
            name: null,
            model: "claude-sonnet-5",
            headSha: "4d8fdbc",
          },
          runId: "2026-07-22_escrow100_baseline",
          summary: "Add tag `developmental stage: prime adult stage`?",
          confidence: null,
          reason: null,
          evidence: [
            {
              quote:
                "BM age='11-15 weeks' → prime adult stage per data/dev_stage_cutoffs.tsv",
              source: "characteristic",
              location: "",
              context: "",
              sourceUrl: "",
              highlights: [],
              verified: null,
            },
          ],
          before: null,
          after: {
            label: "prime adult stage",
            uri: "http://purl.obolibrary.org/obo/UBERON_0018241",
          },
        },
      ],
    },
  },
};

/** What `api.post` hands the caller. */
function asClientSees(): ProvenanceLookupResponse {
  return snakeify(WIRE) as ProvenanceLookupResponse;
}

function withWire(children: React.ReactNode, wire: unknown = WIRE) {
  const res = snakeify(wire) as ProvenanceLookupResponse;
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

  // 🛑 This experiment is the declined-proposal case, and it must show
  // NOTHING. GSE17646's `timepoint` is a sound factor; all the store
  // holds is an agent proposing it be dropped and a curator saying no.
  // That answers "where did this come from" with nothing at all, so a
  // disc here would be reporting an argument, not a source — and an
  // earlier version amber-flagged the factor as though it were
  // defective.
  it("shows no disc when the only record is a declined proposal", () => {
    const { container } = render(withWire(<ProvenanceDot refId="factor:1" />));
    expect(container).toBeEmptyDOMElement();
  });

  // 🛑 The hover exists for the EVIDENCE. Everything else is context
  // for the quote, and the two lines that used to crowd it out were
  // both noise: the proposal's own headline asks "Add tag …?" about a
  // tag that is plainly already there, and the `after` label just
  // repeats the chip the disc is sitting on.
  describe("the hover a curator actually reads", () => {
    // The tooltip portals its body only while open, so read the card
    // directly rather than driving a hover with a 150ms open delay.
    const card = () => {
      const res = snakeify(WIRE_GSE9121) as ProvenanceLookupResponse;
      const origin = originOf(res.by_ref_id["tag:2"]);
      expect(origin).toBeTruthy();
      const { container } = render(
        <ProvenanceTraceCard origin={origin!} />,
      );
      return container.textContent ?? "";
    };

    it("leads with when it arrived and that an agent is the source", () => {
      expect(card()).toContain("From an agent · 2026-07-22");
    });

    it("names the build, because a run is a (model, sha) pair", () => {
      expect(card()).toContain("claude-sonnet-5 · 4d8fdbc");
    });

    it("keeps the grounding quote and says what kind of source it is", () => {
      const text = card();
      expect(text).toContain("sample characteristic");
      expect(text).toContain(
        "BM age='11-15 weeks' → prime adult stage per data/dev_stage_cutoffs.tsv",
      );
    });

    it("drops the proposal's question", () => {
      expect(card()).not.toContain("Add tag");
    });

    // The `after` label is the chip the disc is attached to. Printing
    // it again is a line that tells the curator what they're already
    // looking at — so "prime adult stage" appears exactly once, inside
    // the quote, and not a second time on its own.
    it("doesn't echo the annotation's own label back at the curator", () => {
      const hits = (card().match(/prime adult stage/g) ?? []).length;
      expect(hits).toBe(1);
    });

    it("never says a human failed to review it", () => {
      expect(card()).not.toContain("not reviewed");
    });
  });
});
