/**
 * @vitest-environment jsdom
 *
 * "e.g. …" example-usage tooltip (2026-07-29) — see
 * ANNOTATION_SEARCH_EXAMPLE_CONTEXT_HANDOFF_2026_07_29.md. Started as
 * a separate visible line under the row (too little information for
 * the space it took); folded into the row's existing tooltip instead
 * — but even then it didn't say whether the example was a tag or a
 * factor value, which Paul called out as the single most useful fact
 * ("tag? fv?"). So this checks the consolidated `title` attribute
 * leads with that distinction via `levelLabel()`. Only for rare terms
 * (usage_count in 1..RARE_USAGE_THRESHOLD); the full S · P · O triple
 * appears when the example came from a Statement.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

let candidates: unknown[] = [];
vi.mock("@/api/annotations", () => ({
  useAnnotationSearch: () => ({ data: candidates, isFetching: false }),
}));
vi.mock("@/api/findTerm", () => ({
  useFindTerm: () => ({
    data: undefined,
    isPending: false,
    mutate: vi.fn(),
    reset: vi.fn(),
  }),
}));
vi.mock("@/lib/gemmaMode", () => ({
  useGemmaMode: () => ({ ontologyHost: "", ontologySplit: false }),
}));
vi.mock("@/features/comparison/FlowContext", () => ({
  useIsReadOnly: () => false,
}));

import { OntologyTermPicker } from "./OntologyTermPicker";

function open() {
  render(
    <OntologyTermPicker
      value={null}
      category="genotype"
      onCommit={vi.fn()}
      autoOpen
    />,
  );
}

/** The row's tooltip lives on the `<li>` — find it by its visible
 *  label text and walk up to the row. */
function rowTooltip(label: string): string | null {
  return screen.getByText(label).closest("li")?.getAttribute("title") ?? null;
}

describe("OntologyTermPicker — example-usage tooltip", () => {
  it("includes the S · P · O triple in the tooltip for a rare, statement-backed candidate", () => {
    candidates = [
      {
        label: "knockout",
        uri: "http://gemma.msl.ubc.ca/ont/TGEMO_0001",
        category_label: "genotype",
        category_uri: null,
        usage_count: 2,
        example_usage: {
          level: "FactorValue",
          parent_name: "Atg9a knockout",
          parent_of_parent_name: "genotype",
          predicate: "has_genotype",
          predicate_uri: "http://purl.obolibrary.org/obo/RO_0002200",
          object: "Atg9a",
          object_uri: null,
          second_predicate: null,
          second_predicate_uri: null,
          second_object: null,
          second_object_uri: null,
          source_experiment_id: 12345,
        },
      },
    ];
    open();
    const title = rowTooltip("knockout");
    expect(title).toContain("e.g. factor value (genotype)");
    expect(title).toContain("knockout · has_genotype · Atg9a");
    // Bare internal numeric id isn't actionable in plain tooltip text
    // (no accession, no link) — Paul 2026-07-29: "dataset id isn't
    // useful". Dropped from the tooltip; source_experiment_id is
    // still on the wire type for a future clickable link.
    expect(title).not.toContain("dataset #");
  });

  it("omits the example line for a common term even when one is attached", () => {
    candidates = [
      {
        label: "wild type",
        uri: "http://gemma.msl.ubc.ca/ont/TGEMO_0002",
        category_label: "genotype",
        category_uri: null,
        usage_count: 400,
        example_usage: {
          level: "FactorValue",
          parent_name: "wild type",
          parent_of_parent_name: "genotype",
          predicate: null,
          predicate_uri: null,
          object: null,
          object_uri: null,
          second_predicate: null,
          second_predicate_uri: null,
          second_object: null,
          second_object_uri: null,
          source_experiment_id: 999,
        },
      },
    ];
    open();
    const title = rowTooltip("wild type");
    expect(title).not.toContain("e.g.");
    expect(title).toContain("used in 400 places in Gemma");
  });

  it("skips the redundant parent-name echo when parent_name == the candidate's own label", () => {
    // Real shape confirmed against live frink 2026-07-29: for a
    // single-characteristic FV, `parent_name` is just the candidate's
    // own label again — repeating it would add nothing. Only the
    // factor context and dataset should show.
    candidates = [
      {
        label: "vascular endothelial growth factor",
        uri: "http://www.ebi.ac.uk/efo/EFO_0003276",
        category_label: "treatment",
        category_uri: null,
        usage_count: 1,
        example_usage: {
          level: "ExperimentalDesign",
          parent_name: "vascular endothelial growth factor",
          parent_of_parent_name: "treatment",
          predicate: null,
          predicate_uri: null,
          object: null,
          object_uri: null,
          second_predicate: null,
          second_predicate_uri: null,
          second_object: null,
          second_object_uri: null,
          source_experiment_id: 40100,
        },
      },
    ];
    open();
    const title = rowTooltip("vascular endothelial growth factor");
    // level "ExperimentalDesign" (the raw value live frink actually
    // sends for FV-shaped hits, not the documented "FactorValue") —
    // levelLabel() maps both to "factor value".
    expect(title).toContain("e.g. factor value (treatment)");
    expect(title).not.toContain("FV:");
    expect(title).not.toContain("dataset #");
  });

  it("labels a tag-level example as \"tag\", not \"factor value\"", () => {
    candidates = [
      {
        label: "C57BL/6",
        uri: "http://www.ebi.ac.uk/efo/EFO_0022397",
        category_label: "strain",
        category_uri: null,
        usage_count: 3,
        example_usage: {
          level: "ExperimentTag",
          parent_name: "C57BL/6",
          parent_of_parent_name: "strain",
          predicate: null,
          predicate_uri: null,
          object: null,
          object_uri: null,
          second_predicate: null,
          second_predicate_uri: null,
          second_object: null,
          second_object_uri: null,
          source_experiment_id: 1452,
        },
      },
    ];
    open();
    const title = rowTooltip("C57BL/6");
    expect(title).toContain("e.g. tag (strain)");
    expect(title).not.toContain("factor value");
    expect(title).not.toContain("dataset #");
  });

  it("still includes the S · P · O triple when parent_name echoes the label but a statement is attached", () => {
    candidates = [
      {
        label: "microvascular endothelial cell",
        uri: "http://purl.obolibrary.org/obo/CL_2000008",
        category_label: "cell type",
        category_uri: null,
        usage_count: 2,
        example_usage: {
          level: "ExperimentalDesign",
          parent_name: "microvascular endothelial cell",
          parent_of_parent_name: "cell type",
          predicate: "located in",
          predicate_uri: "http://purl.obolibrary.org/obo/RO_0001025",
          object: "heart",
          object_uri: "http://purl.obolibrary.org/obo/UBERON_0000948",
          second_predicate: null,
          second_predicate_uri: null,
          second_object: null,
          second_object_uri: null,
          source_experiment_id: 956,
        },
      },
    ];
    open();
    const title = rowTooltip("microvascular endothelial cell");
    expect(title).toContain("e.g. factor value (cell type)");
    expect(title).toContain(
      "microvascular endothelial cell · located in · heart",
    );
    expect(title).not.toContain("dataset #");
  });

  it("omits the example line when the candidate has no example usage", () => {
    candidates = [
      {
        label: "diabetes",
        uri: "http://purl.obolibrary.org/obo/MONDO_0005015",
        category_label: "disease",
        category_uri: null,
        usage_count: 1,
        example_usage: null,
      },
    ];
    open();
    const title = rowTooltip("diabetes");
    expect(title).not.toContain("e.g.");
    expect(title).toContain("used in 1 place in Gemma");
  });
});
