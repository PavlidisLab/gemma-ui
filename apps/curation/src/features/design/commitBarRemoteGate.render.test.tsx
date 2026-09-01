/**
 * @vitest-environment jsdom
 *
 * Remote mode COMMITS, through the agent.
 *
 * This file used to pin the opposite, and the reasoning it carried was
 * sound for what existed then: commit's only write was the whole-design
 * `/rest` PUT, a catch-all whose meaning changes with mode, which the
 * agent's write-target guard cannot cover because it never reaches the
 * agent. And the replacement chain could not take over while the design
 * in hand was the STORE's, whose factors and values carry neither
 * `gemmaId` nor `clientRef` — mapping that would have made Gemma CREATE
 * everything and duplicate the design.
 *
 * Both premises are gone. In REMOTE mode the design is composed from
 * Gemma and carries Gemma's own positive ids, with negatives minted only
 * for agent-proposed rows, so the sign test names each item correctly —
 * which is why `buildCurationDocument` still throws in local mode, where
 * ids are small positive locals and the same rule would corrupt. And the
 * relay (`/curation-preflight` → `/curation-commit`) is wired, so the
 * write goes to the agent, which is Gemma's curation-write client.
 *
 * ⇒ The mode now decides WHICH write runs, not whether one may. What
 * this file guards is that the bar never again tells a curator to switch
 * modes to do something they can do where they are.
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
function renderBar(
  mode: "local" | "remote",
  onCommit = vi.fn(),
  extra: Record<string, unknown> = {},
) {
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
      {...extra}
    />,
  );
  return onCommit;
}

const commitBtn = () => screen.getByRole("button", { name: /^commit$/i });

describe("commit in remote mode", () => {
  it("🛑 does NOT block commit", () => {
    renderBar("remote");
    expect(commitBtn()).not.toBeDisabled();
  });

  it("🛑 commits — the click reaches the handler", () => {
    const onCommit = renderBar("remote");
    commitBtn().click();
    expect(onCommit).toHaveBeenCalled();
  });

  it("🛑 does not tell the curator to switch modes", () => {
    // The banner said commits could not happen from here and to switch
    // to local mode. Both stopped being true; a red bar describing a
    // block that no longer exists is worse than no bar.
    renderBar("remote");
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/switch to local mode/i);
    expect(body).not.toMatch(/edits are kept/i);
    expect(screen.queryByText(/disabled in remote mode/i)).toBeNull();
  });

  it("says where the write goes, on the button itself", () => {
    // Asserts that the destination is named — not the sentence naming
    // it. Pinning wording is what made the previous copy hard to
    // shorten.
    renderBar("remote");
    expect(commitBtn().getAttribute("title")).toMatch(/agent/i);
  });

  it("still blocks for the reasons that are still real", () => {
    // Remote mode stopped being a blocker; someone else's lease did
    // not. Guards against the gate having been removed wholesale
    // rather than narrowed.
    renderBar("remote", vi.fn(), { lockedBy: "someone else" });
    expect(commitBtn()).toBeDisabled();
  });
});

describe("commit in local mode — unchanged", () => {
  it("does not block", () => {
    renderBar("local");
    expect(commitBtn()).not.toBeDisabled();
  });

  it("commits", () => {
    const onCommit = renderBar("local");
    commitBtn().click();
    expect(onCommit).toHaveBeenCalled();
  });
});
