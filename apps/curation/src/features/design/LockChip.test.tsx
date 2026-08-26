/**
 * @vitest-environment jsdom
 *
 * The chip warns and never gates. Fixtures are copied verbatim from
 * the live relay against sandbox 9001 rather than written by hand —
 * a hand-built fixture is how a reader ends up testing its own
 * assumptions instead of the server's shape.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CurationLock } from "@/api/curationLock";
import { LockChip, relativeSince } from "./LockChip";

/** Verbatim from GET /curation-lock/9001, snake_cased by the client. */
const FREE: CurationLock = {
  locked: false, locked_by: null, locked_at: null,
  expires_at: null, stolen_from: null, stolen_at: null,
};
const HELD: CurationLock = {
  locked: true, locked_by: "paul",
  locked_at: "2026-08-26T16:22:34.968+00:00",
  expires_at: "2026-08-26T16:52:34.968+00:00",
  stolen_from: null, stolen_at: null,
};
const STOLEN: CurationLock = {
  ...HELD, locked_by: "alice",
  stolen_from: "paul", stolen_at: "2026-08-26T16:22:34.998+00:00",
};

const body = () => document.body.textContent ?? "";

describe("what it shows", () => {
  it("says nothing when nobody holds it", () => {
    const { container } = render(<LockChip lock={FREE} me="paul" />);
    // An unlocked experiment is the ordinary case and needs no chip.
    expect(container).toBeEmptyDOMElement();
  });

  it("says nothing before the lock has loaded", () => {
    const { container } = render(<LockChip lock={null} me="paul" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("tells you when it is yours, with no take-over offered", () => {
    render(<LockChip lock={HELD} me="paul" onTakeOver={vi.fn()} />);
    expect(body()).toContain("Editing · you");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("names the other curator and when they last worked", () => {
    render(<LockChip lock={HELD} me="alice" />);
    expect(body()).toMatch(/paul is editing/);
    expect(body()).toMatch(/last change .* ago|just now/);
  });

  it("falls back to a vague holder rather than guessing a name", () => {
    // The 409 used to bury `lockedBy` inside a nested envelope. If it
    // ever goes missing again the chip must degrade, not invent.
    render(<LockChip lock={{ ...HELD, locked_by: null }} me="alice" />);
    expect(body()).toMatch(/Someone else is editing/);
    expect(body()).not.toMatch(/null|undefined/);
  });

  it("offers take-over, and says the other curator keeps their work", async () => {
    const onTakeOver = vi.fn();
    render(<LockChip lock={HELD} me="alice" onTakeOver={onTakeOver} />);
    const btn = screen.getByRole("button", { name: /take over/i });
    // Stealing destroys nothing — the other draft is a separate row.
    expect(btn.getAttribute("title")).toMatch(/not affected|survives/i);
    await userEvent.click(btn);
    expect(onTakeOver).toHaveBeenCalledTimes(1);
  });

  it("never disables anything — it warns, it does not gate", () => {
    // 🛑 The lock is advisory; `baseline.lastModified` is the contract.
    // A chip that greys out a control has become a permission check.
    render(<LockChip lock={HELD} me="alice" onTakeOver={vi.fn()} />);
    const disabled = screen.queryAllByRole("button").filter(
      (b) => (b as HTMLButtonElement).disabled,
    );
    expect(disabled).toHaveLength(0);
  });

  it("records a steal without making a fuss about it", () => {
    render(<LockChip lock={STOLEN} me="alice" />);
    expect(body()).toContain("Editing · you");
    // Provenance lives in the tooltip, not shouted in the chip.
    expect(screen.getByTitle(/took this from paul/i)).toBeTruthy();
  });
});

describe("relativeSince", () => {
  const now = new Date("2026-08-26T17:00:00Z");
  it("reads in the units a human decides in", () => {
    expect(relativeSince("2026-08-26T16:59:40Z", now)).toBe("just now");
    expect(relativeSince("2026-08-26T16:59:00Z", now)).toBe("1 min ago");
    expect(relativeSince("2026-08-26T16:34:00Z", now)).toBe("26 min ago");
    expect(relativeSince("2026-08-26T16:00:00Z", now)).toBe("1 hr ago");
    expect(relativeSince("2026-08-25T17:00:00Z", now)).toBe("1 day ago");
  });

  it("returns empty rather than 'Invalid Date' for junk or absence", () => {
    expect(relativeSince(null, now)).toBe("");
    expect(relativeSince("not a date", now)).toBe("");
  });
});
