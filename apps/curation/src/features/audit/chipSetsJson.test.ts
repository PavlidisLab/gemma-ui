import { describe, expect, it } from "vitest";
import * as chipModule from "./dispositionChips";
import type { DialogChip } from "./DismissDialog";
import generated from "../../../generated/chipSets.json";

/**
 * `generated/chipSets.json` is what the agents-side chip-usage report
 * reads (it used to regex-parse `dispositionChips.ts`). A generated
 * file that silently goes stale is worse than no generated file: the
 * report would keep answering, just about last week's vocabulary, and
 * "offered but never picked" would quietly omit new chips.
 *
 * So this fails the gate when the two disagree. Fix is one command:
 *
 *     npm run emit:chip-sets
 */

type Sets = Record<string, DialogChip[]>;

/** Every exported chip array, grouped by array IDENTITY — so a
 *  deprecated alias lands in the same group as the set it points at
 *  rather than looking like a second set. */
function liveGroups(): { names: string[]; chips: DialogChip[] }[] {
  const groups = new Map<unknown, string[]>();
  for (const [name, value] of Object.entries(chipModule)) {
    if (!Array.isArray(value)) continue;
    if (!value.every((c) => c && typeof c.key === "string")) continue;
    groups.set(value, [...(groups.get(value) ?? []), name]);
  }
  return [...groups].map(([chips, names]) => ({
    names,
    chips: chips as DialogChip[],
  }));
}

const shape = (chips: DialogChip[]) =>
  chips.map((c) => [c.key, c.label, c.help, c.added]);

describe("generated/chipSets.json", () => {
  const emitted = generated.sets as unknown as Sets;
  const aliases = generated.aliases as Record<string, string>;

  it("emits exactly one name per set, with the rest recorded as aliases", () => {
    // 🛑 Not a formality. An ESM namespace object sorts its keys, so
    // iteration order crowns `CAL_MISS_DISMISS_CHIPS` (deprecated)
    // over `CAL_MISS_FACTOR_DISMISS_CHIPS` — deterministically the
    // wrong way round. The emitter takes canonical from the source
    // declaration; this checks the outcome, not the mechanism.
    for (const { names } of liveGroups()) {
      const asSets = names.filter((n) => n in emitted);
      expect(asSets, `${names.join(" / ")} — expected exactly one set`).toHaveLength(1);
      for (const other of names.filter((n) => n !== asSets[0])) {
        expect(aliases[other]).toBe(asSets[0]);
      }
    }
  });

  it("matches the chip sets in dispositionChips.ts", () => {
    const liveNames = liveGroups()
      .map((g) => g.names.find((n) => n in emitted)!)
      .sort();
    // Compare set names first — a missing set gives a far more
    // readable failure than a deep-equal dump of 93 chips.
    expect(Object.keys(emitted).sort()).toEqual(liveNames);
    for (const { names, chips } of liveGroups()) {
      const name = names.find((n) => n in emitted)!;
      expect(
        shape(emitted[name]),
        `${name} differs — run \`npm run emit:chip-sets\``,
      ).toEqual(shape(chips));
    }
  });

  it("keeps the known deprecated alias pointing at the real set", () => {
    expect(aliases.CAL_MISS_DISMISS_CHIPS).toBe("CAL_MISS_FACTOR_DISMISS_CHIPS");
    expect(Object.keys(emitted)).not.toContain("CAL_MISS_DISMISS_CHIPS");
  });

  it("every chip carries an `added` date", () => {
    // The reason the field exists: a chip younger than the
    // dispositions being tallied cannot have been refused, so
    // "offered but never picked" is unreadable without it.
    for (const { names, chips } of liveGroups()) {
      for (const c of chips) {
        expect(c.added, `${names[0]}.${c.key} has no 'added' date`).toMatch(
          /^\d{4}-\d{2}-\d{2}$/,
        );
      }
    }
  });
});
