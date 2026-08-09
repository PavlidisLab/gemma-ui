import { describe, expect, it } from "vitest";
import {
  adoptNearMatchAgentFactor,
  resolveAdoptTargetFactor,
} from "./mutations";
import type { Design, Factor } from "@/features/experiment/types";
import type { FactorProposal } from "@/api/types";

/**
 * GSE11630 (experiment 1658), reported 2026-08-09: the curator opened
 * the `cell line` near-match card, clicked "Proposal is better", the
 * disposition recorded — and the factor never changed.
 *
 * The adopt mutator looked its target up by the AGENT's category
 * (`individual` / EFO:0000542) against a draft whose factor is called
 * `cell line` (CLO:0000031). Nothing matched, `find` returned
 * undefined, and the mutator returned the design unchanged. On a
 * rename the two sides differ by definition, so that lookup could
 * never succeed for the one case the card exists to serve.
 *
 * Resolution is now CURRENT-side first (the finding's gold factor id,
 * then the category the card displays on its left), agent-side last.
 */

const CELL_LINE_URI = "http://purl.obolibrary.org/obo/CLO_0000031";
const INDIVIDUAL_URI = "http://www.ebi.ac.uk/efo/EFO_0000542";

const goldFactor = (): Factor => ({
  id: 90000000,
  name: "cell line",
  category: { label: "cell line", uri: CELL_LINE_URI },
  description: "H511, H465, H510, H421 cells",
  type: "categorical",
  factor_values: [
    {
      id: 1,
      free_text_label: "immortal human lung-derived cell line cell with H511",
      is_baseline: false,
      statements: [],
      biomaterial_short_names: ["S1", "S2"],
    },
    {
      id: 2,
      free_text_label: "immortal human lung-derived cell line cell with H465",
      is_baseline: false,
      statements: [],
      biomaterial_short_names: ["S3", "S4"],
    },
  ],
});

const design = (): Design => ({
  experiment_id: 1658,
  experiment_short_name: "GSE11630",
  factors: [
    goldFactor(),
    {
      id: 90000001,
      name: "timepoint",
      category: { label: "timepoint", uri: null },
      description: "",
      type: "categorical",
      factor_values: [],
    },
  ],
  biomaterials: [],
  tags: [],
});

const agentProposal = (): FactorProposal =>
  ({
    proposal_factor_id: "p1",
    name_in_design: "individual",
    category: { label: "individual", uri: INDIVIDUAL_URI },
    factor_values: [
      {
        free_text_label: "H511",
        is_baseline: false,
        statements: [],
        biomaterial_short_names: ["S1", "S2"],
      },
      {
        free_text_label: "H465",
        is_baseline: false,
        statements: [],
        biomaterial_short_names: ["S3", "S4"],
      },
    ],
  }) as unknown as FactorProposal;

/** What the card passes: the finding's gold factor id + the category
 *  rendered in the CURRENT column. */
const HINT = {
  factorId: 90000000,
  categoryLabel: "cell line",
  categoryUri: CELL_LINE_URI,
};

describe("resolveAdoptTargetFactor", () => {
  it("finds the renamed factor by the CURRENT side, not the agent's", () => {
    const hit = resolveAdoptTargetFactor(design(), agentProposal(), HINT);
    expect(hit?.id).toBe(90000000);
  });

  it("still resolves when the id doesn't line up with the draft", () => {
    // The chip strip may display a curation whose ids differ from the
    // writable draft — the reason the id-only path was dropped in the
    // first place. Category then carries it.
    const hit = resolveAdoptTargetFactor(design(), agentProposal(), {
      ...HINT,
      factorId: 4, // gold polished's id for this factor
    });
    expect(hit?.id).toBe(90000000);
  });

  it("falls back to the agent's category when no hint is supplied", () => {
    // Old findings carry no rename payload; the pre-fix behaviour has
    // to keep working for the case where both sides agree.
    const agreed = design();
    agreed.factors[0].category = { label: "individual", uri: INDIVIDUAL_URI };
    expect(resolveAdoptTargetFactor(agreed, agentProposal())?.id).toBe(
      90000000,
    );
  });

  it("resolves nothing when the factor genuinely isn't there", () => {
    const empty: Design = { ...design(), factors: [] };
    expect(resolveAdoptTargetFactor(empty, agentProposal(), HINT)).toBeUndefined();
  });
});

describe("adoptNearMatchAgentFactor — the GSE11630 rename", () => {
  it("renames the existing factor instead of silently doing nothing", () => {
    const next = adoptNearMatchAgentFactor(design(), agentProposal(), HINT);
    const f = next.factors.find((x) => x.id === 90000000);
    expect(f?.category.label).toBe("individual");
    expect(f?.category.uri).toBe(INDIVIDUAL_URI);
    expect(f?.name).toBe("individual");
  });

  it("keeps the factor's identity and partition", () => {
    const next = adoptNearMatchAgentFactor(design(), agentProposal(), HINT);
    const f = next.factors.find((x) => x.id === 90000000)!;
    expect(f.factor_values.map((fv) => fv.id)).toEqual([1, 2]);
    expect(f.factor_values.map((fv) => fv.biomaterial_short_names)).toEqual([
      ["S1", "S2"],
      ["S3", "S4"],
    ]);
    expect(f.factor_values.map((fv) => fv.free_text_label)).toEqual([
      "H511",
      "H465",
    ]);
    // Untouched siblings stay untouched.
    expect(next.factors.find((x) => x.id === 90000001)?.category.label).toBe(
      "timepoint",
    );
  });

  it("reproduces the bug when the hint is withheld", () => {
    // Pin the old behaviour as the regression: without a current-side
    // hint the agent-only lookup can't find `cell line`, and the
    // design comes back untouched. This is what the curator saw.
    const before = design();
    const after = adoptNearMatchAgentFactor(before, agentProposal());
    expect(after.factors[0].category.label).toBe("cell line");
  });
});
