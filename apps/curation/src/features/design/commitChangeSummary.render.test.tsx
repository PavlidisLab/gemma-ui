/**
 * @vitest-environment jsdom
 *
 * What a commit or a restore would change.
 *
 * The assertions that matter are the ones about SILENCE: a section the
 * renderer does not recognize, and the identity warning that must
 * appear exactly when the server reports it and never as decoration.
 */
import { describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { snakeify } from "@/api/client";
import type { CommitReport } from "@/api/curationCommit";
import { CommitChangeSummary } from "./CommitChangeSummary";

/**
 * Gemma's own report, put through the SAME transform every response
 * takes on its way out of `api.post` — `snakeify` in `api/client.ts`.
 *
 * 🛑 Spelled by hand in the declared casing, this fixture passed every
 * assertion below while the wire path rendered nothing: the served
 * `deletedIdentities` and `changes.curationDetails` do not survive the
 * boundary under those names, so the renderer read `undefined` and
 * matched no section. Feeding the transform is what makes the fixture
 * answerable about the real path.
 */
function report(over: Record<string, unknown> = {}): CommitReport {
  return snakeify({
    applied: false,
    idMap: {},
    changes: {},
    auditEventIds: [],
    canonicalizations: [],
    commitAnnotationSetId: null,
    ...over,
  }) as CommitReport;
}

describe("the change tally", () => {
  it("names each section and only the movements", () => {
    cleanup();
    render(
      <CommitChangeSummary
        report={report({
          changes: {
            design: { created: 2, updated: 1, deleted: 0, unchanged: 7 },
            tags: { created: 0, updated: 0, deleted: 3, unchanged: 4 },
          },
        })}
      />,
    );
    expect(screen.getByText("Design")).toBeTruthy();
    expect(screen.getByText("2 added · 1 changed")).toBeTruthy();
    expect(screen.getByText("3 removed")).toBeTruthy();
  });

  it("🛑 `unchanged` alone is not a change — that section is dropped", () => {
    cleanup();
    render(
      <CommitChangeSummary
        report={report({ changes: { design: { unchanged: 12 } } })}
      />,
    );
    expect(screen.getByText(/no changes/i)).toBeTruthy();
  });

  it("🛑 renders a section it does not recognize rather than dropping it", () => {
    // A section silently omitted is a change nobody was shown. Gemma's
    // `changes` is an open map and gains sections without asking us.
    // The key renders as it arrives, transform included.
    cleanup();
    render(
      <CommitChangeSummary
        report={report({ changes: { somethingNew: { created: 1 } } })}
      />,
    );
    expect(screen.getByText("something_new")).toBeTruthy();
    expect(screen.getByText("1 added")).toBeTruthy();
  });

  it("🛑 labels the curation-details section Gemma actually sends", () => {
    // Gemma names it `curationDetails` and it reaches the renderer as
    // `curation_details`. Keyed on the served name, the section fell
    // past `SECTION_ORDER` and rendered as a raw key at the tail.
    cleanup();
    render(
      <CommitChangeSummary
        report={report({ changes: { curationDetails: { updated: 1 } } })}
      />,
    );
    expect(screen.getByText("Curation details")).toBeTruthy();
    expect(screen.queryByText("curation_details")).toBeNull();
  });
});

describe("🛑 the removal notice", () => {
  it("says how many existing annotations go away", () => {
    // `deletedIdentities` on the wire — read under that name it was
    // always undefined and the notice never appeared.
    cleanup();
    render(
      <CommitChangeSummary
        report={report({
          changes: { tags: { deleted: 2 } },
          deletedIdentities: [9018, 9019],
        })}
      />,
    );
    expect(screen.getByText(/2 existing annotations are removed/i)).toBeTruthy();
  });

  it("reads singular for one, and is silent for none", () => {
    cleanup();
    render(
      <CommitChangeSummary
        report={report({
          changes: { tags: { deleted: 1 } },
          deletedIdentities: [9018],
        })}
      />,
    );
    expect(screen.getByText(/1 existing annotation is removed/i)).toBeTruthy();
    cleanup();
    render(
      <CommitChangeSummary report={report({ changes: { tags: { deleted: 1 } } })} />,
    );
    expect(screen.queryByText(/is removed/i)).toBeNull();
  });
});

describe("🛑 the identity warning", () => {
  it("appears when the server reports re-identification", () => {
    cleanup();
    render(
      <CommitChangeSummary
        mode="restore"
        report={report({
          changes: { design: { updated: 2 } },
          reidentified: { "1101": 2201, "1102": 2202 },
        })}
      />,
    );
    // The consequence, not the count: a DEA referring to the old id is
    // rebuilt or dropped, and that is invisible in "2 changed".
    expect(screen.getByText(/2 annotations come back with new ids/i)).toBeTruthy();
    expect(screen.getByText(/differential expression analysis/i)).toBeTruthy();
  });

  it("does NOT appear when the server reports none", () => {
    // A caution shown on every preview is one nobody reads on the
    // preview where it matters.
    cleanup();
    render(
      <CommitChangeSummary
        mode="restore"
        report={report({ changes: { design: { updated: 2 } } })}
      />,
    );
    expect(screen.queryByText(/new ids/i)).toBeNull();
  });

  it("reads singular for one", () => {
    cleanup();
    render(
      <CommitChangeSummary report={report({ reidentified: { "7": 9 } })} />,
    );
    expect(screen.getByText(/1 annotation comes back with a new id/i)).toBeTruthy();
  });
});

describe("restore-specific copy", () => {
  it("says nothing has been written yet", () => {
    cleanup();
    render(<CommitChangeSummary mode="restore" report={report()} />);
    expect(screen.getByText(/nothing has been written yet/i)).toBeTruthy();
  });

  it("distinguishes an identical snapshot from an empty commit", () => {
    cleanup();
    render(<CommitChangeSummary mode="restore" report={report()} />);
    expect(screen.getByText(/matches the current curation/i)).toBeTruthy();
  });

  it("surfaces a server error instead of a tally", () => {
    cleanup();
    render(
      <CommitChangeSummary
        report={report({ error: "The set is not a SNAPSHOT." })}
      />,
    );
    expect(screen.getByText(/not a SNAPSHOT/)).toBeTruthy();
    expect(screen.queryByText(/no changes/i)).toBeNull();
  });
});
