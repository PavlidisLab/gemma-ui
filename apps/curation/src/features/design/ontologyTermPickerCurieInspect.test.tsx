/**
 * @vitest-environment jsdom
 *
 * Dropdown rows render their CURIE through ``CurieLink`` (the repo-wide
 * "CURIEs open the CuriePopover" convention) instead of dead mono text.
 * The picker lives on its input's blur, so inspecting a term must not
 * be read as leaving the picker:
 *
 *  - clicking the CURIE chip opens the popover and does NOT commit the
 *    row underneath it;
 *  - while the popover is open, an input blur (focus moves into the
 *    popover, or to the OLS tab it opens) neither commits the draft as
 *    free text nor closes the dropdown;
 *  - Escape with the popover open is the popover's to consume — the
 *    editor stays open;
 *  - once the popover closes, blur behaves exactly as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const MDX_CANDIDATE = {
  label: "mdx",
  uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00180",
  category_label: "genotype",
  category_uri: null,
  usage_count: 3,
};
vi.mock("@/api/annotations", () => ({
  useAnnotationSearch: () => ({ data: [MDX_CANDIDATE], isFetching: false }),
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
// The popover's own rendering (Gemma/OLS fetches, link-outs) is covered
// by its own tests; here it only needs to exist and be closeable, so
// the picker's hold-while-inspecting behaviour is what's under test.
vi.mock("@/components/ui/CuriePopover", () => ({
  // Like the real popover, clicks inside must not bubble into the row
  // the chip sits on (the real one also portals to <body>; stopping
  // propagation is enough for what these tests exercise).
  CuriePopover: ({ onClose }: { onClose: () => void }) => (
    <div
      role="dialog"
      data-testid="curie-popover"
      onClick={(e) => e.stopPropagation()}
    >
      <button type="button" data-testid="popover-close" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));

import { OntologyTermPicker } from "./OntologyTermPicker";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function openPicker(onCommit: (v: unknown) => void) {
  render(
    <OntologyTermPicker
      value={{ label: "mdx", uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00180" }}
      category="genotype"
      onCommit={onCommit as never}
      autoOpen
    />,
  );
}

function curieChip(): HTMLElement {
  // CurieLink renders a button labelled with the shortened CURIE.
  const chip = screen
    .getAllByRole("button")
    .find((b) => /TGEMO/i.test(b.textContent ?? ""));
  expect(chip).toBeDefined();
  return chip!;
}

describe("OntologyTermPicker — CURIE inspection from dropdown rows", () => {
  it("renders the candidate CURIE as a CurieLink chip, and clicking it opens the popover without committing the row", () => {
    const onCommit = vi.fn();
    openPicker(onCommit);
    fireEvent.click(curieChip());
    expect(screen.getByTestId("curie-popover")).toBeInTheDocument();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("holds the input's blur-commit while the popover is open", () => {
    const onCommit = vi.fn();
    openPicker(onCommit);
    const input = screen.getByDisplayValue("mdx");
    // The curator refines the query, then inspects a candidate.
    fireEvent.change(input, { target: { value: "mdx something" } });
    fireEvent.click(curieChip());
    // Focus moves into the popover (or to a new browser tab) → blur.
    fireEvent.blur(input);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    // Neither committed the half-typed draft nor closed the dropdown.
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("mdx something")).toBeInTheDocument();
  });

  it("lets Escape close the popover without cancelling the editor", () => {
    const onCommit = vi.fn();
    openPicker(onCommit);
    const input = screen.getByDisplayValue("mdx");
    fireEvent.click(curieChip());
    fireEvent.keyDown(input, { key: "Escape" });
    // The editor input survives the Escape that was aimed at the popover.
    expect(screen.getByDisplayValue("mdx")).toBeInTheDocument();
  });

  it("resumes normal blur-commit once the popover is closed", () => {
    const onCommit = vi.fn();
    openPicker(onCommit);
    const input = screen.getByDisplayValue("mdx");
    fireEvent.change(input, { target: { value: "typed free text" } });
    fireEvent.click(curieChip());
    fireEvent.click(screen.getByTestId("popover-close"));
    fireEvent.blur(input);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onCommit).toHaveBeenCalledWith({ label: "typed free text", uri: null });
  });
});
