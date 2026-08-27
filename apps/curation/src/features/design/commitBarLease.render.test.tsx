/**
 * @vitest-environment jsdom
 *
 * Someone else's editing lease blocks COMMIT.
 *
 * The lease was advisory: it warned and never gated, on the reasoning
 * that a stale lock should not strand a curator. That does not survive
 * the case Paul named — the proposer running over a thousand
 * experiments while a curator hand-edits one of them. Two writers, no
 * gate, and the loser finds out at commit time or not at all.
 *
 * Editing stays free and steal stays one click away; what is gated is
 * the write.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommitBar } from "./CommitBar";
import type { DesignDiff } from "./diff";

afterEach(cleanup);

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

function renderBar(lockedBy: string | null, onTakeOver = vi.fn()) {
  render(
    <CommitBar
      diff={DIFF}
      saving={false}
      saveError={null}
      onCommit={vi.fn()}
      onDiscard={vi.fn()}
      lockedBy={lockedBy}
      onTakeOver={onTakeOver}
    />,
  );
}

const commitBtn = () => screen.getByRole("button", { name: /^commit$/i });

describe("commit under someone else's lease", () => {
  it("🛑 blocks commit while another curator holds it", () => {
    renderBar("alice");
    expect(commitBtn()).toBeDisabled();
  });

  it("says who holds it, so the block is not a mystery", () => {
    renderBar("alice");
    expect(screen.getByText(/alice/)).toBeTruthy();
    expect(screen.getByText(/commit is blocked/i)).toBeTruthy();
  });

  it("offers Take over — nobody is stranded by a lease whose holder left", () => {
    const take = vi.fn();
    renderBar("alice", take);
    const btn = screen.getByRole("button", { name: /take over/i });
    btn.click();
    expect(take).toHaveBeenCalled();
  });

  it("does not block when nobody else holds it", () => {
    // Your own lease must never block you, and unlocked is the ordinary
    // case — App passes null for both.
    renderBar(null);
    expect(commitBtn()).not.toBeDisabled();
    expect(screen.queryByText(/commit is blocked/i)).toBeNull();
  });
});
