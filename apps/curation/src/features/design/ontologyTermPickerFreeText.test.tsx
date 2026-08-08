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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// Mock the data hooks so the picker renders a deterministic catalog.
// Mutable so a test can swap in a catalog that has nothing to do with
// what the curator typed.
const MDX_CANDIDATE = {
  label: "mdx",
  uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00180",
  category_label: "genotype",
  category_uri: null,
  usage_count: 3,
};
let catalog: unknown[] = [MDX_CANDIDATE];
vi.mock("@/api/annotations", () => ({
  useAnnotationSearch: () => ({ data: catalog, isFetching: false }),
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

beforeEach(() => {
  catalog = [MDX_CANDIDATE];
});

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

  it("still binds the ontology term via Enter once the curator arrows onto the candidate row", () => {
    const onCommit = vi.fn();
    open(onCommit);
    const input = screen.getByDisplayValue("mdx");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith({
      label: "mdx",
      uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00180",
    });
  });

  it("reaches the free-text row by arrowing past the candidates and drops the URI", () => {
    const onCommit = vi.fn();
    open(onCommit);
    const input = screen.getByDisplayValue("mdx");
    // One catalog row (index 0), then the free-text row (index 1).
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith({ label: "mdx", uri: null });
  });
});

/**
 * Enter must not bind a row the curator never targeted. Reproduced in
 * the app: a tag subject typed as "pLX304 empty vector" + Enter bound
 * itself to the first row the catalog happened to return — a live
 * myxoma virus strain — because the highlight defaulted to row 0. That
 * is the same opt-in rule as above (design review 2026-07-13), just
 * broken on the keyboard path instead of the mouse path: the curator
 * picked nothing, yet a URI was attached.
 */
describe("OntologyTermPicker — Enter never binds an untargeted row", () => {
  const WRONG_CANDIDATE = {
    label:
      "live myxoma-vectored rabbit-haemorrhagic-disease virus strain 009",
    uri: "http://purl.obolibrary.org/obo/CHEBI_759771",
    category_label: "treatment",
    category_uri: null,
    usage_count: 1,
  };

  function openEmpty(onCommit: (v: unknown) => void) {
    render(
      <OntologyTermPicker
        value={null}
        category="treatment"
        onCommit={onCommit as never}
        autoOpen
      />,
    );
    return screen.getByRole("textbox");
  }

  it("commits typed text as free text when Enter is pressed without targeting a row", () => {
    catalog = [WRONG_CANDIDATE];
    const onCommit = vi.fn();
    const input = openEmpty(onCommit);
    fireEvent.change(input, { target: { value: "pLX304 empty vector" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith({
      label: "pLX304 empty vector",
      uri: null,
    });
    expect(onCommit).not.toHaveBeenCalledWith(
      expect.objectContaining({ uri: WRONG_CANDIDATE.uri }),
    );
  });

  it("binds the candidate the curator arrowed to, with its URI", () => {
    catalog = [WRONG_CANDIDATE];
    const onCommit = vi.fn();
    const input = openEmpty(onCommit);
    fireEvent.change(input, { target: { value: "myxoma" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith({
      label: WRONG_CANDIDATE.label,
      uri: WRONG_CANDIDATE.uri,
    });
  });

  it("forgets a targeted row when the curator keeps typing", () => {
    catalog = [WRONG_CANDIDATE];
    const onCommit = vi.fn();
    const input = openEmpty(onCommit);
    fireEvent.change(input, { target: { value: "pLX304" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.change(input, { target: { value: "pLX304 empty vector" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith({
      label: "pLX304 empty vector",
      uri: null,
    });
  });

  it("arrowing back up off the first row returns to free text", () => {
    catalog = [WRONG_CANDIDATE];
    const onCommit = vi.fn();
    const input = openEmpty(onCommit);
    fireEvent.change(input, { target: { value: "pLX304 empty vector" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith({
      label: "pLX304 empty vector",
      uri: null,
    });
  });

  it("treats hovering a row as targeting it", () => {
    catalog = [WRONG_CANDIDATE];
    const onCommit = vi.fn();
    const input = openEmpty(onCommit);
    fireEvent.change(input, { target: { value: "myxoma" } });
    fireEvent.mouseEnter(screen.getByText(WRONG_CANDIDATE.label));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith({
      label: WRONG_CANDIDATE.label,
      uri: WRONG_CANDIDATE.uri,
    });
  });

  it("un-targets a hovered row once the pointer leaves the dropdown", () => {
    catalog = [WRONG_CANDIDATE];
    const onCommit = vi.fn();
    const input = openEmpty(onCommit);
    fireEvent.change(input, { target: { value: "pLX304 empty vector" } });
    const row = screen.getByText(WRONG_CANDIDATE.label);
    fireEvent.mouseEnter(row);
    fireEvent.mouseLeave(row.closest("ul")!);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith({
      label: "pLX304 empty vector",
      uri: null,
    });
  });

  it("commits an empty catalog's typed text as free text", () => {
    catalog = [];
    const onCommit = vi.fn();
    const input = openEmpty(onCommit);
    fireEvent.change(input, { target: { value: "pLX304 empty vector" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith({
      label: "pLX304 empty vector",
      uri: null,
    });
  });
});
