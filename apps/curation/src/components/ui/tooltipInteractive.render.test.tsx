/**
 * @vitest-environment jsdom
 *
 * Interaction tests for the ``interactive`` Tooltip mode.
 *
 * Spec (the reason the mode exists — a long GEO protocol in a
 * ``max-h-80 overflow-auto`` bubble the curator has to scroll):
 *   - interactive: the bubble survives the cursor leaving the
 *     trigger long enough to be entered, and stays up while the
 *     cursor is inside it
 *   - interactive: a scroll originating INSIDE the bubble does not
 *     close it; a scroll elsewhere still does
 *   - interactive: leaving the bubble closes it
 *   - default (non-interactive): mouseleave still closes at once,
 *     and the bubble stays pointer-events-none so it can't swallow
 *     clicks on whatever it covers
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tooltip } from "./Tooltip";

const OPEN_DELAY_MS = 150;
const CLOSE_DELAY_MS = 160;

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function openTooltip(trigger: HTMLElement) {
  fireEvent.mouseEnter(trigger);
  advance(OPEN_DELAY_MS + 1);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Tooltip — interactive mode", () => {
  function renderInteractive() {
    render(
      <Tooltip
        interactive
        wide
        label={
          <div data-testid="body" className="max-h-80 overflow-auto">
            long protocol prose
          </div>
        }
      >
        <span data-testid="trigger">growth (GEO)</span>
      </Tooltip>,
    );
    return screen.getByTestId("trigger");
  }

  it("keeps the bubble alive while the cursor crosses into it", () => {
    const trigger = renderInteractive();
    openTooltip(trigger);
    expect(screen.getByRole("tooltip")).toBeTruthy();

    // Cursor leaves the trigger for the gap — grace period starts.
    fireEvent.mouseLeave(trigger);
    advance(CLOSE_DELAY_MS - 20);
    const bubble = screen.getByRole("tooltip");

    // …and reaches the bubble before the grace expires.
    fireEvent.mouseEnter(bubble);
    advance(CLOSE_DELAY_MS * 4);
    expect(screen.queryByRole("tooltip")).toBeTruthy();
  });

  it("closes once the grace period expires without an entry", () => {
    const trigger = renderInteractive();
    openTooltip(trigger);
    fireEvent.mouseLeave(trigger);
    advance(CLOSE_DELAY_MS + 1);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("ignores a scroll that starts inside the bubble", () => {
    const trigger = renderInteractive();
    openTooltip(trigger);
    fireEvent.scroll(screen.getByTestId("body"));
    expect(screen.queryByRole("tooltip")).toBeTruthy();
  });

  it("still closes on a scroll elsewhere on the page", () => {
    const trigger = renderInteractive();
    openTooltip(trigger);
    fireEvent.scroll(document);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("closes when the cursor leaves the bubble", () => {
    const trigger = renderInteractive();
    openTooltip(trigger);
    const bubble = screen.getByRole("tooltip");
    fireEvent.mouseEnter(bubble);
    fireEvent.mouseLeave(bubble);
    advance(CLOSE_DELAY_MS + 1);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("takes pointer events so the scrollbar is reachable", () => {
    const trigger = renderInteractive();
    openTooltip(trigger);
    const cls = screen.getByRole("tooltip").className;
    expect(cls).toContain("pointer-events-auto");
    expect(cls).toContain("max-w-md");
  });
});

describe("Tooltip — default mode is unchanged", () => {
  function renderPlain() {
    render(
      <Tooltip label="AI judge says this proposal is strong">
        <span data-testid="trigger">●</span>
      </Tooltip>,
    );
    return screen.getByTestId("trigger");
  }

  it("closes immediately on mouseleave — no grace period", () => {
    const trigger = renderPlain();
    openTooltip(trigger);
    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("stays pointer-events-none and narrow", () => {
    const trigger = renderPlain();
    openTooltip(trigger);
    const cls = screen.getByRole("tooltip").className;
    expect(cls).toContain("pointer-events-none");
    expect(cls).toContain("max-w-[280px]");
  });
});
