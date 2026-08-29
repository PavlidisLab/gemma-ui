import { describe, expect, it } from "vitest";
import { platformDisplay } from "./platformConstants";

// Real values from gemma2, 2026-08-26.
const GENERIC = { id: 736, shortName: "Generic_mouse_ncbiIds" };
const NOVASEQ = { id: 1, shortName: "GPL24247" };
const AFFY = { id: 2, shortName: "GPL571" };

describe("platformDisplay", () => {
  it("leads with the submitted platform and demotes Gemma's mapping", () => {
    // GSE217927: submitted on GPL24247, quantified onto the generic.
    const d = platformDisplay([GENERIC], [NOVASEQ]);
    expect(d.primary).toEqual([NOVASEQ]);
    expect(d.mappedTo).toEqual([GENERIC]);
  });

  it("🛑 empty originals means NOT SWITCHED — the platform in use leads", () => {
    // GSE11630 on GPL571: `?original=true` returns []. Treating that as
    // "unknown" would hide the platform entirely on such a dataset.
    const d = platformDisplay([AFFY], []);
    expect(d.primary).toEqual([AFFY]);
    expect(d.mappedTo).toEqual([]);
  });

  it("never claims a mapping when there was no switch", () => {
    // The pairing must not be "primary=originals, mappedTo=inUse"
    // unconditionally — that would print "mapped in Gemma to GPL571"
    // for a dataset whose data never moved.
    expect(platformDisplay([AFFY], []).mappedTo).toHaveLength(0);
    expect(platformDisplay([AFFY], null).mappedTo).toHaveLength(0);
    expect(platformDisplay([AFFY], undefined).mappedTo).toHaveLength(0);
  });

  it("keeps every platform on both sides — originals are a list", () => {
    const second = { id: 3, shortName: "GPL9185" };
    const d = platformDisplay([GENERIC], [NOVASEQ, second]);
    expect(d.primary).toEqual([NOVASEQ, second]);
    expect(d.mappedTo).toEqual([GENERIC]);
  });

  it("survives both sides being absent", () => {
    expect(platformDisplay(null, null)).toEqual({ primary: [], mappedTo: [] });
    expect(platformDisplay(undefined, undefined)).toEqual({
      primary: [],
      mappedTo: [],
    });
  });
});
