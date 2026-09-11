/**
 * A characteristic recorded with NO value is kept, not dropped.
 *
 * `CHARACTERISTIC.VALUE` became NULL where it had been `''` (8,141 rows,
 * 2026-09-10). `foldCharacteristics` dropped any characteristic whose
 * value was falsy, which made a field the submitter DID record
 * indistinguishable from one they never mentioned — and where no sample
 * in a cohort carried a value, the column disappeared entirely.
 *
 * Measured on GSE20881: 3,942 of 11,363 characteristics come back with
 * `value: null` and `originalValue: 'nod 908:'` — GEO recorded the
 * field and left it empty. A blank is missing data, not an absence of
 * the question.
 */
import { describe, expect, it } from "vitest";
import { toSampleBiomaterials } from "./designFromGemma";

const wire = (chars: unknown[]) =>
  [
    {
      id: 1,
      name: "GSM1 title",
      accession: { accession: "GSM1" },
      sample: { id: 1, name: "GSE20881_Biomat_1|GSM1", characteristics: chars },
    },
  ] as never;

describe("a characteristic with no value", () => {
  it("keeps the category, as an empty string", () => {
    const [bm] = toSampleBiomaterials(wire([{ category: "nod 908", value: null }]));
    expect("nod 908" in bm.characteristics).toBe(true);
    expect(bm.characteristics["nod 908"]).toBe("");
  });

  it("is distinguishable from a category nobody recorded", () => {
    const [bm] = toSampleBiomaterials(wire([{ category: "nod 908", value: null }]));
    expect("octn2" in bm.characteristics).toBe(false);
  });

  it("never overwrites a real value on the same category", () => {
    // Order must not decide: a sibling row carrying the value wins
    // either way round.
    const [a] = toSampleBiomaterials(
      wire([
        { category: "sex", value: null },
        { category: "sex", value: "female" },
      ]),
    );
    expect(a.characteristics["sex"]).toBe("female");
    const [b] = toSampleBiomaterials(
      wire([
        { category: "sex", value: "female" },
        { category: "sex", value: null },
      ]),
    );
    expect(b.characteristics["sex"]).toBe("female");
  });

  it("still drops a row with no category at all", () => {
    const [bm] = toSampleBiomaterials(wire([{ category: null, value: null }]));
    expect(Object.keys(bm.characteristics)).toHaveLength(0);
  });
});
