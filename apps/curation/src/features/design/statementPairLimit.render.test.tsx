/**
 * @vitest-environment jsdom
 *
 * A subject carries at most two (predicate, object) pairs — Gemma's
 * wire model has ``predicate``/``object`` and ``secondPredicate``/
 * ``secondObject`` and no third slot.
 *
 * The UI stores statements FLAT (one row per pair, sharing category +
 * subject) and regroups them at render time, so nothing in its own
 * shape enforced the ceiling: "+ pred/obj" stacked a third, fourth,
 * fifth pair happily. Four experiments in the store already carry
 * groups over the limit, one with six pairs on a single subject.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { FactorValue, OntologyTerm, Statement } from "@/features/experiment/types";
import { FactorValueCard } from "./FactorValueCard";

const TREATMENT: OntologyTerm = {
  label: "treatment",
  uri: "http://www.ebi.ac.uk/efo/EFO_0000727",
};
const SUBJECT: OntologyTerm = {
  label: "valproic acid",
  uri: "http://purl.obolibrary.org/obo/CHEBI_39867",
};

/** One flat row: same category + subject, its own predicate/object. */
function pair(predicate: string | null, object: string | null): Statement {
  return {
    category: TREATMENT,
    subject: SUBJECT,
    predicate: predicate ? { label: predicate, uri: null } : null,
    object: object ? { label: object, uri: null } : null,
  };
}

function renderEditable(statements: Statement[]) {
  const fv: FactorValue = {
    id: 1,
    free_text_label: "valproic acid",
    is_baseline: false,
    biomaterial_short_names: ["s1"],
    statements,
  };
  const onAddSiblingStatement = vi.fn();
  // The editable view mounts CategoryPicker / OntologyTermPicker, both
  // of which query — the compact view doesn't, which is why the sibling
  // render tests get away without a client.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <FactorValueCard
        fv={fv}
        factorCategory={TREATMENT}
        change={null}
        onLabelChange={vi.fn()}
        onToggleBaseline={vi.fn()}
        onDelete={vi.fn()}
        onAddStatement={vi.fn()}
        onStatementChange={vi.fn()}
        onStatementDelete={vi.fn()}
        onAddSiblingStatement={onAddSiblingStatement}
        onRevert={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { onAddSiblingStatement };
}

/** The add-a-pair buttons, by their label. Selecting on the title
 *  instead catches the per-pair "remove this predicate/object pair"
 *  delete button as well, which is always enabled — the first version
 *  of this test passed against a still-broken cap for that reason. */
const addPairButtons = () => screen.getAllByText("+ pred/obj");

describe("statement pair limit — '+ pred/obj'", () => {
  it("is offered on a subject holding one pair", () => {
    renderEditable([pair("delivered at dose", "20 g/kg")]);
    const buttons = addPairButtons();
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => !b.hasAttribute("disabled"))).toBe(true);
  });

  it("is disabled once the subject holds two", () => {
    renderEditable([
      pair("delivered at dose", "20 g/kg"),
      pair("delivered for duration", "2 week"),
    ]);
    const buttons = addPairButtons();
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => b.hasAttribute("disabled"))).toBe(true);
  });

  it("says WHY rather than vanishing", () => {
    // A curator hunting for the affordance should learn the ceiling
    // exists; a button that silently disappears reads as a bug.
    renderEditable([
      pair("delivered at dose", "20 g/kg"),
      pair("delivered for duration", "2 week"),
    ]);
    expect(
      screen.getAllByTitle(/at most 2 predicate\/object pairs/i).length,
    ).toBeGreaterThan(0);
  });

  it("counts an unfilled row as a slot already claimed", () => {
    // One real pair plus the blank row "+ pred/obj" just added. Counting
    // only filled rows would leave the button live, letting a curator
    // stack blanks past the ceiling and fill them in afterwards — the
    // same third pair by a slower route.
    renderEditable([pair("delivered at dose", "20 g/kg"), pair(null, null)]);
    const buttons = addPairButtons();
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => b.hasAttribute("disabled"))).toBe(true);
  });

  it("does not fire the add handler when disabled", () => {
    const { onAddSiblingStatement } = renderEditable([
      pair("delivered at dose", "20 g/kg"),
      pair("delivered for duration", "2 week"),
    ]);
    for (const b of addPairButtons()) b.click();
    expect(onAddSiblingStatement).not.toHaveBeenCalled();
  });
});
