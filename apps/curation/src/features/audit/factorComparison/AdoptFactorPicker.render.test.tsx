/**
 * @vitest-environment jsdom
 *
 * Render contract for the "Choose what to adopt" picker. The failure
 * this dialog exists to prevent is silent — a curator ticking a box
 * and the design not changing — so the tests assert that each box maps
 * to the pick the applier reads, and that the sample-level cost of a
 * regrouping is stated BEFORE the click, not discovered afterwards in
 * the validator banner.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Factor } from "@/features/experiment/types";
import type { FactorProposal } from "@/api/types";
import { AdoptFactorPicker } from "./AdoptFactorPicker";
import { buildFactorAdoptPlan } from "./adoptFactorPlan";

const MONDO_SCA2 = "http://purl.obolibrary.org/obo/MONDO_0008458";
const MONDO_SCA3 = "http://purl.obolibrary.org/obo/MONDO_0007182";
const MONDO_MJD = "http://purl.obolibrary.org/obo/MONDO_0017176";
const EFO_DISEASE = "http://www.ebi.ac.uk/efo/EFO_0000408";

function goldFactor(): Factor {
  return {
    id: 1,
    name: "disease",
    category: { label: "disease", uri: EFO_DISEASE },
    description: "",
    type: "categorical",
    factor_values: [
      {
        id: 10,
        free_text_label: "SCA2 fibroblast",
        is_baseline: false,
        biomaterial_short_names: ["S1", "S2"],
        statements: [{ subject: { label: "SCA2 fibroblast", uri: MONDO_SCA2 } }],
      },
      {
        id: 11,
        free_text_label: "Machado-Joseph disease",
        is_baseline: false,
        biomaterial_short_names: ["S3", "S4"],
        statements: [
          { subject: { label: "Machado-Joseph disease", uri: MONDO_MJD } },
        ],
      },
      {
        id: 13,
        free_text_label: "SCA2 PBMC",
        is_baseline: false,
        biomaterial_short_names: ["S5", "S6"],
        statements: [{ subject: { label: "SCA2 PBMC", uri: MONDO_SCA2 } }],
      },
    ],
  };
}

function agentFactor(): FactorProposal {
  return {
    category: { label: "genotype", uri: null },
    name_in_design: "genotype",
    factor_values: [
      {
        free_text_label: "SCA2",
        is_baseline: false,
        biomaterial_short_names: ["S1", "S2", "S5", "S6"],
        statements: [
          {
            category: null,
            subject: { label: "SCA2", uri: MONDO_SCA2 },
            predicate: null,
            object: null,
          },
        ],
      },
      {
        free_text_label: "SCA3",
        is_baseline: false,
        biomaterial_short_names: ["S3", "S4"],
        statements: [
          {
            category: null,
            subject: { label: "SCA3", uri: MONDO_SCA3 },
            predicate: null,
            object: null,
          },
        ],
      },
    ],
  } as FactorProposal;
}

function renderPicker() {
  const plan = buildFactorAdoptPlan(goldFactor(), agentFactor());
  const onChange = vi.fn();
  render(
    <AdoptFactorPicker
      plan={plan}
      onChange={onChange}
      proposerLabel="Auditor"
    />,
  );
  return { plan, onChange };
}

describe("AdoptFactorPicker", () => {
  it("offers one box per differing part, ticked by default", () => {
    renderPicker();
    const category = screen.getByLabelText(/Category/i, { selector: "input" });
    const grouping = screen.getByLabelText(/Grouping/i, { selector: "input" });
    expect(category).toBeChecked();
    expect(grouping).toBeChecked();
  });

  it("names the samples that change value before the curator commits", () => {
    renderPicker();
    expect(screen.getByText(/2 samples change value/)).toBeInTheDocument();
    expect(screen.getByText(/S5, S6/)).toBeInTheDocument();
  });

  it("unticking the grouping reports only that pick as off", () => {
    const { onChange } = renderPicker();
    fireEvent.click(screen.getByLabelText(/Grouping/i, { selector: "input" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0];
    expect(next.picks.partition).toBe(false);
    expect(next.picks.category).toBe(true);
  });

  it("warns in amber when a regrouping would strand samples", () => {
    const gold = goldFactor();
    const agent = agentFactor();
    // Agent drops the PBMC pair entirely.
    agent.factor_values[0] = {
      ...agent.factor_values[0],
      biomaterial_short_names: ["S1", "S2"],
    };
    render(
      <AdoptFactorPicker
        plan={buildFactorAdoptPlan(gold, agent)}
        onChange={vi.fn()}
        proposerLabel="Auditor"
      />,
    );
    expect(
      screen.getByText(/would be left\s+with no value on this factor/),
    ).toBeInTheDocument();
  });

  it("says what happens to a value only one side has", () => {
    renderPicker();
    expect(
      screen.getByText(/its samples move to the values above/i),
    ).toBeInTheDocument();
  });
});
