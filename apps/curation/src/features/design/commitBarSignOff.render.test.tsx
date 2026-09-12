/**
 * @vitest-environment jsdom
 *
 * A commit Gemma refuses as REQUIRES_FORCE is decided by the curator:
 * the bar names what signing deletes and asks twice. It is never a
 * force button, and it is offered for no other refusal.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/gemmaMode", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/gemmaMode")>("@/lib/gemmaMode");
  return { ...actual, useGemmaMode: vi.fn() };
});

import { resolveGemmaMode, useGemmaMode } from "@/lib/gemmaMode";
import type { CommitConflict } from "@/api/commitConflict";
import type { CommitReport } from "@/api/curationCommit";
import { CommitBar } from "./CommitBar";
import type { DesignDiff } from "./diff";

afterEach(cleanup);
beforeEach(() =>
  vi.mocked(useGemmaMode).mockReturnValue(
    resolveGemmaMode({ mode: "remote", gemmaBaseUrl: "https://gemma2.msl.ubc.ca" }),
  ),
);

const DIFF = {
  isDirty: true,
  factorsAdded: [],
  factorsRemoved: [],
  factorsChanged: [],
  tags: { added: [], removed: [], modified: [] },
  metadata: {
    biomaterialsModified: 0,
    publicationsAdded: 0,
    publicationsRemoved: 0,
    shortNameChanged: false,
  },
  totals: { addedFvs: 0, modifiedFvs: 4, removedFvs: 0 },
} as unknown as DesignDiff;

const REFUSED: CommitConflict = {
  reason: "REQUIRES_FORCE",
  message: "This design change would delete 1 differential-expression analysis.",
  retryableAfterReread: false,
  nextMove: "This commit invalidates existing analyses. Review what is affected, then sign off to proceed.",
};

const REPORT = {
  applied: false,
  id_map: {},
  changes: {},
  audit_event_ids: [],
  canonicalizations: [],
  commit_annotation_set_id: null,
  design_report: {
    requires_force: true,
    differential_expression_analyses_to_delete: [{ id: 501, name: "treatment DEA" }],
  },
} as CommitReport;

function renderBar(extra: Record<string, unknown>) {
  const onSignOff = vi.fn();
  render(
    <CommitBar
      diff={DIFF}
      saving={false}
      saveError="409"
      onCommit={vi.fn()}
      onDiscard={vi.fn()}
      lockedBy={null}
      onSignOff={onSignOff}
      {...extra}
    />,
  );
  return onSignOff;
}

describe("CommitBar — sign-off for a REQUIRES_FORCE refusal", () => {
  it("names the analysis signing would delete", () => {
    renderBar({ saveConflict: REFUSED, signOffReport: REPORT });
    expect(screen.getByText(/treatment DEA/)).toBeInTheDocument();
  });

  it("🛑 takes two clicks: review, then confirm", () => {
    const onSignOff = renderBar({ saveConflict: REFUSED, signOffReport: REPORT });
    fireEvent.click(screen.getByRole("button", { name: "Sign off…" }));
    expect(onSignOff).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Delete 1 analysis and commit" }),
    );
    expect(onSignOff).toHaveBeenCalledTimes(1);
  });

  it("can be backed out of at the confirm step", () => {
    const onSignOff = renderBar({ saveConflict: REFUSED, signOffReport: REPORT });
    fireEvent.click(screen.getByRole("button", { name: "Sign off…" }));
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(onSignOff).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign off…" })).toBeInTheDocument();
  });

  it("offers nothing to sign without the refused commit's report", () => {
    renderBar({ saveConflict: REFUSED, signOffReport: null });
    expect(screen.queryByRole("button", { name: "Sign off…" })).toBeNull();
  });

  it("offers nothing to sign for any other refusal", () => {
    renderBar({
      saveConflict: { ...REFUSED, reason: "LOCK_REQUIRED" },
      signOffReport: REPORT,
    });
    expect(screen.queryByRole("button", { name: "Sign off…" })).toBeNull();
  });
});
