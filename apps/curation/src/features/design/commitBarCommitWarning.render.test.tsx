/**
 * @vitest-environment jsdom
 *
 * A commit that landed but left tag deletions undone. The draft is
 * clean by then, so the bar is the only place left to say so.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommitBar } from "./CommitBar";
import type { DesignDiff } from "./diff";

afterEach(cleanup);

const CLEAN = { isDirty: false, totals: {} } as unknown as DesignDiff;

describe("CommitBar after a commit with tag deletions undone", () => {
  it("shows the warning with the draft clean, and dismisses it", () => {
    const onDismiss = vi.fn();
    render(
      <CommitBar
        diff={CLEAN}
        saving={false}
        saveError={null}
        onCommit={() => {}}
        onDiscard={() => {}}
        commitWarning="Committed, but Gemma deleted 0 of the 1 tags this commit removed."
        onDismissCommitWarning={onDismiss}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "deleted 0 of the 1",
    );
    fireEvent.click(
      screen.getByRole("button", { name: /dismiss commit warning/i }),
    );
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when the draft is clean and there is no warning", () => {
    const { container } = render(
      <CommitBar
        diff={CLEAN}
        saving={false}
        saveError={null}
        onCommit={() => {}}
        onDiscard={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
