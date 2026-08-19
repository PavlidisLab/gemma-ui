/**
 * @vitest-environment jsdom
 *
 * StatementEditModal basics — deferred from the 2026-06-17 landing.
 * Not a typeahead-driving test (the pickers have their own): these pin
 * the modal's own contract — seeding from ``initial`` on the rising
 * edge, the subject-required Save gate, blank-pair cleaning on save,
 * and Escape → onCancel.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// The embedded pickers pull the annotation-search / find-term hooks;
// mock them the same way the picker's own tests do so the modal
// renders without a backend.
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
vi.mock("@/api/categories", () => ({
  useCategories: () => ({ data: [], isLoading: false }),
}));

import { StatementEditModal, type StatementDraft } from "./StatementEditModal";

const ORGANISM_PART = {
  label: "organism part",
  uri: "http://www.ebi.ac.uk/efo/EFO_0000635",
};
const CORTEX = {
  label: "cortex",
  uri: "http://purl.obolibrary.org/obo/UBERON_0001851",
};
const PART_OF = {
  label: "part of",
  uri: "http://purl.obolibrary.org/obo/BFO_0000050",
};
const BRAIN = {
  label: "brain",
  uri: "http://purl.obolibrary.org/obo/UBERON_0000955",
};

const EMPTY: StatementDraft = {
  category: { label: "", uri: null },
  subject: { label: "", uri: null },
  pairs: [],
};

const FILLED: StatementDraft = {
  category: ORGANISM_PART,
  subject: CORTEX,
  pairs: [
    { predicate: PART_OF, object: BRAIN },
    // A blank pair a curator opened but never filled — save must drop it.
    { predicate: null, object: null },
  ],
};

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: /^save$/i });
}

describe("StatementEditModal", () => {
  it("gates Save on a non-empty subject", () => {
    render(
      <StatementEditModal
        open
        initial={EMPTY}
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(saveButton()).toBeDisabled();
  });

  it("seeds from the initial draft and saves it with blank pairs cleaned", async () => {
    const onSave = vi.fn();
    render(
      <StatementEditModal
        open
        initial={FILLED}
        onCancel={vi.fn()}
        onSave={onSave}
      />,
    );
    expect(saveButton()).toBeEnabled();
    fireEvent.click(saveButton());
    // handleSave is async (awaits onSave); flush the microtask.
    await Promise.resolve();
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as StatementDraft;
    expect(saved.subject).toEqual(CORTEX);
    expect(saved.pairs).toEqual([{ predicate: PART_OF, object: BRAIN }]);
  });

  it("Escape cancels without saving", () => {
    const onCancel = vi.fn();
    const onSave = vi.fn();
    render(
      <StatementEditModal
        open
        initial={FILLED}
        onCancel={onCancel}
        onSave={onSave}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("renders nothing while closed", () => {
    render(
      <StatementEditModal
        open={false}
        initial={FILLED}
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
  });
});
