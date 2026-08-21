/**
 * @vitest-environment jsdom
 *
 * A free-text factor value must be EDITABLE where it is shown.
 *
 * An FV with no statements is not an empty value — it IS its label, and
 * the card renders that label as a value row (category chip, then the
 * value) so it reads like its grounded siblings rather than like a value
 * that lost its term. But the row was rendered read-only in the OPEN
 * editor too, in the exact slot where a grounded sibling puts an
 * editable term picker. Double-clicking it selected a word and did
 * nothing else.
 *
 * Reported on GSE64959 / experiment 9859, where all 14 `organism part`
 * values are free text, so the whole factor looked uneditable. The FV
 * header's label editor was the only way in and does not look like the
 * thing the curator is trying to change.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { FactorValue, OntologyTerm } from "@/features/experiment/types";
import { FactorValueCard } from "./FactorValueCard";

const ORGANISM_PART: OntologyTerm = {
  label: "organism part",
  uri: "http://www.ebi.ac.uk/efo/EFO_0000635",
};

const VALUE = "cortical collecting duct, ureteric tip";

function freeTextFv(): FactorValue {
  return {
    id: 1,
    free_text_label: VALUE,
    is_baseline: false,
    biomaterial_short_names: ["s1", "s2", "s3"],
    statements: [],
  };
}

function renderCard(opts: { compact?: boolean; onLabelChange?: () => void }) {
  const onLabelChange = opts.onLabelChange ?? vi.fn();
  const view = render(
    <FactorValueCard
      fv={freeTextFv()}
      factorCategory={ORGANISM_PART}
      change={null}
      compact={opts.compact}
      onLabelChange={onLabelChange}
      onToggleBaseline={vi.fn()}
      onDelete={vi.fn()}
      onAddStatement={vi.fn()}
      onStatementChange={vi.fn()}
      onStatementDelete={vi.fn()}
      onRevert={vi.fn()}
    />,
  );
  return { ...view, onLabelChange };
}

/** The value row's copy of the label — the header carries the other. */
function valueRowCell() {
  const cells = screen.getAllByText(VALUE);
  expect(cells.length).toBeGreaterThan(1);
  return cells[cells.length - 1];
}

describe("a free-text factor value is editable where it is shown", () => {
  it("opens an input when the value row is double-clicked", () => {
    renderCard({});
    fireEvent.doubleClick(valueRowCell());
    const input = screen.getByDisplayValue(VALUE);
    expect(input).toBeInTheDocument();
  });

  it("commits the typed value through the card's label handler", () => {
    const onLabelChange = vi.fn();
    renderCard({ onLabelChange });
    fireEvent.doubleClick(valueRowCell());
    const input = screen.getByDisplayValue(VALUE);
    fireEvent.change(input, { target: { value: "ureteric tip" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onLabelChange).toHaveBeenCalledWith("ureteric tip");
  });

  it("stays read-only in the compact view", () => {
    // Compact is a reading surface — the open editor is where values
    // change, and an inline input there would be chrome nobody asked
    // for.
    renderCard({ compact: true });
    fireEvent.doubleClick(valueRowCell());
    expect(screen.queryByDisplayValue(VALUE)).not.toBeInTheDocument();
  });
});
