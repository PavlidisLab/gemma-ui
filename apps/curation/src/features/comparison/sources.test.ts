import { describe, expect, it } from "vitest";
import {
  defaultSlots,
  isPairAllowed,
  isPolishedSource,
  isSourceValidInSlot,
  modeOf,
  parseSource,
  polishedCuratorOf,
  polishedSourceFor,
  sourceLabel,
  sourceTooltip,
  runProvenanceOf,
  SYSTEM_SOURCES,
  type Source,
} from "./sources";

// Sample polished tokens used across the suite. These are content,
// not literals — any curator name should work the same way.
const CY: Source = "polished:cyan";
const AM: Source = "polished:amanda";
const JX: Source = "polished:jordan";

describe("slot validity", () => {
  it("rejects agent_proposal as a baseline", () => {
    expect(isSourceValidInSlot("baseline", "agent_proposal")).toBe(false);
  });

  it("rejects empty as a baseline (Paul 2026-05-29: preboard always exists)", () => {
    expect(isSourceValidInSlot("baseline", "empty")).toBe(false);
  });

  it("accepts every system + polished source as a baseline (except empty/agent_proposal)", () => {
    for (const s of SYSTEM_SOURCES) {
      if (s === "agent_proposal" || s === "empty") continue;
      expect(isSourceValidInSlot("baseline", s)).toBe(true);
    }
    expect(isSourceValidInSlot("baseline", CY)).toBe(true);
    expect(isSourceValidInSlot("baseline", JX)).toBe(true);
  });

  it("accepts every source as a comparator (including empty + arbitrary polished:*)", () => {
    for (const s of SYSTEM_SOURCES) {
      expect(isSourceValidInSlot("comparator", s)).toBe(true);
    }
    expect(isSourceValidInSlot("comparator", CY)).toBe(true);
    expect(isSourceValidInSlot("comparator", AM)).toBe(true);
  });
});

describe("pair rule", () => {
  it("rejects baseline=empty + comparator=preboard (conceptually muddled per spec)", () => {
    expect(isPairAllowed("empty", "preboard")).toBe(false);
  });

  it("accepts every other pair involving empty", () => {
    expect(isPairAllowed("empty", "empty")).toBe(true);
    expect(isPairAllowed("empty", CY)).toBe(true);
    expect(isPairAllowed("empty", AM)).toBe(true);
    expect(isPairAllowed("empty", "agent_proposal")).toBe(true);
    expect(isPairAllowed("preboard", "empty")).toBe(true);
  });

  it("accepts identity pairs (regression-test mode)", () => {
    expect(isPairAllowed(CY, CY)).toBe(true);
    expect(isPairAllowed("preboard", "preboard")).toBe(true);
  });

  it("accepts cross-curator pairs", () => {
    expect(isPairAllowed(CY, AM)).toBe(true);
    expect(isPairAllowed(JX, CY)).toBe(true);
  });
});

describe("modeOf", () => {
  it("classifies combinations across system + polished sources", () => {
    expect(modeOf("empty", "empty")).toBe("degenerate");
    expect(modeOf("empty", "agent_proposal")).toBe("proposal");
    expect(modeOf(CY, "empty")).toBe("bare");
    expect(modeOf(CY, "agent_proposal")).toBe("audit");
    expect(modeOf(CY, CY)).toBe("identity");
    expect(modeOf(CY, AM)).toBe("audit");
  });
});

describe("defaults", () => {
  it("review opens to first polished curator + agent proposal when one is loaded", () => {
    expect(defaultSlots("review", { polishedCurators: ["cyan", "amanda"] }))
      .toEqual({
        baseline: "polished:cyan",
        comparator: "agent_proposal",
      });
  });

  it("review falls back to live baseline (then preboard) when no polished pack is loaded", () => {
    // 2026-06-08: defaults now prefer `live` over `preboard` when
    // no availability map is supplied. Without an availability
    // hint defaultSlots treats live as available and picks it.
    expect(defaultSlots("review")).toEqual({
      baseline: "live",
      comparator: "agent_proposal",
    });
    expect(defaultSlots("review", { polishedCurators: [] })).toEqual({
      baseline: "live",
      comparator: "agent_proposal",
    });
    // When live is explicitly unavailable, defaults fall through
    // to preboard (the prior behaviour).
    expect(
      defaultSlots("review", {
        polishedCurators: [],
        availability: { live: { available: false } },
      }),
    ).toEqual({
      baseline: "preboard",
      comparator: "agent_proposal",
    });
  });

  it("edit opens to Gemma preboard + agent proposal", () => {
    expect(defaultSlots("edit")).toEqual({
      baseline: "preboard",
      comparator: "agent_proposal",
    });
    // Curators-list is ignored in edit mode — baseline is the
    // package-anchored preboard regardless.
    expect(defaultSlots("edit", { polishedCurators: ["cyan"] })).toEqual({
      baseline: "preboard",
      comparator: "agent_proposal",
    });
  });
});

