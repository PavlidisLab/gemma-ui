/**
 * The remote provenance join, against bytes captured off gemma2.
 *
 * `__fixtures__/gemma2_annotation_set_2564.json` is the live response
 * of `GET /rest/v2/datasets/2706/annotation-sets?role=proposal&shape=full`
 * on 2026-09-04, trimmed to four target ids and otherwise verbatim —
 * camelCase envelope, `payloadJson` still a JSON STRING, the real
 * curator ruling on `tag:developmental-stage/embryo-stage` with its
 * real reason.
 *
 * 🛑 **Verbatim matters more here than anywhere.** A case mismatch in
 * this path fails silent: `snakeify` runs on the envelope, the payload
 * string escapes it and is snakeified separately, and if either half
 * were spelled by hand the join would return nothing and render
 * identically to "nothing recorded". The same trap
 * `provenanceWire.test.tsx` was written for.
 */
import { describe, expect, it } from "vitest";

import { annotationSetsToReviews } from "@/api/annotationSetReviews";
import { snakeify } from "@/api/client";
import type { ProvenanceRef } from "@/api/provenance";
import { tagTarget, factorTarget } from "@/features/audit/targetIds";

import { assembleTraces } from "./assembleTraces";
import rows from "./__fixtures__/gemma2_annotation_set_2564.json";

/** Annotations as they stand on dataset 2706 — URIs read off
 *  `GET /datasets/2706/annotations` the same day. */
function refs(): ProvenanceRef[] {
  return [
    {
      ref_id: "tag:1",
      kind: "tag",
      category_uri: "http://www.ebi.ac.uk/efo/EFO_0000399",
      category_label: "developmental stage",
      value_uri: "http://purl.obolibrary.org/obo/UBERON_0000068",
      label: "embryo stage",
      target_id: tagTarget("developmental stage", "embryo stage"),
    },
    {
      ref_id: "tag:2",
      kind: "tag",
      category_uri: "http://www.ebi.ac.uk/efo/EFO_0000324",
      category_label: "cell type",
      value_uri: "http://purl.obolibrary.org/obo/CL_0002195",
      label: "hepatic stem cell",
      target_id: tagTarget("cell type", "hepatic stem cell"),
    },
    {
      ref_id: "factor:1",
      kind: "factor",
      category_uri: "http://www.ebi.ac.uk/efo/EFO_0000322",
      category_label: "cell line",
      label: "cell line",
      target_id: factorTarget("cell line"),
    },
  ];
}

// 🛑 `snakeify` is what `client.ts` does to every response, and the
// fixture is the RAW bytes — so the test crosses the same boundary
// production does. Skipping it here would make the fixture agree with
// nothing but itself.
const reports = annotationSetsToReviews(snakeify(rows), "audit").items;

describe("the remote provenance join, on live gemma2 bytes", () => {
  it("reads the set as a review at all", () => {
    // The whole join hangs off this: `payloadJson` parses, carries
    // `findings`, and the envelope's ruling comes through.
    expect(reports).toHaveLength(1);
    expect(reports[0].findings.length).toBeGreaterThan(0);
    expect(reports[0].dispositions?.length).toBe(1);
  });

  it("traces the tag a curator actually ruled on, with their words", () => {
    const trace = assembleTraces(refs(), reports).get("tag:1");
    expect(trace).toBeTruthy();
    expect(trace!.review_state).toBe("accepted");
    const applied = trace!.events.find((e) => e.kind === "agent_applied");
    expect(applied).toBeTruthy();
    expect(applied!.actor).toMatchObject({ kind: "curator", name: "administrator" });
    // The curator's own reason is the answer to "why does this
    // annotation read the way it does" and outranks anything the agent
    // said. Gemma serves it as `reason`; the store served it as
    // `accept_reason`. Both land here.
    expect(applied!.reason).toContain("the embryonic tag should be removed");
  });

  it("carries the agent side — which run, which model, what it said", () => {
    const trace = assembleTraces(refs(), reports).get("tag:1");
    const proposed = trace!.events.filter((e) => e.kind === "agent_proposed");
    expect(proposed.length).toBeGreaterThan(0);
    const e = proposed[0];
    expect(e.actor).toMatchObject({
      kind: "agent",
      model: "claude-sonnet-5",
      head_sha: "9b89d1b",
    });
    expect(e.at).toBe("2026-09-03T23:40:39.039870+00:00");
    expect(
      proposed.some((p) => (p.summary ?? "").includes("BMEL cell lines")),
    ).toBe(true);
  });

  it("newest first — what happened to it, then where it came from", () => {
    const trace = assembleTraces(refs(), reports).get("tag:1")!;
    expect(trace.events[0].kind).toBe("agent_applied");
    expect(trace.events[trace.events.length - 1].kind).toBe("agent_proposed");
  });

  it("an untouched tag is traced but unreviewed — not silently accepted", () => {
    const trace = assembleTraces(refs(), reports).get("tag:2");
    expect(trace).toBeTruthy();
    expect(trace!.review_state).toBe("unreviewed");
    expect(trace!.events.every((e) => e.kind === "agent_proposed")).toBe(true);
  });

  it("matches a factor whose findings are keyed by category slug", () => {
    const trace = assembleTraces(refs(), reports).get("factor:1");
    expect(trace).toBeTruthy();
    expect(trace!.events.length).toBeGreaterThan(0);
  });

  it("🛑 a ref nothing mentions is OMITTED, not answered empty", () => {
    const extra: ProvenanceRef = {
      ref_id: "tag:99",
      kind: "tag",
      category_uri: "http://www.ebi.ac.uk/efo/EFO_0000635",
      category_label: "organism part",
      value_uri: "http://purl.obolibrary.org/obo/UBERON_0002107",
      label: "liver",
      target_id: tagTarget("organism part", "liver"),
    };
    const out = assembleTraces([...refs(), extra], reports);
    expect(out.has("tag:99")).toBe(false);
  });
});
