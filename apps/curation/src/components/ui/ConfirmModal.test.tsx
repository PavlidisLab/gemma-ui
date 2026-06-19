import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfirmModal } from "./ConfirmModal";

/**
 * Render-to-markup tests for ConfirmModal.
 *
 * Spec:
 *   - open={false} → renders nothing
 *   - open={true}  → title + body + both button labels present
 *   - confirm button carries destructive styling (rose-600) when
 *     destructive={true} (the default)
 *   - confirm button carries primary-only styling when
 *     destructive={false}
 *   - cancel button carries the ghost class
 *
 * NOT tested here (requires Playwright / browser interaction):
 *   - Escape key fires onCancel (keydown event listener)
 *   - click-outside fires onCancel (click on overlay)
 *   - initial focus lands on the confirm button (focus management)
 */

const noop = () => {};

function render(props: Parameters<typeof ConfirmModal>[0]) {
  return renderToStaticMarkup(<ConfirmModal {...props} />);
}

describe("ConfirmModal", () => {
  describe("closed state (open=false)", () => {
    it("renders nothing when open is false", () => {
      const html = render({
        open: false,
        title: "Delete experiment",
        body: "This cannot be undone.",
        onConfirm: noop,
        onCancel: noop,
      });
      expect(html).toBe("");
    });
  });

  describe("open state — structural presence", () => {
    it("renders the title text in the markup", () => {
      const html = render({
        open: true,
        title: "Remove all factors",
        body: "All factor values will be removed.",
        onConfirm: noop,
        onCancel: noop,
      });
      expect(html).toContain("Remove all factors");
    });

    it("renders the body text in the markup", () => {
      const html = render({
        open: true,
        title: "Confirm delete",
        body: "This experiment will be permanently removed.",
        onConfirm: noop,
        onCancel: noop,
      });
      expect(html).toContain(
        "This experiment will be permanently removed.",
      );
    });

    it("renders the confirm button with the provided confirmLabel", () => {
      const html = render({
        open: true,
        title: "Reset design",
        body: "Resets to the server version.",
        confirmLabel: "Yes, reset",
        onConfirm: noop,
        onCancel: noop,
      });
      expect(html).toContain("Yes, reset");
    });

    it("renders the cancel button with the provided cancelLabel", () => {
      const html = render({
        open: true,
        title: "Reset design",
        body: "Resets to the server version.",
        cancelLabel: "Never mind",
        onConfirm: noop,
        onCancel: noop,
      });
      expect(html).toContain("Never mind");
    });

    it("uses default confirmLabel='delete' and cancelLabel='cancel' when not supplied", () => {
      const html = render({
        open: true,
        title: "Confirm",
        body: "Are you sure?",
        onConfirm: noop,
        onCancel: noop,
      });
      expect(html).toContain("delete");
      expect(html).toContain("cancel");
    });
  });

  describe("button styling", () => {
    it("confirm button has destructive rose-600 class when destructive=true (default)", () => {
      const html = render({
        open: true,
        title: "Confirm",
        body: "?",
        onConfirm: noop,
        onCancel: noop,
        destructive: true,
      });
      // The component applies `!bg-rose-600` on the confirm button
      // for destructive actions to override the primary blue.
      expect(html).toContain("!bg-rose-600");
    });

    it("confirm button does NOT have rose-600 class when destructive=false", () => {
      const html = render({
        open: true,
        title: "Confirm",
        body: "?",
        onConfirm: noop,
        onCancel: noop,
        destructive: false,
      });
      expect(html).not.toContain("!bg-rose-600");
    });

    it("confirm button carries the 'btn primary' class regardless of destructive flag", () => {
      const htmlDestructive = render({
        open: true,
        title: "Confirm",
        body: "?",
        onConfirm: noop,
        onCancel: noop,
        destructive: true,
      });
      const htmlSafe = render({
        open: true,
        title: "Confirm",
        body: "?",
        onConfirm: noop,
        onCancel: noop,
        destructive: false,
      });
      // Both should carry "btn primary" — the destructive variant
      // just adds !bg-rose-600 on top.
      expect(htmlDestructive).toContain("btn primary");
      expect(htmlSafe).toContain("btn primary");
    });

    it("cancel button carries the 'ghost' class", () => {
      const html = render({
        open: true,
        title: "Confirm",
        body: "?",
        onConfirm: noop,
        onCancel: noop,
      });
      expect(html).toContain("btn ghost");
    });
  });

  describe("accessibility attributes", () => {
    it("dialog element has role=dialog and aria-modal=true", () => {
      const html = render({
        open: true,
        title: "Confirm",
        body: "?",
        onConfirm: noop,
        onCancel: noop,
      });
      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
    });

    it("title element has id=confirm-title matching aria-labelledby", () => {
      const html = render({
        open: true,
        title: "Accessibility title",
        body: "?",
        onConfirm: noop,
        onCancel: noop,
      });
      expect(html).toContain('id="confirm-title"');
      expect(html).toContain('aria-labelledby="confirm-title"');
    });
  });
});
