/**
 * The two pieces of arithmetic behind the three curation cards on the
 * Systems Monitoring page. Both are places where a plausible-looking
 * shortcut gives a confidently wrong number, which is why they are
 * pure functions with tests rather than inline expressions.
 */
import { describe, expect, it } from "vitest";

import { collectExperimentTargets } from "./api";
import { pct } from "./components/CountRow";

describe("collectExperimentTargets", () => {
  it("takes the experiment ids off a ticket", () => {
    // Ticket 5 as gemma2 serves it, 2026-08-29: one target, row id 5,
    // experiment 861. The row id must not be what lands in the set.
    const ids = collectExperimentTargets([
      {
        targets: [
          { targetType: "EXPRESSION_EXPERIMENT", targetId: 861 },
        ],
      },
    ]);
    expect([...ids]).toEqual([861]);
  });

  it("🛑 ignores the non-experiment targets riding along", () => {
    // `targetType=EXPRESSION_EXPERIMENT` selects TICKETS that include
    // an experiment; the matched ticket still arrives with all its
    // other targets. Counting the page's targets instead of its
    // experiment targets turns one dataset into three.
    const ids = collectExperimentTargets([
      {
        targets: [
          { targetType: "EXPRESSION_EXPERIMENT", targetId: 861 },
          { targetType: "ARRAY_DESIGN", targetId: 4 },
          { targetType: "FACTOR_VALUE", targetId: 99 },
        ],
      },
    ]);
    expect([...ids]).toEqual([861]);
  });

  it("counts an experiment on two tickets once", () => {
    const ids = collectExperimentTargets([
      { targets: [{ targetType: "EXPRESSION_EXPERIMENT", targetId: 861 }] },
      { targets: [{ targetType: "EXPRESSION_EXPERIMENT", targetId: 861 }] },
      { targets: [{ targetType: "EXPRESSION_EXPERIMENT", targetId: 36052 }] },
    ]);
    expect(ids.size).toBe(2);
  });

  it("accumulates across pages into one set", () => {
    const acc = new Set<number>();
    collectExperimentTargets(
      [{ targets: [{ targetType: "EXPRESSION_EXPERIMENT", targetId: 1 }] }],
      acc,
    );
    collectExperimentTargets(
      [{ targets: [{ targetType: "EXPRESSION_EXPERIMENT", targetId: 2 }] }],
      acc,
    );
    expect([...acc].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("survives the shapes a wire can actually hand it", () => {
    expect(
      collectExperimentTargets([
        {},
        { targets: null },
        { targets: [] },
        { targets: [{ targetType: "EXPRESSION_EXPERIMENT" }] },
      ]).size,
    ).toBe(0);
  });
});

describe("pct", () => {
  it("reads as a share of the total", () => {
    // The corpus split as measured 2026-08-29.
    expect(pct(23549, 25695)).toBe("92%");
    expect(pct(2146, 25695)).toBe("8.4%");
  });

  it("🛑 says nothing rather than 0% when there is no total", () => {
    // A "0%" and a "we could not divide" must not render identically —
    // one is a measurement, the other is a missing denominator.
    expect(pct(4, undefined)).toBe(null);
    expect(pct(4, 0)).toBe(null);
  });

  it("keeps a tiny non-zero share visible", () => {
    // 4 troubled of 25,695 is 0.016%, which rounds to 0.0% — and a
    // real problem must not display as none.
    expect(pct(4, 25695)).toBe("<0.1%");
    expect(pct(0, 25695)).toBe("0.0%");
  });
});
