/**
 * @vitest-environment jsdom
 *
 * Getting RID of a predicate / object has to be visible.
 *
 * The empty ``<option>`` on the predicate dropdown always cleared the
 * predicate and its object — but it was labelled "predicate" in both
 * states, so it read as a placeholder and nothing else. A curator
 * holding a wrong pair could see no way out but the statement-level
 * delete, which throws away the subject too (Paul, 2026-08-20: "it's
 * not obvious enough how to get rid of an object or a predicate").
 *
 * The same review found the statement delete itself confusing — a bare
 * "×" between the predicate dropdown and "+ pred/obj" reads as
 * "remove the pair", which is not what it does.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type {
  FactorValue,
  OntologyTerm,
  Statement,
} from "@/features/experiment/types";
import { FactorValueCard } from "./FactorValueCard";

const TREATMENT: OntologyTerm = {
  label: "treatment",
  uri: "http://www.ebi.ac.uk/efo/EFO_0000727",
};
const SUBJECT: OntologyTerm = {
  label: "valproic acid",
  uri: "http://purl.obolibrary.org/obo/CHEBI_39867",
};

function stmt(predicate: string | null, object: string | null): Statement {
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
  const onStatementChange = vi.fn();
  const onStatementDelete = vi.fn();
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
        onStatementChange={onStatementChange}
        onStatementDelete={onStatementDelete}
        onAddSiblingStatement={vi.fn()}
        onRevert={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { onStatementChange, onStatementDelete };
}

describe("removing a predicate", () => {
  it("offers an explicit 'none' once a predicate is set", () => {
    renderEditable([stmt("delivered at dose", "20 g/kg")]);
    expect(screen.getAllByText(/none/i).length).toBeGreaterThan(0);
  });

  it("stays a plain placeholder while no predicate is set", () => {
    // Nothing to remove yet — offering "none" there would be noise, and
    // the slot still has to read as "fill me in".
    renderEditable([stmt(null, null)]);
    expect(screen.queryByText(/— none/i)).toBeNull();
    expect(screen.getAllByText("predicate").length).toBeGreaterThan(0);
  });

  it("names what it takes with it — the whole clause", () => {
    // Clearing the predicate but keeping the object would leave the
    // object attached to nothing, which the wire has no shape for. The
    // option says so rather than surprising the curator.
    //
    // "Clause" rather than "object" since 2026-08-20: the handler
    // clears BOTH, so naming only the object undersold it.
    renderEditable([stmt("delivered at dose", "20 g/kg")]);
    expect(screen.getAllByText(/removes this clause/i).length).toBeGreaterThan(0);
  });

  it("🛑 keeps the word 'predicate' in the empty option once one is set", () => {
    // Paul, 2026-08-20: "select 'predicate' i.e no predicate". The
    // empty option has to stay recognisably THE empty one — labelling
    // it with the consequence alone ("none (removes object)") made it
    // read as a different, unrelated entry rather than the placeholder
    // the curator already knows.
    renderEditable([stmt("delivered at dose", "20 g/kg")]);
    expect(
      screen.getAllByText(/^predicate\b.*none/i).length,
    ).toBeGreaterThan(0);
  });
});

describe("the statement-level delete", () => {
  it("says what it deletes instead of showing a bare ×", () => {
    renderEditable([stmt("delivered at dose", "20 g/kg")]);
    const button = screen.getByLabelText("delete statement");
    expect(button.textContent).toContain("statement");
  });

  it("points at the predicate's 'none' for the smaller edit", () => {
    renderEditable([stmt("delivered at dose", "20 g/kg")]);
    const button = screen.getByLabelText("delete statement");
    expect(button.getAttribute("title")).toMatch(/subject, predicate and object/i);
    expect(button.getAttribute("title")).toMatch(/none/i);
  });
});

/**
 * An ungrounded predicate is not the same as an off-list one.
 *
 * GSE152448 ships `has_genotype` and `has modifier` label-only, with no
 * URI. Both ARE presets (GENO_0000222, RO_0002573) — the URI-keyed
 * lookup just misses. Calling that "not a preset" sent the curator
 * hunting for a replacement for the predicate that was already right;
 * the fix is to pick the same name from the list.
 */
describe("a predicate the URI lookup can't match", () => {
  function ungrounded(label: string): Statement {
    return {
      category: { label: "genotype", uri: null },
      subject: { label: "KDM6A", uri: null },
      predicate: { label, uri: null },
      object: { label: "Homozygous negative", uri: null },
    };
  }

  it("shows the predicate instead of claiming there is none", () => {
    // It used to fall through to the empty option, which reads
    // "none (removes object)" — denying a predicate that is there, from
    // a control whose text says choosing it deletes the object.
    renderEditable([ungrounded("has_genotype")]);
    expect(screen.getAllByText(/has_genotype/).length).toBeGreaterThan(0);
  });

  it("calls a preset arriving without its URI 'not grounded'", () => {
    renderEditable([ungrounded("has_genotype")]);
    expect(screen.getAllByText(/not grounded/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/not a preset/i)).toBeNull();
  });

  it("calls a genuinely off-list label 'not a preset'", () => {
    renderEditable([ungrounded("wibbles at")]);
    expect(screen.getAllByText(/not a preset/i).length).toBeGreaterThan(0);
  });

  it("matches the preset case-insensitively", () => {
    renderEditable([ungrounded("Has Modifier")]);
    expect(screen.getAllByText(/not grounded/i).length).toBeGreaterThan(0);
  });
});
