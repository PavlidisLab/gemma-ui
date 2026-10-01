/**
 * What the commit writes into `FACTOR_VALUE.VALUE` — the free-text
 * field the curator owns.
 *
 * 🛑 `free_text_label` is seeded `summary || value` (`composeDesign`),
 * and `summary` is Gemma's own rendering of the statements: unbounded,
 * while the column is `VARCHAR(255)`. Sending it back both overflowed
 * the column — experiment 38401, a commit that only deleted
 * statements, `500 … Data truncation: Data too long for column 'VALUE'`
 * — and, under 255, filled an empty curator field with a rendering of
 * the statements.
 *
 * These pin the three cases: a new value sends its label, an edited
 * label goes out, and an untouched value echoes what Gemma stores and
 * never the rendering.
 */
import { describe, expect, it } from "vitest";

import { buildCurationDocument, type CommittableDesign } from "./curationCommit";

/** 38401's shape: a rendering far past the column, nothing stored. */
const SUMMARY_318 = "Influenza A virus delivered to mother, ".repeat(8).slice(0, 318);

const SERVED: CommittableDesign = {
  factors: [
    {
      id: 44,
      gemma_factor_id: 44,
      name: "disease",
      factor_values: [
        {
          // Gemma renders the statements; the stored field is empty.
          id: 283872,
          free_text_label: SUMMARY_318,
          gemma_free_text_value: null,
        },
        {
          // A value whose label the curator really did write.
          id: 283873,
          free_text_label: "uninfected control",
          gemma_free_text_value: "uninfected control",
        },
      ],
    },
  ],
  tags: [],
};

const valuesOf = (design: CommittableDesign, baseline = SERVED) =>
  buildCurationDocument(design, { mode: "remote", baseline }).design?.factors
    ?.items?.[0].factorValues?.items ?? [];

/** The served design with one factor value rewritten. */
function edited(
  id: number,
  patch: Partial<NonNullable<
    NonNullable<CommittableDesign["factors"]>[number]["factor_values"]
  >[number]>,
): CommittableDesign {
  return {
    ...SERVED,
    factors: [
      {
        ...SERVED.factors![0],
        factor_values: SERVED.factors![0].factor_values!.map((v) =>
          v.id === id ? { ...v, ...patch } : v,
        ),
      },
    ],
  };
}

describe("an untouched value never sends Gemma's rendering back", () => {
  it("🛑 a 318-character summary over an empty stored value sends nothing", () => {
    const v = valuesOf(SERVED)[0];
    expect(v.gemmaId).toBe(283872);
    expect(v.freeTextLabel).toBeUndefined();
  });

  it("echoes the stored value verbatim where Gemma has one", () => {
    expect(valuesOf(SERVED)[1].freeTextLabel).toBe("uninfected control");
  });

  it("a statement edit does not drag the rendering onto the wire", () => {
    const design = edited(283872, {
      statements: [{ gemma_id: 56986136, subject: { label: "Influenza A virus" } }],
    });
    expect(valuesOf(design)[0].freeTextLabel).toBeUndefined();
  });
});

describe("the curator's own label still goes out", () => {
  it("an edited label is sent", () => {
    const design = edited(283872, { free_text_label: "maternal influenza" });
    expect(valuesOf(design)[0].freeTextLabel).toBe("maternal influenza");
  });

  it("a label edited on a value that already had one is sent", () => {
    const design = edited(283873, { free_text_label: "sham control" });
    expect(valuesOf(design)[1].freeTextLabel).toBe("sham control");
  });

  it("a value Gemma never issued sends its label", () => {
    const design: CommittableDesign = {
      ...SERVED,
      factors: [
        {
          ...SERVED.factors![0],
          factor_values: [
            ...SERVED.factors![0].factor_values!,
            { id: 283899, free_text_label: "vehicle" },
          ],
        },
      ],
    };
    const added = valuesOf(design)[2];
    expect(added.gemmaId).toBeUndefined();
    expect(added.freeTextLabel).toBe("vehicle");
  });
});

describe("edges", () => {
  it("a cleared label leaves the stored value alone rather than sending an empty one", () => {
    const design = edited(283873, { free_text_label: "" });
    // Known limitation, documented on `freeTextLabelField`: emptying the
    // field does not clear the column.
    expect(valuesOf(design)[1].freeTextLabel).toBe("uninfected control");
  });

  it("whitespace-only is not an edit", () => {
    const design = edited(283873, { free_text_label: "  uninfected control  " });
    expect(valuesOf(design)[1].freeTextLabel).toBe("uninfected control");
  });

  it("with no baseline design in hand, an existing value still sends no rendering", () => {
    // The sign is all the identity there is (see `commitTarget`), and
    // with nothing to diff against, an unedited label cannot be told
    // from an edited one — so the stored value is what goes out.
    const values = buildCurationDocument(SERVED, { mode: "remote" }).design
      ?.factors?.items?.[0].factorValues?.items ?? [];
    expect(values[0].freeTextLabel).toBeUndefined();
    expect(values[1].freeTextLabel).toBe("uninfected control");
  });
});
