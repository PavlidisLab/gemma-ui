/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { DispositionPicker } from "./DispositionPicker";

describe("DispositionPicker — the unsure state", () => {
  it("is off by default, so a genuinely binary screen doesn't grow a third option", () => {
    render(<DispositionPicker value={null} onChange={() => {}} />);
    expect(screen.queryByText("Unsure")).toBeNull();
  });

  // A reasonless `unsure` is indistinguishable from "not looked at" to
  // whoever picks the pile up — which is the exact distinction the
  // state exists to make. So it asks, rather than setting on click.
  it("does not set unsure on click — it asks why first", () => {
    const onChange = vi.fn();
    render(<DispositionPicker value={null} onChange={onChange} showUnsure />);
    fireEvent.click(screen.getByText("Unsure"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("Why can't you resolve it?")).toBeInTheDocument();
  });

  it("commits with the preset as the reason — one click to satisfy", () => {
    const onChange = vi.fn();
    render(
      <DispositionPicker
        value={null}
        onChange={onChange}
        showUnsure
        unsureReasons={["Can't tell from the abstract"]}
      />,
    );
    fireEvent.click(screen.getByText("Unsure"));
    fireEvent.click(screen.getByText("Can't tell from the abstract"));
    expect(onChange).toHaveBeenCalledWith(
      "unsure",
      "Can't tell from the abstract",
    );
  });

  it("refuses a whitespace-only typed reason rather than storing an empty one", () => {
    const onChange = vi.fn();
    render(<DispositionPicker value={null} onChange={onChange} showUnsure />);
    fireEvent.click(screen.getByText("Unsure"));
    const input = screen.getByPlaceholderText("or type a reason…");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  // Same undo affordance as the other two sides — a misclick is one
  // click to take back, and it clears the reason with the decision.
  it("clears straight back to undecided from a lit unsure, no prompt", () => {
    const onChange = vi.fn();
    render(
      <DispositionPicker value="unsure" onChange={onChange} showUnsure />,
    );
    fireEvent.click(screen.getByText("Unsure"));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
