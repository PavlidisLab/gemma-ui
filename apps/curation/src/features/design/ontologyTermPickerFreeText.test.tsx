/**
 * @vitest-environment jsdom
 *
 * Bug 2 (design review 2026-07-13): in the tag/statement editor, a curator who
 * has an ontology-bound term (e.g. object ``mdx`` → TGEMO_00180) and
 * wants to switch it back to plain free text COULDN'T — the picker
 * force-upgraded any typed label that matched an ontology term back to
 * the ontology term. "If I explicitly don't click on the ontology term
 * that comes up, it should keep it as free text."
 *
 * The fix: ontology binding is opt-in (click a candidate row). The
 * explicit "use free text" row is always available (even on an exact
 * catalog match) and always drops the URI.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// Mock the data hooks so the picker renders a deterministic "mdx"
// catalog candidate with a URI.
vi.mock("@/api/annotations", () => ({
  useAnnotationSearch: () => ({
    data: [
      {
        label: "mdx",
        uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00180",
        category_label: "genotype",
        category_uri: null,
        usage_count: 3,
      },
    ],
    isFetching: false,
  }),
}));
vi.mock("@/api/findTerm", () => ({
  useFindTerm: () => ({
    data: undefined,
    isPending: false,
    mutate: vi.fn(),
    reset: vi.fn(),
  }),
}));
vi.mock("@/lib/gemmaMode", () => ({
  useGemmaMode: () => ({ ontologyHost: "", ontologySplit: false }),
}));
vi.mock("@/features/comparison/FlowContext", () => ({
  useIsReadOnly: () => false,
}));

import { OntologyTermPicker } from "./OntologyTermPicker";

describe("OntologyTermPicker — deliberate free text over an ontology match", () => {
  function open(onCommit: (v: unknown) => void) {
    render(
      <OntologyTermPicker
        value={{ label: "mdx", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00180" }}
        category="genotype"
        onCommit={onCommit as never}
        autoOpen
      />,
    );
  }

  it("offers a 'use free text' row even when the label exactly matches an ontology candidate", () => {
    open(vi.fn());
    expect(screen.getByText(/use free text/i)).toBeInTheDocument();
    expect(screen.getByText(/no ontology link/i)).toBeInTheDocument();
  });

  it("commits free text with uri=null when the curator picks the free-text row", () => {
    const onCommit = vi.fn();
    open(onCommit);
    fireEvent.click(screen.getByText(/use free text/i));
    expect(onCommit).toHaveBeenCalledWith({ label: "mdx", uri: null });
  });

  it("still binds the ontology term via Enter on the highlighted candidate row", () => {
    const onCommit = vi.fn();
    open(onCommit);
    // Default highlight is the first catalog candidate → Enter binds it
    // (ontology opt-in stays a one-keystroke path).
    fireEvent.keyDown(screen.getByDisplayValue("mdx"), { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith({
      label: "mdx",
      uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00180",
    });
  });
});
