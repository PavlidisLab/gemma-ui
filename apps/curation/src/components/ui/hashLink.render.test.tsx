/**
 * @vitest-environment jsdom
 *
 * A link that is a link. The point of `HashLink` is that the browser's
 * own affordances work on it — so the tests are about which clicks it
 * takes over and which it must not.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HashLink } from "./HashLink";

const nav = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@/routes", () => ({
  navigate: (t: string) => nav.calls.push(t),
}));

describe("HashLink", () => {
  beforeEach(() => {
    cleanup();
    nav.calls = [];
  });

  it("🛑 is a real anchor with an href — that is what makes 'open in new tab' exist", () => {
    render(<HashLink to="#/">Dashboard</HashLink>);
    const a = screen.getByText("Dashboard").closest("a");
    expect(a).toBeTruthy();
    // A button with an onClick offers the browser nothing to open.
    expect(a!.getAttribute("href")).toBe("#/");
  });

  it("handles a plain left click itself, so the draft guard still runs", () => {
    render(<HashLink to="#/tickets/5">Ticket</HashLink>);
    const e = fireEvent.click(screen.getByText("Ticket"), { button: 0 });
    expect(e).toBe(false); // preventDefault() was called
    expect(nav.calls).toEqual(["#/tickets/5"]);
  });

  it.each([
    ["metaKey", { metaKey: true }],
    ["ctrlKey", { ctrlKey: true }],
    ["shiftKey", { shiftKey: true }],
    ["altKey", { altKey: true }],
  ])("lets a %s click through to the browser", (_name, mods) => {
    render(<HashLink to="#/">Dashboard</HashLink>);
    const e = fireEvent.click(screen.getByText("Dashboard"), {
      button: 0,
      ...mods,
    });
    // Not prevented, and NOT routed in this tab — the user asked for a
    // new one, and the current tab must stay where it is.
    expect(e).toBe(true);
    expect(nav.calls).toEqual([]);
  });

  it("lets a middle click through", () => {
    render(<HashLink to="#/">Dashboard</HashLink>);
    const e = fireEvent.click(screen.getByText("Dashboard"), { button: 1 });
    expect(e).toBe(true);
    expect(nav.calls).toEqual([]);
  });

  it("lets a target=_blank caller through", () => {
    render(
      <HashLink to="#/" target="_blank">
        Dashboard
      </HashLink>,
    );
    const e = fireEvent.click(screen.getByText("Dashboard"), { button: 0 });
    expect(e).toBe(true);
    expect(nav.calls).toEqual([]);
  });
});
