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
import type { Publication } from "@/features/experiment/types";

import { publicationTraces } from "./publicationTrace";

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

/** GSE9121's `prime adult stage` tag — the screenshotted case.
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

    it("keeps the grounding quote and names the source it came from", () => {
      const text = card();
      // Labelled, and labelled with WHERE it came from — a bare
      // "sample characteristic" leaves the curator guessing whether
      // the submitter wrote it or we derived it.
      expect(text).toContain("Evidence: GEO sample characteristic");
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

/**
 * The OTHER wire a provenance run reads, and the one that had no pin.
 *
 * A publication's trace does not come from the lookup route — the
 * association rides on `Design.publications`, so it crosses the same
 * camel→snake boundary in a completely different response. Every other
 * publication test hand-writes the snake_case fixture, which pins the
 * conversion of the trace but not the conversion of the bytes: a
 * renamed wire field would leave `evidence_code` / `asserted_at`
 * `undefined` and render exactly like "nothing recorded".
 *
 * Captured verbatim from `GET /rest/v2/datasets/24976/design` on the
 * local store (:8095, 2026-08-19), the day the associations landed in
 * the store — both entries, untouched. GSE99114 is the useful capture
 * precisely because its two papers disagree: Gemma asserts the Cell Rep
 * one and carries nothing for the eNeuro one, so one row must show a
 * disc and the other must not.
 */
const WIRE_DESIGN_PUBLICATIONS = [
  {
    association: null,
    authors: "Groves A, Kihara Y, Jonnalagadda D, Rivera R, Kennedy G, Mayford M, et al.",
    citation: "Groves A et al., 2018. eNeuro.",
    doi: "10.1523/ENEURO.0239-18.2018",
    journal: "eNeuro",
    pubmedId: "30255127",
    title:
      "A Functionally Defined In Vivo Astrocyte Population Identified by c-Fos " +
      "Activation in a Mouse Model of Multiple Sclerosis Modulated by S1P " +
      "Signaling: Immediate-Early Astrocytes (ieAstrocytes).",
    year: "2018",
  },
  {
    association: {
      assertedAt: "2026-08-19T00:36:33.570+00:00",
      assertedBy: "administrator",
      confidence: null,
      evidence:
        "Checked against GEO on 2026-08-19: GSE99114 lists !Series_pubmed_id " +
        "38064339 as its first (primary) publication.",
      evidenceCode: "TAS",
      role: "primary",
      source: "geo_submitter_link",
      status: "accepted",
      supportingEvidence: null,
    },
    authors:
      "Jonnalagadda D, Kihara Y, Groves A, Ray M, Saha A, Ellington C, " +
      "Lee-Okada HC, Furihata T, Yokomizo T, Quadros EV, Rivera R, Chun J",
    citation: "Jonnalagadda D et al., 2023. Cell Rep.",
    doi: "10.1016/j.celrep.2023.113545",
    journal: "Cell Rep",
    pubmedId: "38064339",
    title:
      "FTY720 requires vitamin B(12)-TCN2-CD320 signaling in astrocytes to " +
      "reduce disease in an animal model of multiple sclerosis.",
    year: "2023",
  },
];

describe("the design wire a publication's trace is built from", () => {
  const traces = () =>
    publicationTraces(snakeify(WIRE_DESIGN_PUBLICATIONS) as Publication[]);

  it("keeps every association field the disc reads", () => {
    const trace = traces().get("publication:pmid:38064339");
    expect(trace).toBeTruthy();
    const [e] = trace!.events;
    expect(e.kind).toBe("imported");
    expect(e.at).toBe("2026-08-19T00:36:33.570+00:00");
    // The three that only exist in camelCase on the wire, and each of
    // which renders as its own line in the hover.
    expect(e.evidence_code).toBe("TAS");
    expect(e.reason).toContain("Checked against GEO");
    expect(e.actor).toEqual({ kind: "import", name: "administrator" });
  });

  it("carries no trace for the paper Gemma asserts nothing about", () => {
    // 39 (experiment, PMID) pairs across the store are like this. Absent
    // provenance is a fact about the link, not a hole in the data.
    expect(traces().has("publication:pmid:30255127")).toBe(false);
  });

  it("puts the disc on the asserted paper and not on the other", () => {
    const byRef = traces();
    const run: ProvenanceRunValue = {
      status: "ready",
      byRef,
      asked: 2,
      traced: byRef.size,
      populate: () => {},
      clear: () => {},
    };
    const { container } = render(
      <ProvenanceRunContext.Provider value={run}>
        <ProvenanceDot refId="publication:pmid:38064339" />
        <ProvenanceDot refId="publication:pmid:30255127" />
      </ProvenanceRunContext.Provider>,
    );
    expect(
      container.querySelectorAll('[title^="Imported with the dataset"]'),
    ).toHaveLength(1);
  });

  it("says how much anybody checked, in words", () => {
    const origin = originOf(traces().get("publication:pmid:38064339")!);
    const { container } = render(<ProvenanceTraceCard origin={origin!} />);
    const text = container.textContent ?? "";
    // 🛑 TAS vs IIA is the whole point: 855 store entries carry TAS
    // (someone checked GEO), 152 carry IIA (inferred from the import
    // path). Rendering the bare code would leave that unreadable.
    expect(text).toContain("TAS — Traceable Author Statement");
    expect(text).toContain("Checked against GEO");
  });
});

