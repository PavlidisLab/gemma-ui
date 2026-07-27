import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FvDisplayRow, type FvDisplayLike } from "@gemma/ontology";

/**
 * Regression tests locking the ``suppressSampleCount`` prop's contract
 * on ``FvDisplayRow`` (2026-06-15).
 *
 * Spec (design review):
 *   "the number of samples should be shown ONCE and in the MIDDLE"
 *
 * The per-side ``(N)`` count badge that ``FvDisplayRow`` renders by
 * default is correct in standalone surfaces (the design editor, the
 * proposal review). Inside ``FactorComparisonGrid`` it's a duplicate
 * — the grid's middle column already carries the count once. The
 * prop ``suppressSampleCount`` flips off the trailing ``(N)`` for
 * those callers.
 *
 * Contract:
 *   - default (prop omitted)        → ``(N)`` rendered when N > 0
 *   - ``suppressSampleCount={true}``→ no ``(N)`` even when N > 0
 *   - ``suppressSampleCount={false}``→ same as default
 *   - N = 0                         → never rendered (independent of prop)
 */

const noopRenderer = ({ label }: { label: string }) => <span>{label}</span>;

function fv(opts: { count: number; label?: string }): FvDisplayLike {
  return {
    free_text_label: opts.label ?? "FV",
    statements: [],
    biomaterial_short_names: Array.from(
      { length: opts.count },
      (_, i) => `sample_${i}`,
    ),
    is_baseline: false,
  } as unknown as FvDisplayLike;
}

function render(props: Parameters<typeof FvDisplayRow>[0]) {
  return renderToStaticMarkup(<FvDisplayRow {...props} />);
}

describe("FvDisplayRow — suppressSampleCount prop", () => {
  describe("default behaviour (prop omitted) — count IS rendered", () => {
    it("renders `(12)` when fv carries 12 samples and prop is omitted", () => {
      const html = render({ fv: fv({ count: 12 }), termRenderer: noopRenderer });
      expect(html).toContain("(12)");
    });

    it("renders `(6)` for 6 samples — exact count present in markup", () => {
      const html = render({ fv: fv({ count: 6 }), termRenderer: noopRenderer });
      expect(html).toContain("(6)");
    });
  });

  describe("suppressSampleCount=true — count is SUPPRESSED", () => {
    it("does NOT render `(12)` when prop is true and fv has 12 samples", () => {
      const html = render({
        fv: fv({ count: 12 }),
        termRenderer: noopRenderer,
        suppressSampleCount: true,
      });
      expect(html).not.toContain("(12)");
    });

    it("does NOT render `(1)` when prop is true and fv has 1 sample", () => {
      const html = render({
        fv: fv({ count: 1 }),
        termRenderer: noopRenderer,
        suppressSampleCount: true,
      });
      expect(html).not.toContain("(1)");
    });

    it("suppresses for any positive N", () => {
      for (const n of [1, 2, 3, 50, 1234]) {
        const html = render({
          fv: fv({ count: n }),
          termRenderer: noopRenderer,
          suppressSampleCount: true,
        });
        expect(html, `n=${n}`).not.toContain(`(${n})`);
      }
    });
  });

  describe("suppressSampleCount=false — same as default", () => {
    it("renders `(8)` when prop is explicitly false", () => {
      const html = render({
        fv: fv({ count: 8 }),
        termRenderer: noopRenderer,
        suppressSampleCount: false,
      });
      expect(html).toContain("(8)");
    });
  });

  describe("N = 0 — never rendered regardless of prop", () => {
    it("no `(0)` when count is 0 and prop is omitted", () => {
      const html = render({ fv: fv({ count: 0 }), termRenderer: noopRenderer });
      expect(html).not.toContain("(0)");
    });

    it("no `(0)` when count is 0 and prop is true", () => {
      const html = render({
        fv: fv({ count: 0 }),
        termRenderer: noopRenderer,
        suppressSampleCount: true,
      });
      expect(html).not.toContain("(0)");
    });
  });
});
