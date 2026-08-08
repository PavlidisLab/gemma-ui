/**
 * @vitest-environment jsdom
 *
 * Compact ("collapse") view of a FactorValueCard must always show the
 * statement's SUBJECT LABEL.
 *
 * It used to drop the label to a bare CURIE whenever the FV header
 * already carried the same string, to avoid printing it twice. That lost
 * two things: a free-text subject has no CURIE, so the row collapsed to
 * just the category chip and an ungrounded term looked like a rendering
 * glitch; and a grounded subject rendered as an unlabelled ``CL:0002322``
 * beside a category chip that kept label + CURIE, reading as though a
 * label were missing. Reported on GSE11523 / experiment 2427.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { FactorValue, OntologyTerm } from "@/features/experiment/types";
import { FactorValueCard } from "./FactorValueCard";

const CELL_TYPE: OntologyTerm = {
  label: "cell type",
  uri: "http://www.ebi.ac.uk/efo/EFO_0000324",
};

function fvWithSubject(subject: OntologyTerm, label: string): FactorValue {
  return {
    id: 1,
    free_text_label: label,
    is_baseline: false,
    biomaterial_short_names: ["s1"],
    statements: [{ category: CELL_TYPE, subject }],
  };
}

function renderCompact(fv: FactorValue) {
  return render(
    <FactorValueCard
      fv={fv}
      factorCategory={CELL_TYPE}
      change={null}
      compact
      onLabelChange={vi.fn()}
      onToggleBaseline={vi.fn()}
      onDelete={vi.fn()}
      onAddStatement={vi.fn()}
      onStatementChange={vi.fn()}
      onStatementDelete={vi.fn()}
      onRevert={vi.fn()}
    />,
  );
}

describe("FactorValueCard — compact view keeps the subject label", () => {
  it("shows a GROUNDED subject's label, not just its CURIE", () => {
    renderCompact(
      fvWithSubject(
        {
          label: "embryonic stem cell",
          uri: "http://purl.obolibrary.org/obo/CL_0002322",
        },
        "embryonic stem cell",
      ),
    );
    // Twice: once as the FV header name, once as the statement subject.
    // The point of the fix is that the statement row is not label-less.
    expect(screen.getAllByText("embryonic stem cell").length).toBeGreaterThan(1);
  });

  it("shows a FREE-TEXT subject, which has no CURIE to fall back on", () => {
    renderCompact(
      fvWithSubject({ label: "Batch_02_1/9/08", uri: null }, "Batch_02_1/9/08"),
    );
    expect(screen.getAllByText("Batch_02_1/9/08").length).toBeGreaterThan(1);
  });

  it("shows the subject even when the FV has no free-text label of its own", () => {
    // Header derives its name from the subject in this case, which was
    // the other branch that suppressed the row's label.
    renderCompact(
      fvWithSubject(
        { label: "ZHBTc4-mESC", uri: "http://www.ebi.ac.uk/efo/EFO_0005914" },
        "",
      ),
    );
    expect(screen.getAllByText("ZHBTc4-mESC").length).toBeGreaterThan(1);
  });

  it("still renders the category chip alongside", () => {
    renderCompact(
      fvWithSubject({ label: "stem cell", uri: null }, "stem cell"),
    );
    expect(screen.getByText("cell type")).toBeTruthy();
  });
});
