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
const CY: Source = "polished:curator-b";
const AM: Source = "polished:curator-a";
const JX: Source = "polished:jordan";

describe("slot validity", () => {
  it("rejects agent_proposal as a baseline", () => {
    expect(isSourceValidInSlot("baseline", "agent_proposal")).toBe(false);
  });

  it("rejects empty as a baseline (design review 2026-05-29: preboard always exists)", () => {
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
  // 2026-08-17: the review default was ``polishedCurators[0]`` — with no
  // availability check — so whichever row the store listed first became
  // the baseline. On eid 1658 /curation-versions returns three
  // ``consensus`` rows ahead of any curator polish, so a curator opened
  // a design and read "Viewing: strict consensus": a closed lane's
  // vocabulary, chosen by nobody. These pin the replacement.
  it("review opens on the curation as it stands, whatever the store lists first", () => {
    expect(
      defaultSlots("review", { polishedCurators: ["curator-b", "curator-a"] }),
    ).toEqual({ baseline: "current", comparator: "agent_proposal" });
  });

  it("never lets a consensus row become the default", () => {
    // The exact shape of the bug: consensus first in the list. Even if
    // one reaches this far (the offer is withdrawn upstream in
    // useSourceAvailability), it cannot be defaulted to.
    expect(
      defaultSlots("review", {
        polishedCurators: ["consensus_strict_consensus", "gold"],
      }),
    ).toEqual({ baseline: "current", comparator: "agent_proposal" });
  });

  it("review does not fall back to live or preboard", () => {
    // Was live → preboard. Both are pre-curation states; opening a
    // review on one puts the curator's own work last.
    for (const options of [
      undefined,
      { polishedCurators: [] },
      { polishedCurators: [], availability: { live: { available: false } } },
    ]) {
      expect(defaultSlots("review", options)).toEqual({
        baseline: "current",
        comparator: "agent_proposal",
      });
    }
  });

  it("edit still opens to Gemma preboard + agent proposal", () => {
    // Unchanged: edit flow is the calibration-package workflow, the one
    // case where a pre-curation snapshot IS the right baseline.
    expect(defaultSlots("edit")).toEqual({
      baseline: "preboard",
      comparator: "agent_proposal",
    });
    expect(defaultSlots("edit", { polishedCurators: ["curator-b"] })).toEqual({
      baseline: "preboard",
      comparator: "agent_proposal",
    });
  });

  it("edit falls through preboard → live → current, never to a listed row", () => {
    expect(
      defaultSlots("edit", {
        polishedCurators: ["consensus_strict_consensus"],
        availability: { preboard: { available: false } },
      }),
    ).toEqual({ baseline: "live", comparator: "agent_proposal" });
    expect(
      defaultSlots("edit", {
        polishedCurators: ["consensus_strict_consensus"],
        availability: {
          preboard: { available: false },
          live: { available: false },
        },
      }),
    ).toEqual({ baseline: "current", comparator: "agent_proposal" });
  });
});

describe("ticket-pinned baseline", () => {
  // A ticket declares the baseline its findings were computed
  // against; the strip must open there rather than on whichever
  // polished row happens to sort first. Handoff
  // AGENTS_ASK_2026_08_09_TICKET_SHOULD_PIN_ITS_BASELINE.
  const GOLD: Source = "polished:gold";

  it("beats the review default, including a newer polished row", () => {
    expect(
      defaultSlots("review", {
        polishedCurators: ["local-curator", "gold"],
        pinnedBaseline: GOLD,
      }),
    ).toEqual({ baseline: GOLD, comparator: "agent_proposal" });
  });

  it("beats the edit default too", () => {
    expect(
      defaultSlots("edit", { pinnedBaseline: GOLD }),
    ).toEqual({ baseline: GOLD, comparator: "agent_proposal" });
  });

  it("is ignored when the pinned source isn't loaded here", () => {
    // A baseline that resolves to nothing is worse than the flow
    // default; the strip says the pin couldn't be honoured instead.
    expect(
      defaultSlots("review", {
        polishedCurators: ["local-curator"],
        availability: { [GOLD]: { available: false } },
        pinnedBaseline: GOLD,
      }),
    ).toEqual({ baseline: "current", comparator: "agent_proposal" });
  });

  it("is ignored when it names a source that can't be a baseline", () => {
    expect(
      defaultSlots("review", {
        polishedCurators: ["gold"],
        pinnedBaseline: "agent_proposal",
      }),
    ).toEqual({ baseline: "current", comparator: "agent_proposal" });
  });

  it("no pin falls to the curation as it stands", () => {
    expect(
      defaultSlots("review", { polishedCurators: ["gold"], pinnedBaseline: null }),
    ).toEqual({ baseline: "current", comparator: "agent_proposal" });
  });
});

describe("having curated here beats the pin, and names what is edited", () => {
  // Once the curator has committed, the page edits /design — their own
  // work — while the chip went on naming whatever the store listed
  // first, which for a gold-pinned ticket was "Gold polished".
  //
  // The rule resolved to ``polished:<me>`` until 2026-08-17. That named
  // a real row, but not the one being rendered: a curator's own polish
  // is editable, so DesignDraftContext sources ``saved`` from /design
  // either way. Same content, two names, and the chip picked the one
  // that invited "is this my polish, or the design?". It now says
  // ``current``.
  const GOLD: Source = "polished:gold";

  it("wins over the row the store happens to list first", () => {
    expect(
      defaultSlots("review", {
        polishedCurators: ["gold", "local-curator"],
        ownPolishedCurator: "local-curator",
      }),
    ).toEqual({ baseline: "current", comparator: "agent_proposal" });
  });

  it("wins over the ticket pin", () => {
    expect(
      defaultSlots("review", {
        polishedCurators: ["gold", "local-curator"],
        pinnedBaseline: GOLD,
        ownPolishedCurator: "local-curator",
      }),
    ).toEqual({ baseline: "current", comparator: "agent_proposal" });
  });

  it("yields to the pin on an experiment the curator hasn't curated", () => {
    // No own row ⇒ nothing has been committed here, so the pin is still
    // the seed and the strip must open on it.
    expect(
      defaultSlots("review", {
        polishedCurators: ["gold"],
        pinnedBaseline: GOLD,
        ownPolishedCurator: "local-curator",
      }),
    ).toEqual({ baseline: GOLD, comparator: "agent_proposal" });
  });

  it("matches a namespaced producer against a bare username", () => {
    // ``curator:Local-Curator`` from /curations vs the bare name — the
    // match still has to fold both, even though what it returns no
    // longer names the row.
    expect(
      defaultSlots("review", {
        polishedCurators: ["gold", "curator:Local-Curator"],
        pinnedBaseline: GOLD,
        ownPolishedCurator: "local-curator",
      }),
    ).toEqual({ baseline: "current", comparator: "agent_proposal" });
  });

  it("still beats the pin when the curator's own polished row is unavailable", () => {
    // Behaviour change, deliberate. The old rule required the polished
    // row to be loadable, because it was going to RENDER that row; it
    // now renders /design, whose content does not depend on the chip
    // being available. A listed row means "I have committed here", and
    // that fact is what the pin has to yield to — landing back on gold
    // while /design holds the curator's work is the disconnect this
    // rule exists to close.
    expect(
      defaultSlots("review", {
        polishedCurators: ["gold", "local-curator"],
        availability: { "polished:local-curator": { available: false } },
        pinnedBaseline: GOLD,
        ownPolishedCurator: "local-curator",
      }),
    ).toEqual({ baseline: "current", comparator: "agent_proposal" });
  });

  it("leaves the edit flow alone", () => {
    // Edit flow's baseline is a locked label framing "the agent's
    // proposal against the bare Gemma state" — not a view to retarget.
    expect(
      defaultSlots("edit", {
        polishedCurators: ["local-curator"],
        availability: { preboard: { available: true } },
        ownPolishedCurator: "local-curator",
      }),
    ).toEqual({ baseline: "preboard", comparator: "agent_proposal" });
  });

  it("changes nothing when the curator is unknown", () => {
    // No identity ⇒ no preference; the ordinary review default applies.
    expect(
      defaultSlots("review", {
        polishedCurators: ["gold", "local-curator"],
        ownPolishedCurator: null,
      }),
    ).toEqual({ baseline: "current", comparator: "agent_proposal" });
  });
});

describe("parseSource", () => {
  it("round-trips every system token", () => {
    for (const s of SYSTEM_SOURCES) {
      expect(parseSource(s)).toBe(s);
    }
  });

  it("round-trips polished tokens with arbitrary curator names", () => {
    expect(parseSource("polished:curator-b")).toBe("polished:curator-b");
    expect(parseSource("polished:curator-a")).toBe("polished:curator-a");
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
    expect(polishedCuratorOf(CY)).toBe("curator-b");
    expect(polishedCuratorOf(AM)).toBe("curator-a");
    expect(polishedCuratorOf("polished:jordan-doe")).toBe("jordan-doe");
    expect(polishedCuratorOf("preboard")).toBe("");
  });

  it("polishedSourceFor builds a token", () => {
    expect(polishedSourceFor("curator-b")).toBe("polished:curator-b");
    expect(polishedSourceFor("jordan-doe")).toBe("polished:jordan-doe");
  });
});

describe("sourceLabel", () => {
  it("names the current curation as a thing, not as a row", () => {
    // The point of the token: the curator asked to look at "the
    // current curation", so that is what the chip says. Naming a row
    // instead ("Gold polished", "strict consensus") is what made the
    // baseline read as a choice between copies.
    expect(sourceLabel("current")).toBe("current curation");
  });

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
        label: "Strict consensus (ca+cb)",
        producer: "consensus:strict_ca_cb",
        source_kind: "consensus",
      },
    ];
    expect(sourceLabel("uuid-abc-123", curations))
      .toBe("Strict consensus (ca+cb)");
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
    expect(sourceLabel(CY)).toBe("Curator-B polished");
    expect(sourceLabel(AM)).toBe("Curator-A polished");
    expect(sourceLabel("polished:jordan-doe")).toBe("Jordan-Doe polished");
    expect(sourceLabel("polished:jo")).toBe("Jo polished");
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
