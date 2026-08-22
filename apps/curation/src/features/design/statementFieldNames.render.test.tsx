/**
 * @vitest-environment jsdom
 *
 * The statement editor's hover text teaches Gemma's own vocabulary.
 * A curator reading a factor value sees a name, a category, a value
 * with its URI, a predicate and an object — those are the words the
 * data carries on the wire and the words Gemma's own tools use, so
 * the tooltips say them rather than "term" / "double-click to edit"
 * (2026-08-21).
 *
 * The field's name goes at the END of the action phrase — "click to
 * edit value", not "value: prime adult stage". Led with, it read as a
 * form caption and pushed the term itself out of first position.
 *
 * The URI shows as a CURIE, not the full IRI: the IRI made the
 * tooltip several times wider than the row it was explaining, and
 * the chip beside the term already carries the full IRI on its own
 * hover for the curator who needs to copy it.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/api/annotations", () => ({
  useAnnotationSearch: () => ({ data: [], isFetching: false }),
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
import { InlineText } from "@/components/ui/InlineText";

const UBERON = "http://purl.obolibrary.org/obo/UBERON_0018241";

function titleOf(text: string): string {
  return screen.getByText(text).getAttribute("title") ?? "";
}

describe("statement field names in hover text", () => {
  it("a grounded subject hovers as the value, with its CURIE", () => {
    render(
      <OntologyTermPicker
        value={{ label: "prime adult stage", uri: UBERON }}
        category={null}
        searchContext="subject"
        placeholder="subject"
        onCommit={vi.fn()}
      />,
    );
    const title = titleOf("prime adult stage");
    expect(title).toContain("prime adult stage · UBERON:0018241");
    expect(title).toContain("click to edit value");
    // The term leads; the field name is the tail of the action phrase.
    expect(title.indexOf("prime adult stage")).toBeLessThan(
      title.indexOf("click to edit"),
    );
    // The full IRI is what made this tooltip unreadable.
    expect(title).not.toContain(UBERON);
  });

  it("a free-text object hovers as the object, and says it has no URI", () => {
    render(
      <OntologyTermPicker
        value={{ label: "2 week", uri: null }}
        category={null}
        searchContext="object"
        placeholder="object"
        onCommit={vi.fn()}
      />,
    );
    const title = titleOf("2 week");
    expect(title).toContain("2 week — free text, no URI");
    expect(title).toContain("click to edit object");
  });

  it("an empty subject slot says which slot it is", () => {
    render(
      <OntologyTermPicker
        value={null}
        category={null}
        searchContext="subject"
        placeholder="subject"
        onCommit={vi.fn()}
      />,
    );
    expect(titleOf("subject")).toBe("click to pick value");
  });

  it("a named InlineText field says which field it edits", () => {
    render(
      <InlineText value="infant 2 weeks" field="name" onCommit={vi.fn()} />,
    );
    expect(titleOf("infant 2 weeks")).toBe("double-click to edit name");
  });

  it("an unnamed InlineText field keeps the generic hover", () => {
    render(<InlineText value="infant 2 weeks" onCommit={vi.fn()} />);
    expect(titleOf("infant 2 weeks")).toBe("double-click to edit");
  });
});