describe("parseSource", () => {
  it("round-trips every system token", () => {
    for (const s of SYSTEM_SOURCES) {
      expect(parseSource(s)).toBe(s);
    }
  });

  it("round-trips polished tokens with arbitrary curator names", () => {
    expect(parseSource("polished:cyan")).toBe("polished:cyan");
    expect(parseSource("polished:amanda")).toBe("polished:amanda");
    expect(parseSource("polished:jordan-doe")).toBe("polished:jordan-doe");
  });

  it("treats any non-empty string as a valid opaque curation_id (step 3b)", () => {
    // 2026-06-08 step 3b: parseSource accepts any non-empty
    // string as a Source (the new opaque curation_id type).
    // Unknown tokens — UUIDs from the unified curation table,
    // future producer kinds, anything the local_api emits — all
    // resolve to themselves. Labels come from the /curations
    // lookup at render time.
    expect(parseSource("xyz")).toBe("xyz");
    expect(parseSource("550e8400-e29b-41d4-a716-446655440000"))
      .toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(parseSource("polished:")).toBe("polished:");
  });

  it("returns null on empty / null / undefined", () => {
    expect(parseSource("")).toBeNull();
    expect(parseSource("   ")).toBeNull();
    expect(parseSource(null)).toBeNull();
    expect(parseSource(undefined)).toBeNull();
  });
});

describe("polished helpers", () => {
  it("isPolishedSource matches any polished:* token", () => {
    expect(isPolishedSource(CY)).toBe(true);
    expect(isPolishedSource(AM)).toBe(true);
    expect(isPolishedSource(JX)).toBe(true);
    expect(isPolishedSource("preboard")).toBe(false);
    expect(isPolishedSource("agent_proposal")).toBe(false);
    expect(isPolishedSource("empty")).toBe(false);
  });

  it("polishedCuratorOf extracts the username", () => {
    expect(polishedCuratorOf(CY)).toBe("cyan");
    expect(polishedCuratorOf(AM)).toBe("amanda");
    expect(polishedCuratorOf("polished:jordan-doe")).toBe("jordan-doe");
    expect(polishedCuratorOf("preboard")).toBe("");
  });

  it("polishedSourceFor builds a token", () => {
    expect(polishedSourceFor("cyan")).toBe("polished:cyan");
    expect(polishedSourceFor("jordan-doe")).toBe("polished:jordan-doe");
  });
});

