/**
 * @vitest-environment jsdom
 *
 * Remote mode blocks COMMIT, and says so before the click.
 *
 * Commit's write path is the older whole-design PUT. `/rest` is a
 * catch-all whose meaning changes with mode — the same relative path
 * reaches the curation store locally and a real Gemma remotely — and
 * the agent's write-target guard cannot cover it, because it never
 * reaches the agent.
 *
 * The chain built to replace that endpoint (preflight → commit → sign)
 * cannot take over yet: the store's design carries neither `gemmaId`
 * nor `clientRef` for its factors and values, so mapping it today would
 * make Gemma CREATE everything and duplicate the design.
 *
 * ⇒ Until that identity mapping exists, remote mode must write nothing.
 * Editing stays free, exactly as under someone else's lease.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/gemmaMode", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/gemmaMode")>("@/lib/gemmaMode");
  return { ...actual, useGemmaMode: vi.fn() };
});

import { resolveGemmaMode, useGemmaMode } from "@/lib/gemmaMode";
import { CommitBar } from "./CommitBar";
import type { DesignDiff } from "./diff";

afterEach(cleanup);
beforeEach(() => vi.mocked(useGemmaMode).mockReset());

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
  totals: { addedFvs: 1, modifiedFvs: 0, removedFvs: 0 },
} as unknown as DesignDiff;

/** Drive the bar through the REAL mode resolver so a change to what
 *  counts as remote shows up here, not in a hand-set boolean. */
function renderBar(mode: "local" | "remote", onCommit = vi.fn()) {
  vi.mocked(useGemmaMode).mockReturnValue(
    resolveGemmaMode(
      mode === "remote"
        ? { mode: "remote", gemmaBaseUrl: "https://gemma2.msl.ubc.ca" }
        : { mode: "local" },
    ),
  );
  render(
    <CommitBar
      diff={DIFF}
      saving={false}
      saveError={null}
      onCommit={onCommit}
      onDiscard={vi.fn()}
      lockedBy={null}
    />,
  );
  return onCommit;
}

const commitBtn = () => screen.getByRole("button", { name: /^commit$/i });

describe("commit in remote mode", () => {
  it("🛑 blocks commit", () => {
    renderBar("remote");
    expect(commitBtn()).toBeDisabled();
  });

  it("says why, rather than leaving a dead button", () => {
    renderBar("remote");
    expect(screen.getByText(/Remote mode/)).toBeTruthy();
    expect(screen.getByText(/commit is\s+blocked here/i)).toBeTruthy();
  });

  it("tells the curator their edits survive and what to do", () => {
    renderBar("remote");
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/edits are kept/i);
    expect(body).toMatch(/switch to local mode/i);
  });

  it("does not block in local mode — the ordinary case", () => {
    renderBar("local");
    expect(commitBtn()).not.toBeDisabled();
    expect(screen.queryByText(/Remote mode/)).toBeNull();
  });

  it("local mode still commits", () => {
    const onCommit = renderBar("local");
    commitBtn().click();
    expect(onCommit).toHaveBeenCalled();
  });
});
