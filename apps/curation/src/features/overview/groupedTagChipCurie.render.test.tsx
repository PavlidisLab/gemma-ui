/**
 * @vitest-environment jsdom
 *
 * A grouped tag chip prints its CURIE once.
 *
 * `TagInnerTerm` renders the CURIE itself. The expanded group chip
 * rendered a second `CurieLink` beside it, so a grounded value read
 * `female PATO:0000383 PATO:0000383`.
 *
 * The single-tag chip next to it is checked in the same run: it does
 * NOT go through `TagInnerTerm`, so its own `CurieLink` is the only
 * one there and must stay.
 *
 * NOT tested here: anything positional. Nothing in this suite renders
 * pixels, so chip framing, palette and spacing are not verified by a
 * green run.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/features/design/DesignDraftContext", () => ({
  useDesignDraft: () => ({ draft: null, apply: vi.fn() }),
  useDatasetTaxon: () => null,
}));
vi.mock("@/features/comparison/FlowContext", () => ({
  useIsReadOnly: () => false,
}));

import { EditableDirectGroupChip } from "./TagBar";
import type { Tag } from "@/features/experiment/types";

afterEach(cleanup);

const CATEGORY = { label: "phenotype", uri: null } as Tag["category"];

const tag = (id: number, label: string, uri: string | null): Tag =>
  ({
    id,
    category: CATEGORY,
    value: { label, uri },
    statements: [],
  }) as unknown as Tag;

/** The chip starts collapsed; the count button is what opens it. */
function renderExpanded(tags: Tag[]) {
  const out = render(
    <EditableDirectGroupChip category={CATEGORY} tags={tags} />,
  );
  fireEvent.click(screen.getByTitle(/click to expand/i));
  return out;
}

const FEMALE = "http://purl.obolibrary.org/obo/PATO_0000383";
const MALE = "http://purl.obolibrary.org/obo/PATO_0000384";

describe("grouped tag chip — one CURIE per value", () => {
  it("prints a grounded value's CURIE once", () => {
    renderExpanded([tag(1, "female", FEMALE), tag(2, "male", MALE)]);
    expect(screen.getByText("female")).toBeTruthy();
    expect(screen.getAllByText("PATO:0000383")).toHaveLength(1);
    expect(screen.getAllByText("PATO:0000384")).toHaveLength(1);
  });

  it("prints no CURIE for a free-text value", () => {
    renderExpanded([tag(1, "female", FEMALE), tag(2, "untyped", null)]);
    expect(screen.getByText("untyped")).toBeTruthy();
    expect(screen.queryByText(/^PATO:/)).toBeTruthy();
    expect(screen.getAllByText(/^[A-Z]+:[0-9]+$/)).toHaveLength(1);
  });
});

describe("single tag chip — its own CURIE survives", () => {
  it("still prints the CURIE beside the value", () => {
    render(<EditableDirectGroupChip category={CATEGORY} tags={[tag(1, "female", FEMALE)]} />);
    expect(screen.getByText("female")).toBeTruthy();
    expect(screen.getAllByText("PATO:0000383")).toHaveLength(1);
  });
});
