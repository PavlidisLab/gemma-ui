/**
 * @vitest-environment jsdom
 *
 * `useContainerSize` against an element that is not in the first
 * render.
 *
 * That is the ordinary case, not an edge one: every card using this
 * hook puts its measured box in the final branch of a
 * loading/error/empty chain, so on a cold cache the spinner is what
 * mounts and the box arrives a render or two later. The hook has to
 * pick it up then.
 *
 * jsdom has no `ResizeObserver` and lays nothing out, so one is
 * installed here and driven by hand.
 *
 * NOT tested here: anything positional. Nothing in this file renders
 * pixels, so no measurement in it is a real one.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useContainerSize } from "@gemma/diagnostics";

/** Every live observer, so a test can fire one after the fact. */
type Observed = {
  el: Element;
  fire: (width: number, height: number) => void;
};
let observed: Observed[] = [];
let disconnects = 0;

class FakeResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(el: Element) {
    observed.push({
      el,
      fire: (width: number, height: number) =>
        this.cb(
          [{ target: el, contentRect: { width, height } }] as never,
          this as never,
        ),
    });
  }
  unobserve() {}
  disconnect() {
    disconnects += 1;
  }
}

/** A stand-in for the cards that use the hook: the measured box lives
 *  behind a loading state and only renders once `show` flips. */
function Probe({ show }: { show: boolean }) {
  const { ref, width, height } = useContainerSize<HTMLDivElement>();
  return (
    <>
      <span data-testid="size">{`${width}x${height}`}</span>
      {show ? (
        <div data-testid="box" ref={ref} />
      ) : (
        <span data-testid="loading">loading</span>
      )}
    </>
  );
}

beforeEach(() => {
  observed = [];
  disconnects = 0;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useContainerSize", () => {
  it("measures an element that first appears on a later render", () => {
    const { getByTestId, rerender } = render(<Probe show={false} />);
    // Nothing to watch yet, and the caller gets zeroes so it can pick
    // its own fallback.
    expect(observed).toHaveLength(0);
    expect(getByTestId("size")).toHaveTextContent("0x0");

    rerender(<Probe show={true} />);
    expect(observed).toHaveLength(1);
    expect(observed[0].el).toBe(getByTestId("box"));

    act(() => observed[0].fire(400, 612));
    rerender(<Probe show={true} />);
    expect(getByTestId("size")).toHaveTextContent("400x612");
  });

  it("measures an element that is there from the first render", () => {
    const { getByTestId } = render(<Probe show={true} />);
    expect(observed).toHaveLength(1);

    act(() => observed[0].fire(320, 240));
    expect(getByTestId("size")).toHaveTextContent("320x240");
  });

  it("ignores a zero measurement", () => {
    const { getByTestId } = render(<Probe show={true} />);
    act(() => observed[0].fire(400, 612));
    // A hidden tab measures 0x0; taking that would collapse whatever
    // the caller sized from it.
    act(() => observed[0].fire(0, 0));
    expect(getByTestId("size")).toHaveTextContent("400x612");
  });

  it("keeps following the element after a resize", () => {
    const { getByTestId } = render(<Probe show={true} />);
    act(() => observed[0].fire(400, 400));
    expect(getByTestId("size")).toHaveTextContent("400x400");
    act(() => observed[0].fire(400, 800));
    expect(getByTestId("size")).toHaveTextContent("400x800");
  });

  it("does not rebuild the observer on an unrelated re-render", () => {
    const { rerender } = render(<Probe show={true} />);
    rerender(<Probe show={true} />);
    rerender(<Probe show={true} />);
    // The returned ref keeps one identity across renders, so React
    // never detaches it and the effect never re-runs. A fresh callback
    // each render would tear the observer down and rebuild it here.
    expect(observed).toHaveLength(1);
    expect(disconnects).toBe(0);
  });

  it("disconnects when the element goes, and keeps the last size", () => {
    const { getByTestId, rerender } = render(<Probe show={true} />);
    act(() => observed[0].fire(400, 612));
    rerender(<Probe show={false} />);
    expect(disconnects).toBe(1);
    expect(getByTestId("size")).toHaveTextContent("400x612");
  });
});
