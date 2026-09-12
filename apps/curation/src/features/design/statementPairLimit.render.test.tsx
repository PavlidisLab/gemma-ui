/**
 * @vitest-environment jsdom
 *
 * Gemma holds two (predicate, object) pairs per STATEMENT, not per
 * subject. Rows sharing a ``gemma_id`` are one statement's pairs; a row
 * with no id commits as its own statement, so a subject can carry any
 * number. Only a third row on one stored statement is over the ceiling,
 * and Gemma refuses it at preflight (``STATEMENT_ID_REPEATED``).
 *
 * The editor used to cap and warn per subject, which told a curator to
 * move or delete pairs Gemma would have kept.
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

/** One flat row: same category + subject, its own predicate/object.
 *  ``gemmaId`` marks it as a pair of that stored statement. */
function pair(
  predicate: string | null,
  object: string | null,
  gemmaId?: number,
): Statement {
  return {
    ...(gemmaId != null ? { gemma_id: gemmaId } : {}),
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

describe("statement pair limit — per statement, not per subject", () => {
  it("offers '+ pred/obj' on a subject that already holds two pairs", () => {
    const { onAddSiblingStatement } = renderEditable([
      pair("delivered at dose", "20 g/kg"),
      pair("delivered for duration", "2 week"),
    ]);
    const buttons = addPairButtons();
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => !b.hasAttribute("disabled"))).toBe(true);
    buttons[0].click();
    expect(onAddSiblingStatement).toHaveBeenCalled();
  });

  it("offers it on a stored two-pair statement too — the added row is its own", () => {
    renderEditable([
      pair("has role", "initial time point", 7),
      pair("delivered for duration", "30 min", 7),
    ]);
    expect(addPairButtons().every((b) => !b.hasAttribute("disabled"))).toBe(true);
  });

  it("🛑 marks nothing when three new pairs share a subject", () => {
    // GSE391's protein triplet: three id-less rows, three statements.
    renderEditable([
      pair("derives from", "Ccl20"),
      pair("delivered for duration", "30 min"),
      pair("has role", "initial time point"),
    ]);
    expect(screen.queryByText(/refuses a/i)).toBeNull();
    expect(screen.queryAllByTitle(/refuses a third/i)).toHaveLength(0);
  });

  it("marks the third pair on ONE stored statement, and only that one", () => {
    renderEditable([
      pair("delivered at dose", "20 g/kg", 7),
      pair("delivered for duration", "2 week", 7),
      pair("has role", "treatment", 7),
    ]);
    expect(screen.getByText(/refuses a/i)).toBeInTheDocument();
    expect(screen.getAllByTitle(/refuses a third/i)).toHaveLength(1);
  });

  it("does not count pairs of two different stored statements together", () => {
    renderEditable([
      pair("delivered at dose", "20 g/kg", 7),
      pair("delivered for duration", "2 week", 7),
      pair("has role", "treatment", 8),
    ]);
    expect(screen.queryAllByTitle(/refuses a third/i)).toHaveLength(0);
  });
});
