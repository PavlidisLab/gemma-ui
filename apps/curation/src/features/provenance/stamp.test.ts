/**
 * The stamp overrides the server's matcher, so the tests that matter
 * most here are the ones about NOT stamping. A missing stamp costs a
 * reconstruction the matcher is good at; a wrong one silently files an
 * annotation's history under its sibling, and nothing downstream can
 * detect it.
 */
import { describe, expect, it } from "vitest";

import type { AuditFinding } from "@/api/auditTypes";
import type { Design } from "@/features/experiment/types";

import { stampForFinding } from "./stamp";

const term = (label: string, uri = "") => ({ label, uri });

function design(over: Partial<Design> = {}): Design {
  return {
    factors: [],
    tags: [],
    biomaterials: [],
    ...over,
  } as unknown as Design;
}

function factor(
  id: number,
  category: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    name: category,
    category: term(category),
    description: "",
    type: "categorical",
    factor_values: [],
    ...extra,
  } as unknown as Design["factors"][number];
}

function tag(id: number, category: string, value: string, valueUri = "") {
  return {
    id,
    category: term(category, "http://purl.obolibrary.org/obo/CAT_1"),
    value: term(value, valueUri),
  } as unknown as Design["tags"][number];
}

function finding(over: Partial<AuditFinding> = {}): AuditFinding {
  return {
    target_kind: "factor",
    target_id: "factor:treatment",
    severity: "minor",
    issue_code: "calibration_factor_match_near",
    rationale: "",
    ...over,
  } as unknown as AuditFinding;
}

describe("stampForFinding", () => {
  it("records the Gemma id of the factor the finding is about", () => {
    const d = design({
      factors: [factor(3, "treatment", { gemma_factor_id: 13531 })],
    });
    expect(stampForFinding(finding(), d)).toEqual({ gemma_factor_id: 13531 });
  });

  // 🛑 The case the stamp exists for. Two `treatment` factors collapse
  // to one slug, so the server's derived key identifies both and it
  // correctly refuses to trace either. The `#{id}` discriminator says
  // which one the curator was looking at.
  it("resolves same-category siblings through the discriminator", () => {
    const d = design({
      factors: [
        factor(3, "treatment", { gemma_factor_id: 13531 }),
        factor(4, "treatment", { gemma_factor_id: 13532 }),
      ],
    });
    expect(
      stampForFinding(finding({ target_id: "factor:treatment#4" }), d),
    ).toEqual({ gemma_factor_id: 13532 });
  });

  // …and without the discriminator it must stay silent rather than
  // pick one. Stamping the first of two is how an annotation ends up
  // wearing its sibling's history.
  it("stamps nothing when two factors share the slug and nothing breaks the tie", () => {
    const d = design({
      factors: [
        factor(3, "treatment", { gemma_factor_id: 13531 }),
        factor(4, "treatment", { gemma_factor_id: 13532 }),
      ],
    });
    expect(stampForFinding(finding(), d)).toBeNull();
  });

  it("finds a factor named by its storage id", () => {
    const d = design({
      factors: [factor(9325, "genotype", { local_factor_id: "local-abc" })],
    });
    expect(
      stampForFinding(finding({ target_id: "factor:9325" }), d),
    ).toEqual({ local_factor_id: "local-abc" });
  });

  // A factor Gemma doesn't know and that predates local ids has no
  // durable identity to record. The slug the matcher derives is
  // already as good as anything we could send, so send nothing.
  it("stamps nothing for a factor carrying no durable identity", () => {
    const d = design({ factors: [factor(2, "treatment")] });
    expect(stampForFinding(finding(), d)).toBeNull();
  });

  it("records both URIs of the tag a finding is about", () => {
    const d = design({
      tags: [
        tag(7, "disease", "melanoma", "http://purl.obolibrary.org/obo/MONDO_1"),
      ],
    });
    expect(
      stampForFinding(
        finding({ target_kind: "tag", target_id: "tag:disease/melanoma" }),
        d,
      ),
    ).toEqual({
      category_uri: "http://purl.obolibrary.org/obo/CAT_1",
      value_uri: "http://purl.obolibrary.org/obo/MONDO_1",
    });
  });

  // An accepted `add_tag` puts the term in the draft, but the
  // disposition can be saved on a dismissal too — where the tag never
  // arrives. The finding still names the term, and "which term was
  // declined" is worth the same keeping.
  it("falls back to the term an add_tag finding names", () => {
    const f = finding({
      target_kind: "tag",
      target_id: "tag:cell-line/cgr8",
      apply_action: {
        kind: "add_tag",
        new_category: "cell line",
        new_value: "cgr8",
        new_value_uri: "http://www.ebi.ac.uk/efo/EFO_0006273",
      },
    });
    expect(stampForFinding(f, design())).toEqual({
      value_uri: "http://www.ebi.ac.uk/efo/EFO_0006273",
    });
  });

  // 🛑 `replace_tag` names the PROPOSED replacement, which is the right
  // identity after an accept and the wrong one after a dismissal. The
  // stamp must not depend on reading the outcome, so it declines.
  it("won't guess an identity from a replace_tag proposal", () => {
    const f = finding({
      target_kind: "tag",
      target_id: "tag:disease/melanoma",
      apply_action: {
        kind: "replace_tag",
        new_value: "cutaneous melanoma",
        new_value_uri: "http://purl.obolibrary.org/obo/MONDO_2",
      },
    });
    expect(stampForFinding(f, design())).toBeNull();
  });

  it("stamps nothing without a design, rather than throwing", () => {
    expect(stampForFinding(finding(), null)).toBeNull();
    expect(stampForFinding(null, design())).toBeNull();
  });

  // Calibration findings carry their own target_id shape
  // (`calibration:<status>:<category>/<value>`) that the standard
  // parser doesn't recognise. They fall through to the matcher, which
  // is correct-but-unstamped; pinned so the day someone teaches this
  // that shape, the change is deliberate.
  it("leaves a calibration target_id to the matcher", () => {
    const d = design({
      tags: [tag(7, "cell line", "cgr8", "http://www.ebi.ac.uk/efo/EFO_1")],
    });
    expect(
      stampForFinding(
        finding({
          target_kind: "tag",
          target_id: "calibration:agent_extra:cell line/cgr8",
        }),
        d,
      ),
    ).toBeNull();
  });
});
