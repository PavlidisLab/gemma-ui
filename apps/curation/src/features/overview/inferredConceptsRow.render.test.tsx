/**
 * @vitest-environment jsdom
 *
 * The inferred row: what it shows, and what it must never claim.
 *
 * Two rules from the relation contract are pinned here because both are
 * easy to get wrong and neither fails loudly:
 *
 *  1. Render the IMPLIED triple, never the stored one. The stored row
 *     reads `breast cancer --has_genotype--> BRCA1`; the claim is the
 *     reverse. Inverting it yourself points the arrow the wrong way.
 *  2. Say the list is approximate. The server bars broad subjects to
 *     kill ChEBI role closures and drops true relations with them, so
 *     the tooltip has to admit it (Paul, 2026-08-27).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  InferredConceptsRow,
  InferredConceptsRowBody,
  SHOW_INFERRED_CONCEPTS,
} from "./InferredConceptsRow";

const rows = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock("@/api/termRelations", async (orig) => {
  const actual = await orig<typeof import("@/api/termRelations")>();
  return {
    ...actual,
    useDatasetInferredConcepts: () => ({ data: rows.current, isLoading: false }),
  };
});

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <InferredConceptsRowBody experimentId={3333} />
    </QueryClientProvider>,
  );
}

const row = (over: Record<string, unknown> = {}) => ({
  subject: "breast cancer",
  predicate: "has_genotype",
  object: "BRCA1 [human] breast cancer 1, early onset",
  basis: "CURATED",
  implied_subject: "BRCA1 [human] breast cancer 1, early onset",
  implied_predicate: "has disease",
  implied_object: "breast cancer",
  implied_object_uri: "http://purl.obolibrary.org/obo/MONDO_0007254",
  ...over,
});

describe("InferredConceptsRow", () => {
  beforeEach(() => {
    cleanup();
    rows.current = [];
  });

  it("renders nothing when there is nothing to infer", () => {
    open();
    expect(screen.queryByText(/inferred/i)).toBeNull();
  });

  it("shows the IMPLIED object, not the stored subject", async () => {
    rows.current = [row()];
    open();
    await waitFor(() => expect(screen.getByText("breast cancer")).toBeTruthy());
    // The stored row's object must not become a chip.
    expect(screen.queryByText(/BRCA1 \[human\]/)).toBeNull();
  });

  it("says what it was inferred FROM, and nothing else", async () => {
    rows.current = [row()];
    open();
    const chip = await waitFor(() => screen.getByTitle(/^Inferred from: /));
    // 🛑 The basis copy must not ride along: BASIS_COPY.CURATED.title
    // ends "Not inferred", which contradicts the row it sits in.
    expect(chip.getAttribute("title")).not.toMatch(/not inferred/i);
    // The caveat is said once, on the row label, not on every chip.
    expect(chip.getAttribute("title")).not.toMatch(/approximate/i);
  });

  it("collapses one concept implied by several annotations into one chip", async () => {
    // Four cell lines implying one organism part is one fact, not four.
    rows.current = [
      row({ implied_subject: "PC-3", implied_object: "prostate gland", implied_object_uri: "u" }),
      row({ implied_subject: "22Rv1", implied_object: "prostate gland", implied_object_uri: "u" }),
    ];
    open();
    await waitFor(() =>
      expect(screen.getAllByText("prostate gland")).toHaveLength(1),
    );
    // Both seeds survive into the tooltip, each as its own statement.
    expect(screen.getByTitle(/PC-3 → has disease → prostate gland/)).toBeTruthy();
    expect(screen.getByTitle(/22Rv1 → has disease → prostate gland/)).toBeTruthy();
  });

  it("names the resource that uses the seed's label", async () => {
    // GSE286105, verbatim off gemma2: one subject URI, two names. The
    // experiment is annotated `Hep G2 cell`; Cellosaurus calls the same
    // term `Hep-G2`, so a chip seeded by it must say where that name
    // comes from or it names an annotation the curator cannot find.
    rows.current = [
      row({
        implied_subject: "Hep-G2",
        implied_subject_uri: "http://purl.obolibrary.org/obo/CLO_0003704",
        implied_object: "hepatoblastoma",
        implied_object_uri: "http://purl.obolibrary.org/obo/MONDO_0004553",
        basis: "EXTERNAL",
        source: "CELLOSAURUS",
      }),
    ];
    open();
    // Cased for a sentence, not shouted as the wire spells it.
    const chip = await waitFor(() =>
      screen.getByTitle(
        "Inferred from: Hep-G2 → has disease → hepatoblastoma, via Cellosaurus",
      ),
    );
    expect(chip).toBeTruthy();
  });

  it("keeps both names when one URI arrives under two sources", async () => {
    // Two spellings of one term are two things to a reader; the source
    // is what tells them apart, so neither collapses into the other.
    const cloUri = "http://purl.obolibrary.org/obo/CLO_0003704";
    rows.current = [
      row({
        implied_subject: "Hep G2 cell",
        implied_subject_uri: cloUri,
        implied_object: "liver",
        implied_object_uri: "u",
        basis: "ONTOLOGY",
        source: "CLO",
      }),
      row({
        implied_subject: "Hep-G2",
        implied_subject_uri: cloUri,
        implied_object: "liver",
        implied_object_uri: "u",
        basis: "EXTERNAL",
        source: "CELLOSAURUS",
      }),
      // Same seed, same source, a SECOND PREDICATE. This was collapsed
      // into the row above while the tooltip named only the seed; once
      // the tooltip states the relationship the two are two different
      // statements, and dropping one would misdescribe the data.
      row({
        implied_subject: "Hep-G2",
        implied_subject_uri: cloUri,
        implied_predicate: "derives from anatomic part",
        implied_object: "liver",
        implied_object_uri: "u",
        basis: "EXTERNAL",
        source: "CELLOSAURUS",
      }),
    ];
    open();
    const chip = await waitFor(() => screen.getByTitle(/^Inferred from: /));
    expect(chip.getAttribute("title")).toBe(
      "Inferred from: Hep G2 cell → has disease → liver, via CLO; " +
        "Hep-G2 → has disease → liver, via Cellosaurus; " +
        "Hep-G2 → derives from anatomic part → liver, via Cellosaurus",
    );
  });

  it("respects the gate — wired to the const, not hardcoded", async () => {
    // Pins the WIRING, not the value — flipping the const must not
    // break this test, but a hardcoded gate must. When off it hides
    // rather than greying: a read-only data row has nothing for the
    // curator to act on, so a placeholder would be noise.
    rows.current = [row()];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <InferredConceptsRow experimentId={3333} />
      </QueryClientProvider>,
    );
    if (SHOW_INFERRED_CONCEPTS) {
      await waitFor(() =>
        expect(screen.getByText("breast cancer")).toBeTruthy(),
      );
    } else {
      expect(screen.queryByText("breast cancer")).toBeNull();
    }
  });

  it("states the RELATIONSHIP in the tooltip, subject → predicate → object", async () => {
    rows.current = [
      row({
        implied_subject: "APP/PS1",
        implied_predicate: "has role in modeling",
        implied_object: "Alzheimer disease",
        source: "TGEMO",
      }),
    ];
    open();
    const chip = await waitFor(() => screen.getByTitle(/^Inferred from: /));
    expect(chip.getAttribute("title")).toBe(
      "Inferred from: APP/PS1 → has role in modeling → Alzheimer disease, via TGEMO",
    );
  });

  it("🛑 keeps two predicates on one seed as two statements", async () => {
    // They were deduped to one while the tooltip named only the seed.
    // Naming the relationship makes that a lie: it would print one
    // predicate and drop the other.
    rows.current = [
      row({
        implied_subject: "APP/PS1",
        implied_subject_uri: "u:seed",
        implied_predicate: "has role in modeling",
        source: "TGEMO",
      }),
      row({
        implied_subject: "APP/PS1",
        implied_subject_uri: "u:seed",
        implied_predicate: "has disease",
        source: "TGEMO",
      }),
    ];
    open();
    const chip = await waitFor(() => screen.getByTitle(/^Inferred from: /));
    const title = chip.getAttribute("title") ?? "";
    expect(title).toMatch(/has role in modeling/);
    expect(title).toMatch(/has disease/);
  });

  it("labels each concept with its category from the wire", async () => {
    // Measured on eid 27103: `object_category: "disease"` alongside
    // `predicate: "has role in modeling"`.
    rows.current = [
      row({
        object_category: "disease",
        object_category_uri: "http://www.ebi.ac.uk/efo/EFO_0000408",
        predicate: "has role in modeling",
        implied_predicate: "has role in modeling",
      }),
    ];
    open();
    await waitFor(() => expect(screen.getByText("breast cancer")).toBeTruthy());
    expect(screen.getByText("disease")).toBeTruthy();
  });

  it("🛑 shows the CATEGORY, never the predicate, as the group label", async () => {
    // `APP/PS1 --has role in modeling--> Alzheimer disease` — the
    // object is a disease and the relation is what does the modelling.
    // Labelling the group "has role in modeling" would say the disease
    // is a kind of model, which is backwards.
    rows.current = [
      row({
        object_category: "disease",
        predicate: "has role in modeling",
        implied_predicate: "has role in modeling",
      }),
    ];
    open();
    await waitFor(() => expect(screen.getByText("disease")).toBeTruthy());
    expect(screen.queryByText(/has role in modeling/)).toBeNull();
  });

  it("groups by category and puts the uncategorised last", async () => {
    rows.current = [
      row({ implied_object: "uncategorised thing", implied_object_uri: "u:1" }),
      row({
        implied_object: "brain",
        implied_object_uri: "u:2",
        object_category: "organism part",
      }),
      row({
        implied_object: "breast cancer",
        implied_object_uri: "u:3",
        object_category: "disease",
      }),
    ];
    open();
    await waitFor(() => expect(screen.getByText("brain")).toBeTruthy());
    const text = screen.getByText("inferred").parentElement?.textContent ?? "";
    expect(text.indexOf("disease")).toBeLessThan(text.indexOf("organism part"));
    // The em dash stands in for "the relation states no category" and
    // sorts to the end, so a missing category never borrows a
    // neighbour's heading.
    expect(text.indexOf("organism part")).toBeLessThan(text.indexOf("\u2014"));
  });

  it("offers nothing editable — these are not annotations", async () => {
    rows.current = [row()];
    open();
    await waitFor(() => expect(screen.getByText("breast cancer")).toBeTruthy());
    // 🛑 This counted buttons to zero, which stopped being the same
    // question the moment the CURIE became a `CurieLink`. Opening a term
    // card is a READ; the rule is that nothing here MUTATES. So the
    // assertion names the affordances that would break the rule instead
    // of forbidding interactivity outright — otherwise the next read-only
    // affordance fails a test whose title it does not contradict.
    const buttons = screen.queryAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe("MONDO:0007254");
    for (const b of buttons) {
      expect(b.textContent ?? "").not.toMatch(/edit|delete|remove|add|×/i);
    }
  });
});
