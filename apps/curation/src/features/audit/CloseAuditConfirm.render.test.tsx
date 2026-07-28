/**
 * @vitest-environment jsdom
 *
 * Regression test for the close-audit note-preservation bug
 * (2026-07-27): typing a close note and clicking Close while the
 * design draft had uncommitted edits used to silently wipe the note
 * even though nothing actually closed. Fixed by having the parent's
 * `handleClose` return a `CloseOutcome` so the confirm button only
 * clears the sticky note on an actual "closed" outcome.
 *
 * Asserts on the textarea's live React state rather than the
 * underlying localStorage persistence — localStorage isn't provided
 * in this jsdom/node env (see DesignDraftContext.render.test.tsx),
 * and `useStickyState` tolerates that via try/catch, so the in-memory
 * `notes` state is what actually drives the bug either way.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CloseAuditConfirm, type CloseOutcome } from "./AuditSidebarPanel";
import type { AuditFinding } from "@/api/auditTypes";

function renderConfirm(
  onConfirm: (
    notes: string,
    pendingResolution: "accept" | "reject",
  ) => Promise<CloseOutcome>,
  stickyKey: string,
) {
  render(
    <CloseAuditConfirm
      kind="audit"
      stickyKey={stickyKey}
      pendingActionable={0}
      pendingFindings={[] as AuditFinding[]}
      saving={false}
      onCancel={vi.fn()}
      onConfirm={onConfirm}
    />,
  );
}

beforeEach(() => {
  try {
    window.localStorage?.clear();
  } catch {
    /* no localStorage in this env — fine */
  }
});

describe("CloseAuditConfirm — note handling on close", () => {
  it("keeps the typed note when onConfirm reports a blocked outcome (e.g. dirty draft)", async () => {
    const onConfirm = vi.fn().mockResolvedValue("dirty-draft" as CloseOutcome);
    renderConfirm(onConfirm, "sticky:blocked");

    const textarea = screen.getByPlaceholderText(
      "optional close note",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "my careful close note" } });

    fireEvent.click(screen.getByRole("button", { name: /finalize review/i }));
    await Promise.resolve();
    await Promise.resolve();

    expect(onConfirm).toHaveBeenCalledWith("my careful close note", "reject");
    expect(textarea.value).toBe("my careful close note");
  });

  it("also keeps the note when onConfirm reports an already-finalized/409 block", async () => {
    const onConfirm = vi.fn().mockResolvedValue("blocked" as CloseOutcome);
    renderConfirm(onConfirm, "sticky:already-finalized");

    const textarea = screen.getByPlaceholderText(
      "optional close note",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "note that must survive" } });

    fireEvent.click(screen.getByRole("button", { name: /finalize review/i }));
    await Promise.resolve();
    await Promise.resolve();

    expect(textarea.value).toBe("note that must survive");
  });

  it("clears the note only when onConfirm reports a successful close", async () => {
    const onConfirm = vi.fn().mockResolvedValue("closed" as CloseOutcome);
    renderConfirm(onConfirm, "sticky:closed");

    const textarea = screen.getByPlaceholderText(
      "optional close note",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "done and dusted" } });

    fireEvent.click(screen.getByRole("button", { name: /finalize review/i }));
    await Promise.resolve();
    await Promise.resolve();

    expect(textarea.value).toBe("");
  });
});
