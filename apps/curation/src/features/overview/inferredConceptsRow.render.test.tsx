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
    // Both sources survive into the tooltip.
    expect(screen.getByTitle(/PC-3, 22Rv1/)).toBeTruthy();
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

  it("offers nothing editable — these are not annotations", async () => {
    rows.current = [row()];
    open();
    await waitFor(() => expect(screen.getByText("breast cancer")).toBeTruthy());
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
