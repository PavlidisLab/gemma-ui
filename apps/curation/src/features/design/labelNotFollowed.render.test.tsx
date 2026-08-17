/**
 * @vitest-environment jsdom
 *
 * Editing a statement must not rewrite the factor value's label.
 *
 * `setStatement` used to sync `free_text_label` off the primary
 * subject whenever the label "looked auto-derived" — blank, or equal
 * to the old subject. The staleness it was hiding is real (an FV
 * relabelled only in its statement stays wrong in the Sample-details
 * factor cells and every FV dropdown, which read the label first), but
 * the cure wrote a field the curator owns off an edit to a different
 * field, on a guess about what they had meant.
 *
 * So the card states it. These tests pin WHEN it states it, because a
 * marker that fires on values that are perfectly fine is one curators
 * learn to skip past.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { FactorValue, OntologyTerm } from "@/features/experiment/types";
import type { FvChange } from "./diff";
import { FactorValueCard } from "./FactorValueCard";

const DISEASE: OntologyTerm = {
  label: "disease",
  uri: "http://www.ebi.ac.uk/efo/EFO_0000408",
};

function fv(label: string, subject: string): FactorValue {
  return {
    id: 1,
    free_text_label: label,
    is_baseline: false,
    biomaterial_short_names: ["s1"],
    statements: [{ category: DISEASE, subject: { label: subject, uri: null } }],
  };
}

/** A draft-vs-saved change record. `statements` true / `label` false is
 *  the case the marker exists for. */
function changed(fields: Partial<FvChange["fields"]>): FvChange {
  return {
    kind: "modified",
    factorId: 10,
    fvId: 1,
    fields: {
      label: false,
      baseline: false,
      statements: false,
      biomaterials: false,
      ...fields,
    },
  } as FvChange;
}

function renderCard(
  value: FactorValue,
  change: FvChange | null,
  onLabelChange = vi.fn(),
) {
  // The open card mounts CategoryPicker, which fetches the canonical
  // category list — the marker under test needs the open card, so the
  // query client comes along.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <FactorValueCard
        fv={value}
        factorCategory={DISEASE}
        change={change}
        onLabelChange={onLabelChange}
        onToggleBaseline={vi.fn()}
        onDelete={vi.fn()}
        onAddStatement={vi.fn()}
        onStatementChange={vi.fn()}
        onStatementDelete={vi.fn()}
        onRevert={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return onLabelChange;
}

describe("FactorValueCard — label not updated", () => {
  it("says so when the statement changed in this draft and the label didn't", () => {
    renderCard(
      fv("MDD", "major depressive disorder"),
      changed({ statements: true }),
    );
    expect(screen.getByText("label not updated")).toBeTruthy();
  });

  // The curator still decides — they just don't have to retype it.
  it("offers the subject as a one-click and does not apply it itself", () => {
    const onLabelChange = renderCard(
      fv("MDD", "major depressive disorder"),
      changed({ statements: true }),
    );
    expect(onLabelChange).not.toHaveBeenCalled();
    // By title, not by name: the statement row's own subject picker
    // carries the same words, so an accessible-name query matches two
    // controls that do very different things.
    screen
      .getByTitle('Set this value’s label to "major depressive disorder"')
      .click();
    expect(onLabelChange).toHaveBeenCalledWith("major depressive disorder");
  });

  // 🛑 A label that has always differed from its subject is a summary,
  // not a mistake. The marker keys on a change made in THIS draft, not
  // on label ≠ subject, or it would sit permanently on every
  // deliberately-worded value.
  it("stays quiet on an untouched value whose label differs by design", () => {
    renderCard(fv("Affected (MDD)", "major depressive disorder"), null);
    expect(screen.queryByText("label not updated")).toBeNull();
  });

  it("stays quiet when the curator relabelled alongside the statement", () => {
    renderCard(
      fv("major depressive disorder", "major depressive disorder"),
      changed({ statements: true, label: true }),
    );
    expect(screen.queryByText("label not updated")).toBeNull();
  });

  // A statement edit that moved a predicate or an object leaves the
  // subject — and so the label — perfectly current.
  it("stays quiet when the label already says what the subject says", () => {
    renderCard(
      fv("major depressive disorder", "major depressive disorder"),
      changed({ statements: true }),
    );
    expect(screen.queryByText("label not updated")).toBeNull();
  });

  it("stays quiet when only the sample assignment moved", () => {
    renderCard(
      fv("MDD", "major depressive disorder"),
      changed({ biomaterials: true }),
    );
    expect(screen.queryByText("label not updated")).toBeNull();
  });
});
