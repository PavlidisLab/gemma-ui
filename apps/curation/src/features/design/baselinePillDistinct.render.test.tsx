/**
 * @vitest-environment jsdom
 *
 * The MARKED baseline chip and the GEMMA-DETECTED one must not look
 * alike.
 *
 * A ``treatment`` factor can hold two levels Gemma's own detector
 * recognises — an "untreated / reference subject role" beside a
 * "sham / control" (GSE2437, experiment 245). Both wore the same filled
 * sky pill, separated only by ``opacity-70`` and a "(Gemma)" suffix, so
 * the factor read as having two baselines. Unmarking one then moved its
 * card down the list — ``FactorValueList`` sorts marked FVs first — and
 * left a chip that still looked marked, so the curator saw the rows
 * resort and concluded the mark could not be removed. Worse, clicking
 * the detected chip MARKS that FV (unmarking the other), so every
 * attempt to remove a baseline just swapped which one was filled.
 *
 * Fill is now the whole cue: filled = marked, hollow = not marked.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { FactorValue, OntologyTerm } from "@/features/experiment/types";
import { FactorValueCard } from "./FactorValueCard";

const TREATMENT: OntologyTerm = {
  label: "treatment",
  uri: "http://www.ebi.ac.uk/efo/EFO_0000727",
};

/** ``reference subject role`` — OBI:0000220 is in ``controlGroupUris``,
 *  so Gemma reads this level as the reference with nothing marked. */
const REFERENCE_SUBJECT_ROLE: OntologyTerm = {
  label: "reference subject role",
  uri: "http://purl.obolibrary.org/obo/OBI_0000220",
};

function fv(is_baseline: boolean): FactorValue {
  return {
    id: 1,
    free_text_label: "Untreated",
    is_baseline,
    biomaterial_short_names: ["s1"],
    statements: [{ category: TREATMENT, subject: REFERENCE_SUBJECT_ROLE }],
  };
}

function renderCard(
  value: FactorValue,
  onToggleBaseline = vi.fn(),
  siblingIsMarkedBaseline = false,
) {
  // The open card mounts CategoryPicker, which fetches the canonical
  // category list.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FactorValueCard
        fv={value}
        factorCategory={TREATMENT}
        change={null}
        onLabelChange={vi.fn()}
        onToggleBaseline={onToggleBaseline}
        onDelete={vi.fn()}
        onAddStatement={vi.fn()}
        onStatementChange={vi.fn()}
        onStatementDelete={vi.fn()}
        siblingIsMarkedBaseline={siblingIsMarkedBaseline}
      />
    </QueryClientProvider>,
  );
}

function chipClasses(text: string): string {
  const el = screen.getByText(text);
  return el.className;
}

describe("baseline chip — marked vs Gemma-detected are visually distinct", () => {
  it("a MARKED baseline wears the filled pill", () => {
    renderCard(fv(true));
    const cls = chipClasses("▂ baseline");
    expect(cls).toContain("pill");
    expect(cls).toContain("baseline");
    expect(cls).not.toContain("baseline-auto");
  });

  it("an UNMARKED but Gemma-detected level wears the hollow pill", () => {
    renderCard(fv(false));
    const cls = chipClasses("▂ baseline (Gemma)");
    expect(cls).toContain("pill");
    expect(cls).toContain("baseline-auto");
  });

  it("the two chips do not differ by opacity alone", () => {
    const { unmount } = renderCard(fv(true));
    const marked = chipClasses("▂ baseline");
    unmount();
    renderCard(fv(false));
    const auto = chipClasses("▂ baseline (Gemma)");
    expect(marked).not.toEqual(auto);
    // The old pair was `pill baseline` vs `pill baseline opacity-70`:
    // identical once opacity was stripped. The new pair is not.
    const strip = (c: string) =>
      c
        .split(/\s+/)
        .filter((t) => t && !t.startsWith("opacity-"))
        .sort()
        .join(" ");
    expect(strip(marked)).not.toEqual(strip(auto));
  });

  it("says the detected level is NOT marked, and what clicking does", () => {
    renderCard(fv(false));
    const button = screen.getByTitle(/not marked/i);
    expect(button.getAttribute("title")).toMatch(/click to mark it/i);
  });

  it("the marked chip's tooltip offers the unmark, not a restatement", () => {
    renderCard(fv(true));
    expect(screen.getByTitle(/click to unmark/i)).toBeTruthy();
  });
});

/**
 * Gemma resolves an explicit ``getIsBaseline()`` FIRST and only falls
 * through to ``BaselineSelection``'s term / URI matching when nothing is
 * marked (gemma backend, 2026-08-19). So while a sibling carries the
 * mark, a detected-but-unmarked level is NOT what the DEA will use, and
 * a card that says it is makes a false statement about the analysis.
 *
 * This is live on GSE2437: "Untreated" is marked, "Sham" is detected,
 * and the card used to tell the curator Sham was the reference.
 */
describe("baseline chip — a detected level yields to an explicit mark", () => {
  it("says the mark elsewhere wins, rather than claiming the DEA uses this", () => {
    renderCard(fv(false), vi.fn(), true);
    const button = screen.getByTitle(/another value here IS marked/i);
    expect(button.getAttribute("title")).toMatch(/explicit mark wins/i);
    expect(button.getAttribute("title")).not.toMatch(/already treats this/i);
  });

  // ``toggleBaseline`` no longer clears siblings, so the click ADDS a
  // second reference rather than moving the existing one. The copy said
  // "make this one the baseline instead" and "marking any value
  // overrides the rest" — both were true only while it did.
  it("promises to ADD a second mark, not to move the existing one", () => {
    renderCard(fv(false), vi.fn(), true);
    const title = screen.getByTitle(/another value here IS marked/i)
      .getAttribute("title")!;
    expect(title).toMatch(/marks this one too/i);
    expect(title).not.toMatch(/instead/i);
    expect(title).not.toMatch(/overrides the rest/i);
  });

  it("names the cost of a second reference — DEA needs a subset factor", () => {
    renderCard(fv(false), vi.fn(), true);
    expect(
      screen.getByTitle(/needs a subset factor for DEA/i),
    ).toBeTruthy();
  });

  it("marks the chip itself as overridden, not plain '(Gemma)'", () => {
    renderCard(fv(false), vi.fn(), true);
    expect(screen.getByText("▂ baseline (Gemma, overridden)")).toBeTruthy();
    expect(screen.queryByText("▂ baseline (Gemma)")).toBeNull();
  });

  it("still reads as not-marked — hollow, so the sibling owns the fill", () => {
    renderCard(fv(false), vi.fn(), true);
    expect(chipClasses("▂ baseline (Gemma, overridden)")).toContain(
      "baseline-auto",
    );
  });

  it("with NO sibling marked it keeps the plain claim, which is then true", () => {
    renderCard(fv(false), vi.fn(), false);
    expect(screen.getByText("▂ baseline (Gemma)")).toBeTruthy();
    expect(screen.getByTitle(/already treats this/i)).toBeTruthy();
  });
});
