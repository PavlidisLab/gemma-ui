/**
 * @vitest-environment jsdom
 *
 * The compact view shows a statement's CATEGORY whether or not its
 * subject is shared with a sibling.
 *
 * `groupStatementsBySubject` buckets on (category, subject), and the
 * compact renderer branches on the bucket's SIZE: one row went to
 * `CompactStatementRow`, which leads with the category chip; two or
 * more went to `CompactStatementGroup`, which opened straight at the
 * subject and emitted no category at all.
 *
 * A compound statement always lands in the second branch — Gemma's
 * design read serves it FLATTENED, as two entries sharing one id
 * (#814), and both entries carry the same category and subject. So
 * every two-pair statement rendered without its category, and the
 * corpus is converging on that shape: 9,337 second pairs as of
 * 2026-09-09, up from 9,028 the week before.
 *
 * Reported on GSE188674 fv 381303, where `genotype` / `EFO_0000513`
 * is on the wire on BOTH halves —
 * `AbstractFactorValueValueObjectSerializer` emits it unconditionally
 * on the first-pair and second-pair calls, so nothing upstream drops
 * it.
 *
 * 🛑 The trigger is the group, not the second pair. Two SEPARATE
 * statements on one subject (`Srsf1 - has_genotype - WT`,
 * `Srsf1 - has_genotype - KO`) take the same branch and lost the chip
 * the same way, with no compound statement involved.
 *
 * Why it is worth a test rather than a glance: a statement rendering
 * with no category reads as one whose category is MISSING, which is a
 * curator's cue to go and fix data that is already correct.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type {
  FactorValue,
  OntologyTerm,
  Statement,
} from "@/features/experiment/types";
import { FactorValueCard } from "./FactorValueCard";

const GENOTYPE: OntologyTerm = {
  label: "genotype",
  uri: "http://www.ebi.ac.uk/efo/EFO_0000513",
};
const SPTLC2: OntologyTerm = {
  label: "Sptlc2 serine palmitoyltransferase, long chain base subunit 2",
  uri: null,
};

/** One flat row — the shape the draft keeps: same category + subject,
 *  its own predicate/object. Two of these sharing an id are the two
 *  halves of one compound statement. */
function pair(predicate: string, object: string): Statement {
  return {
    category: GENOTYPE,
    subject: SPTLC2,
    predicate: { label: predicate, uri: null },
    object: { label: object, uri: null },
  };
}

function renderCompact(statements: Statement[]) {
  const fv: FactorValue = {
    id: 381303,
    free_text_label: "Homozygous negative Sptlc2",
    is_baseline: false,
    biomaterial_short_names: ["s1", "s2", "s3", "s4"],
    statements,
  };
  render(
    <FactorValueCard
      fv={fv}
      factorCategory={GENOTYPE}
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

describe("compact view — a grouped statement keeps its category", () => {
  it("shows the category on a single-pair statement", () => {
    // The branch that always worked, pinned so a fix to the other one
    // cannot be a swap.
    renderCompact([pair("has_genotype", "Homozygous negative")]);
    expect(screen.getAllByText("genotype").length).toBeGreaterThan(0);
  });

  it("shows the category on a TWO-PAIR (compound) statement", () => {
    renderCompact([
      pair("has_genotype", "Homozygous negative"),
      pair("has background", "C57BL/6"),
    ]);
    expect(screen.getAllByText("genotype").length).toBeGreaterThan(0);
    // Both pairs still render — the chip is added, nothing is replaced.
    expect(screen.getByText("Homozygous negative")).toBeTruthy();
    expect(screen.getByText("C57BL/6")).toBeTruthy();
  });

  it("shows the category when two SEPARATE statements share a subject", () => {
    // No compound statement here at all; the group is what triggers it.
    renderCompact([
      pair("has_genotype", "wild type"),
      pair("has_genotype", "knockout"),
    ]);
    expect(screen.getAllByText("genotype").length).toBeGreaterThan(0);
  });
});
