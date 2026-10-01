/**
 * Gemma-sourced fallback for tags a batch script wrote directly to the
 * Statement, with no tracked proposal/review behind it.
 *
 * Confirmed on GSE43764/exp 9737, 2026-10-01
 * (UIB_TO_CAB_2026_10_01_PROVENANCE_GAP_BATCH_WRITES_NO_FINDINGS.md →
 * CAB_TO_UIB_2026_10_01_PROVENANCE_GAP_IS_UI_SIDE_NOT_BATCH_SCRIPTS.md): the
 * tag's `supportingEvidence` was already on the live Gemma Statement, but
 * `assembleTraces` only ever reads findings + dispositions, so the trace
 * came back empty though the evidence was never actually missing. These
 * pin `augmentTracesWithGemmaTagEvidence` directly — mirrors
 * `test_provenance_gemma_tag_fallback.py` in the agents repo, minus the two
 * cases that don't apply here (no separate live-Gemma row / URI join on
 * this side — the evidence already rides on the same ref `tagRef` built).
 */
import { describe, expect, it } from "vitest";

import type { FindingEvidence } from "@/api/justification";
import type { ProvenanceRef, ProvenanceTrace } from "@/api/provenance";

import { augmentTracesWithGemmaTagEvidence } from "./assembleTraces";

const SEX_TAG_EVIDENCE: FindingEvidence[] = [
  {
    source: "inferred",
    quote: 'inferred from the sample characteristic "gender: female"',
    location: "curator ruling, 2026-09-07",
  },
];

function tagRef(overrides: Partial<ProvenanceRef> = {}): ProvenanceRef {
  return {
    ref_id: "tag:1",
    kind: "tag",
    category_uri: "http://purl.obolibrary.org/obo/PATO_0000047",
    value_uri: "http://purl.obolibrary.org/obo/PATO_0000383",
    evidence_code: "IEA",
    supporting_evidence: SEX_TAG_EVIDENCE,
    ...overrides,
  };
}

describe("augmentTracesWithGemmaTagEvidence", () => {
  it("gives an untraced tag a trace from its own Gemma evidence", () => {
    const traces = new Map<string, ProvenanceTrace>();
    augmentTracesWithGemmaTagEvidence(traces, [tagRef()]);
    const t = traces.get("tag:1")!;
    expect(t.events[0].kind).toBe("imported");
    expect(t.events[0].actor).toMatchObject({ kind: "import" });
    expect(t.events[0].evidence?.[0].quote).toBe(
      'inferred from the sample characteristic "gender: female"',
    );
    expect(t.review_state).toBe("unreviewed");
  });

  it("credits an IC-coded tag to the curator, not import", () => {
    const traces = new Map<string, ProvenanceTrace>();
    augmentTracesWithGemmaTagEvidence(
      traces,
      [tagRef({ evidence_code: "IC" })],
    );
    const t = traces.get("tag:1")!;
    expect(t.events[0].kind).toBe("curator_added");
    expect(t.events[0].actor).toMatchObject({ kind: "curator" });
    expect(t.review_state).toBe("curator_authored");
  });

  it("never clobbers a trace the store/join already answered", () => {
    const existing: ProvenanceTrace = {
      ref_id: "tag:1",
      review_state: "accepted",
      events: [],
    };
    const traces = new Map<string, ProvenanceTrace>([["tag:1", existing]]);
    augmentTracesWithGemmaTagEvidence(traces, [tagRef()]);
    expect(traces.get("tag:1")).toBe(existing);
    expect(traces.get("tag:1")!.events).toEqual([]);
  });

  it("a ref with no supporting evidence contributes nothing", () => {
    const traces = new Map<string, ProvenanceTrace>();
    augmentTracesWithGemmaTagEvidence(
      traces,
      [tagRef({ supporting_evidence: null })],
    );
    expect(traces.size).toBe(0);
  });

  it("a factor-kind ref is never touched", () => {
    const traces = new Map<string, ProvenanceTrace>();
    augmentTracesWithGemmaTagEvidence(
      traces,
      [tagRef({ kind: "factor", ref_id: "factor:1" })],
    );
    expect(traces.size).toBe(0);
  });
});