describe("sourceLabel", () => {
  it("labels system sources", () => {
    expect(sourceLabel("empty")).toBe("(empty)");
    // 2026-06-08: preboard relabeled "Gemma preboard" (was
    // "Gemma" — misleading because the preboard is the GEO-only
    // pre-curation snapshot, not Gemma's live curation state).
    expect(sourceLabel("preboard")).toBe("Gemma preboard");
    // 2026-06-12: dropped "(live)" qualifier — chip strip fetches a
    // snapshot, not a stream; the label was misleading. Agent's
    // /curations ``label`` field is the canonical name source; this
    // fallback only fires when label is empty.
    expect(sourceLabel("live")).toBe("Gemma");
    expect(sourceLabel("agent_proposal")).toBe("agent proposal");
  });

  it("uses the curation row's label when available (step 3b)", () => {
    // Opaque curation_id resolves via the /curations list when
    // passed in.
    const curations = [
      {
        curation_id: "uuid-abc-123",
        label: "Strict consensus (cy+am)",
        producer: "consensus:strict_cy_am",
        source_kind: "consensus",
      },
    ];
    expect(sourceLabel("uuid-abc-123", curations))
      .toBe("Strict consensus (cy+am)");
    // Agent runs render as "agent <sha>" (drop the redundant
    // "(agent_proposal)" kind) when label is empty.
    const curationsNoLabel = [
      {
        curation_id: "uuid-xyz",
        label: "",
        producer: "agent:run-42",
        source_kind: "agent_proposal",
      },
    ];
    expect(sourceLabel("uuid-xyz", curationsNoLabel))
      .toBe("agent run-42");
    // Unknown id falls through to legacy enum path.
    expect(sourceLabel("preboard", curations)).toBe("Gemma preboard");
  });

  it("title-cases the curator name for polished sources", () => {
    expect(sourceLabel(CY)).toBe("Cyan polished");
    expect(sourceLabel(AM)).toBe("Amanda polished");
    expect(sourceLabel("polished:jordan-doe")).toBe("Jordan-Doe polished");
    expect(sourceLabel("polished:cy")).toBe("Cy polished");
  });

  it("renders 'agent <sha> <m/d>' for the boss-critic-200 / GSE14910 case", () => {
    // The headline self-documenting case: run sha d8a1725, run date
    // 2026-06-13. Producer carries the sha; created_at supplies M/D.
    const curations = [
      {
        curation_id: "agent_proposal:audit-1",
        label: "",
        producer: "agent:d8a1725",
        source_kind: "agent_proposal",
        created_at: "2026-06-13T15:16:26.516670",
        metadata: {
          run_provenance: {
            run_id: "2026-06-13_boss_critic_200gse",
            run_sha: "d8a1725",
            ran_at: "2026-06-13T15:16:26.516670",
            model: "claude-sonnet-4-6",
            batch_id: "boss-critic-200gse-2026-06-13",
            git_describe: "pre-boss-critic-2026-06-13-2-gd8a1725-dirty",
            git_dirty: true,
          },
        },
      },
    ];
    expect(sourceLabel("agent_proposal:audit-1", curations)).toBe(
      "agent d8a1725 6/13",
    );
  });
});

describe("sourceTooltip — self-documenting run provenance", () => {
  const curations = [
    {
      curation_id: "agent_proposal:audit-1",
      label: "agent d8a1725 6/13",
      producer: "agent:d8a1725",
      source_kind: "agent_proposal",
      created_at: "2026-06-13T15:16:26.516670",
      metadata: {
        run_provenance: {
          run_id: "2026-06-13_boss_critic_200gse",
          run_sha: "d8a1725",
          ran_at: "2026-06-13T15:16:26.516670",
          model: "claude-sonnet-4-6",
          batch_id: "boss-critic-200gse-2026-06-13",
          git_describe: "pre-boss-critic-2026-06-13-2-gd8a1725-dirty",
          git_dirty: true,
        },
      },
    },
  ];

  it("surfaces the full run identity on hover", () => {
    const tip = sourceTooltip("agent_proposal:audit-1", curations);
    expect(tip).toContain("run id: 2026-06-13_boss_critic_200gse");
    expect(tip).toContain("sha: d8a1725");
    expect(tip).toContain("model: claude-sonnet-4-6");
    expect(tip).toContain("batch: boss-critic-200gse-2026-06-13");
    expect(tip).toContain("git describe: pre-boss-critic-2026-06-13-2-gd8a1725-dirty");
    expect(tip).toContain("git: dirty (uncommitted changes)");
  });

  it("returns empty string when no provenance / no curations", () => {
    expect(sourceTooltip("agent_proposal:audit-1")).toBe("");
    expect(sourceTooltip("preboard", curations)).toBe("");
    const noProv = [
      {
        curation_id: "x",
        label: "agent",
        producer: "agent",
        source_kind: "agent_proposal",
      },
    ];
    expect(sourceTooltip("x", noProv)).toBe("");
  });

  it("runProvenanceOf reads the block defensively", () => {
    expect(runProvenanceOf(curations[0])?.run_sha).toBe("d8a1725");
    expect(runProvenanceOf(undefined)).toBeNull();
    expect(runProvenanceOf({ curation_id: "y" })).toBeNull();
    expect(
      runProvenanceOf({ curation_id: "y", metadata: { foo: 1 } }),
    ).toBeNull();
  });
});