/** Verbatim wire bytes — GSE12623's `assay: bulk RNA-seq assay`,
 *  captured from `POST /rest/v2/datasets/12623/provenance/lookup`
 *  (:8095, 2026-08-22). Three `agent_proposed` events, of which the
 *  first two are identical in every field including the microsecond.
 *  The third is a genuinely separate proposal: earlier, its own run,
 *  and the only one carrying the agent version. */
const WIRE_GSE12623_DUPLICATE = {
  byRefId: {
    "tag:7": {
      refId: "tag:7",
      reviewState: "unreviewed",
      events: [
        {
          kind: "agent_proposed",
          at: "2026-08-22T10:58:57.908610+00:00",
          actor: { kind: "agent", name: null, model: "claude-sonnet-5", headSha: null },
          runId: null,
          summary:
            "All samples are bulk total RNA-seq on a single platform, so this assay tag is accurate.",
          confidence: null,
          confidenceBucket: null,
          reason: null,
          evidence: [],
          before: null,
          after: null,
        },
        {
          kind: "agent_proposed",
          at: "2026-08-22T10:58:57.908610+00:00",
          actor: { kind: "agent", name: null, model: "claude-sonnet-5", headSha: null },
          runId: null,
          summary:
            "All samples are bulk total RNA-seq on a single platform, so this assay tag is accurate.",
          confidence: null,
          confidenceBucket: null,
          reason: null,
          evidence: [],
          before: null,
          after: null,
        },
        {
          kind: "agent_proposed",
          at: "2026-08-22T08:22:24.118053+00:00",
          actor: {
            kind: "agent",
            name: "v1.1-359-g4fdddb7-dirty",
            model: "claude-sonnet-5",
            headSha: "4fdddb7",
          },
          runId: "2026-08-22_test100b_smoke10",
          summary:
            "All samples are bulk total RNA-seq on a single platform, so this assay tag is accurate.",
          confidence: null,
          confidenceBucket: null,
          reason: null,
          evidence: [],
          before: null,
          after: null,
        },
      ],
    },
  },
};

describe("a trace the store sent twice", () => {
  const trace = () =>
    (snakeify(WIRE_GSE12623_DUPLICATE) as ProvenanceLookupResponse).by_ref_id[
      "tag:7"
    ];

  it("collapses the identical pair and keeps the distinct proposal", () => {
    const origin = originOf(trace())!;
    // Oldest is the origin — the 08:22 run. What remains below it is
    // ONE line, not the two the store sent.
    expect(origin.event.run_id).toBe("2026-08-22_test100b_smoke10");
    expect(origin.rest).toHaveLength(1);
    expect(origin.rest[0].at).toBe("2026-08-22T10:58:57.908610+00:00");
  });

  it("does not print the same sentence twice", () => {
    const { container } = render(
      <ProvenanceTraceCard origin={originOf(trace())!} />,
    );
    const text = container.textContent ?? "";
    const hits = text.split("proposed by an agent").length - 1;
    expect(hits).toBe(1);
  });

  it("keeps two proposals that differ in any field", () => {
    // The guard is identity, not similarity: same annotation, same
    // agent, same second, different run is still two events.
    const wire = JSON.parse(JSON.stringify(WIRE_GSE12623_DUPLICATE));
    wire.byRefId["tag:7"].events[1].runId = "some-other-run";
    const res = snakeify(wire) as ProvenanceLookupResponse;
    expect(originOf(res.by_ref_id["tag:7"])!.rest).toHaveLength(2);
  });
});
