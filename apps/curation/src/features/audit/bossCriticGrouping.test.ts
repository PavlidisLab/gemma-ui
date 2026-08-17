/**
 * Unit tests for the boss-critic review grouping — the round-collapse +
 * dedupe + scope-classification + finding-match logic behind the
 * curator-worklist presentation (handoff
 * BOSS_CRITIC_REVIEW_PRESENTATION_2026_08_03).
 */
import { describe, expect, it } from "vitest";
import type { AuditFinding, BossCriticReview } from "@/api/auditTypes";
import { snakeify } from "@/api/client";
import {
  bossMatchesFinding,
  bossScopeKind,
  bossScopeLabel,
  bossSectionKind,
  bossSeverityCounts,
  groupBossReviews,
} from "./bossCriticGrouping";
import multiRoundFixture from "./fixtures/bossCriticReviews_multiRound.json";

function rev(overrides: Partial<BossCriticReview> = {}): BossCriticReview {
  return {
    target_id: "design",
    round: 1,
    severity: "blocker",
    verdict: "Something is wrong.",
    brief: "Something is wrong.",
    ...overrides,
  };
}

function finding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    target_kind: "factor",
    target_id: "factor:treatment",
    issue_code: "x",
    severity: "major",
    rationale: "",
    citation: "",
    citation_url: "",
    suggested_fix: "",
    proposer_suggestion: "",
    ...overrides,
  } as AuditFinding;
}

describe("bossScopeKind", () => {
  it("classifies the four scopes and normalizes the tag pipe", () => {
    expect(bossScopeKind("design")).toBe("design");
    expect(bossScopeKind("")).toBe("design");
    expect(bossScopeKind("factor:treatment")).toBe("factor");
    expect(bossScopeKind("fv:treatment/oxymatrine")).toBe("fv");
    expect(bossScopeKind("tag:cell-type|astrocyte")).toBe("tag");
    expect(bossScopeKind("tag:14")).toBe("tag");
  });
});

describe("bossSectionKind", () => {
  it("routes factor + fv to the factor section, tag to tag, design to the panel", () => {
    expect(bossSectionKind("factor")).toBe("factor");
    // An FV verdict belongs with its parent factor's proposal.
    expect(bossSectionKind("fv")).toBe("factor");
    expect(bossSectionKind("tag")).toBe("tag");
    expect(bossSectionKind("design")).toBeNull();
    expect(bossSectionKind("other")).toBeNull();
  });
});

describe("groupBossReviews — round collapse", () => {
  it("collapses multiple rounds of one target to a single final verdict", () => {
    const groups = groupBossReviews([
      rev({ target_id: "factor:treatment", round: 1, severity: "blocker", verdict: "fabricated" }),
      rev({ target_id: "factor:treatment", round: 2, severity: "advisory", verdict: "title-evidence supports; downgrade" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].severity).toBe("advisory");
    expect(groups[0].final.verdict).toBe("title-evidence supports; downgrade");
    expect(groups[0].maxRound).toBe(2);
    expect(groups[0].history).toHaveLength(2);
    expect(groups[0].unresolvedBlocker).toBe(false);
  });

  it("prefers is_final when the wire sets it, over the highest round", () => {
    const groups = groupBossReviews([
      rev({ target_id: "factor:treatment", round: 2, severity: "blocker", verdict: "later but superseded", is_final: false }),
      rev({ target_id: "factor:treatment", round: 1, severity: "advisory", verdict: "the real final", is_final: true }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].final.verdict).toBe("the real final");
    expect(groups[0].severity).toBe("advisory");
  });

  it("groups on finding_key when present so one target can carry two issues", () => {
    const groups = groupBossReviews([
      rev({ target_id: "factor:treatment", finding_key: "factor:treatment::F11", verdict: "issue one" }),
      rev({ target_id: "factor:treatment", finding_key: "factor:treatment::D1b", verdict: "issue two" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("flags an unresolved blocker when only round 1 ran", () => {
    const groups = groupBossReviews([
      rev({ target_id: "design", round: 1, severity: "blocker" }),
    ]);
    expect(groups[0].unresolvedBlocker).toBe(true);
  });
});

describe("groupBossReviews — dedupe", () => {
  it("drops byte-identical (round, severity, verdict) rows within a group", () => {
    const groups = groupBossReviews([
      rev({ target_id: "fv:treatment/oxymatrine", round: 2, verdict: "synonym mislabel" }),
      rev({ target_id: "fv:treatment/oxymatrine", round: 2, verdict: "synonym mislabel" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].history).toHaveLength(1);
  });

  it("merges two case-variant target_ids (no finding_key) into one card", () => {
    // The target_id fallback must mirror finding_key's lower-casing so
    // fv:treatment/oxymatrine and fv:treatment/Oxymatrine don't read as
    // a near-duplicate.
    const groups = groupBossReviews([
      rev({ target_id: "fv:treatment/oxymatrine", severity: "advisory", verdict: "synonym-bind" }),
      rev({ target_id: "fv:treatment/Oxymatrine", severity: "advisory", verdict: "does not match FV label" }),
    ]);
    expect(groups).toHaveLength(1);
  });
});

describe("groupBossReviews — ordering", () => {
  it("orders blockers first, design before other targets within a severity", () => {
    const groups = groupBossReviews([
      rev({ target_id: "factor:sex", severity: "advisory", verdict: "a" }),
      rev({ target_id: "factor:age", severity: "blocker", verdict: "b" }),
      rev({ target_id: "design", severity: "blocker", verdict: "c" }),
    ]);
    expect(groups.map((g) => g.targetId)).toEqual([
      "design",
      "factor:age",
      "factor:sex",
    ]);
  });
});

describe("bossSeverityCounts", () => {
  it("tallies grouped finals by severity", () => {
    const groups = groupBossReviews([
      rev({ target_id: "design", severity: "blocker" }),
      rev({ target_id: "factor:age", severity: "advisory" }),
      rev({ target_id: "factor:sex", severity: "advisory" }),
      rev({ target_id: "tag:cell-type|astrocyte", severity: "ok" }),
    ]);
    const counts = bossSeverityCounts(groups);
    expect(counts.blocker).toBe(1);
    expect(counts.advisory).toBe(2);
    expect(counts.ok).toBe(1);
  });
});

describe("bossScopeLabel", () => {
  it("renders curator-readable labels", () => {
    expect(bossScopeLabel("design")).toBe("Whole design");
    expect(bossScopeLabel("factor:treatment")).toBe("Factor: treatment");
    expect(bossScopeLabel("fv:treatment/oxymatrine")).toBe(
      "FV: treatment/oxymatrine",
    );
    expect(bossScopeLabel("tag:cell type|astrocyte")).toBe(
      "Tag: cell type : astrocyte",
    );
    expect(bossScopeLabel("tag:14")).toBe("Tag #14");
  });
});

describe("groupBossReviews — GSE315061 oxymatrine fixture (agent-authored)", () => {
  // The real wire ships camelCase (findingKey / isFinal / …); the api
  // client snakeifies it before the UI reads it. Mirror that here so the
  // test drives the exact shape ``groupBossReviews`` sees in production.
  const reviews = snakeify(
    (multiRoundFixture as { bossCriticReviews: unknown[] }).bossCriticReviews,
  ) as BossCriticReview[];
  const groups = groupBossReviews(reviews);
  const byKey = new Map(groups.map((g) => [g.key, g]));

  it("collapses the 7 raw rows to 5 grouped verdicts", () => {
    expect(groups).toHaveLength(5);
  });

  it("does NOT merge two distinct issues on the same 'design' target", () => {
    // The headline reason findingKey exists: both target_id 'design',
    // different issue → two cards, not one.
    expect(byKey.has("design::D_SCAN_ANCHOR")).toBe(true);
    expect(byKey.has("design::D_CONSTANT_PROMOTE")).toBe(true);
    const designGroups = groups.filter((g) => g.scopeKind === "design");
    expect(designGroups.map((g) => g.key).sort()).toEqual([
      "design::D_CONSTANT_PROMOTE",
      "design::D_SCAN_ANCHOR",
      "design::__OVERALL__",
    ]);
  });

  it("collapses factor:treatment blocker(r1)→advisory(r2) to one final advisory", () => {
    const g = byKey.get("factor:treatment::F11")!;
    expect(g.severity).toBe("advisory");
    expect(g.maxRound).toBe(2);
    expect(g.history).toHaveLength(2);
    expect(g.final.round).toBe(2);
    expect(g.scopeKind).toBe("factor");
  });

  it("keeps the round-1-only design blocker flagged unresolved", () => {
    const g = byKey.get("design::D_SCAN_ANCHOR")!;
    expect(g.severity).toBe("blocker");
    expect(g.unresolvedBlocker).toBe(true);
  });

  it("routes the FV synonym relabel to the factor section (with its parent factor)", () => {
    const g = byKey.get("fv:treatment/oxymatrine::E_SYNONYM")!;
    expect(g.scopeKind).toBe("fv");
    expect(bossSectionKind(g.scopeKind)).toBe("factor");
  });
});

describe("bossMatchesFinding", () => {
  it("matches a factor verdict to its factor finding by slug", () => {
    const [g] = groupBossReviews([rev({ target_id: "factor:treatment" })]);
    expect(
      bossMatchesFinding(g, finding({ target_kind: "factor", target_id: "factor:treatment#101" })),
    ).toBe(true);
    expect(
      bossMatchesFinding(g, finding({ target_kind: "factor", target_id: "factor:genotype" })),
    ).toBe(false);
  });

  it("routes a factor verdict to a partition-mismatch card named on the AGENT side", () => {
    // GSE96826: the card is `factor:1` (gold `disease`) and the boss says
    // `factor:genotype`, because it reasons over the agent's PROPOSAL. Both
    // namings sit on the card in `partition_mismatch`; without the agent side
    // the verdict rendered as "no matching card — the boss named an element
    // no finding targets" about the very factor the card presents.
    const [g] = groupBossReviews([rev({ target_id: "factor:genotype" })]);
    const card = finding({
      target_kind: "factor",
      target_id: "factor:1",
      partition_mismatch: {
        agent: { category: { label: "genotype" } },
        gold: { category: { label: "disease" } },
        direction: "agent_coarser",
      },
    } as never);
    expect(bossMatchesFinding(g, card)).toBe(true);
    // …and the gold naming still routes, so an id-keyed index is not required.
    const [g2] = groupBossReviews([rev({ target_id: "factor:disease" })]);
    expect(bossMatchesFinding(g2, card)).toBe(true);
    // An unrelated factor must still NOT match — the fix widens routing, it
    // does not make everything match everything.
    const [g3] = groupBossReviews([rev({ target_id: "factor:organism part" })]);
    expect(bossMatchesFinding(g3, card)).toBe(false);
  });

  it("matches an fv verdict to its fv finding, ignoring the id discriminator", () => {
    const [g] = groupBossReviews([rev({ target_id: "fv:treatment/oxymatrine" })]);
    expect(
      bossMatchesFinding(
        g,
        finding({ target_kind: "fv", target_id: "fv:treatment/oxymatrine#205" }),
      ),
    ).toBe(true);
  });

  it("matches a tag verdict across the pipe/slash separator difference", () => {
    const [g] = groupBossReviews([rev({ target_id: "tag:cell-type|astrocyte" })]);
    expect(
      bossMatchesFinding(
        g,
        finding({ target_kind: "tag", target_id: "tag:cell-type/astrocyte" }),
      ),
    ).toBe(true);
  });

  it("nests an fv verdict under its parent factor card", () => {
    const [g] = groupBossReviews([rev({ target_id: "fv:treatment/oxymatrine" })]);
    expect(
      bossMatchesFinding(
        g,
        finding({ target_kind: "factor", target_id: "factor:treatment#101" }),
      ),
    ).toBe(true);
    expect(
      bossMatchesFinding(
        g,
        finding({ target_kind: "factor", target_id: "factor:genotype" }),
      ),
    ).toBe(false);
  });

  it("matches the proposal 'ADD FACTOR' calibration:factor_extra shape by category", () => {
    // The proposal-review surface emits agent-proposed factors as
    // calibration:factor_extra:<cat>:<val>, which parseTargetId doesn't
    // recognize — the boss verdict must still nest into the card.
    const [gf] = groupBossReviews([rev({ target_id: "factor:treatment" })]);
    const [gv] = groupBossReviews([rev({ target_id: "fv:treatment/oxymatrine" })]);
    const addFactorCard = finding({
      target_kind: "factor",
      target_id: "calibration:factor_extra:treatment:cepharanthine",
    });
    expect(bossMatchesFinding(gf, addFactorCard)).toBe(true);
    expect(bossMatchesFinding(gv, addFactorCard)).toBe(true);
    // A different category doesn't attract it.
    expect(
      bossMatchesFinding(
        gf,
        finding({
          target_kind: "factor",
          target_id: "calibration:factor_extra:genotype:trp53",
        }),
      ),
    ).toBe(false);
  });

  it("does NOT match a numeric existing-design factor without a route index", () => {
    // No index → the category isn't recoverable from ``factor:71798``,
    // so routing degrades to standalone rather than guessing.
    const [g] = groupBossReviews([rev({ target_id: "factor:treatment" })]);
    expect(
      bossMatchesFinding(
        g,
        finding({ target_kind: "factor", target_id: "factor:71798" }),
      ),
    ).toBe(false);
  });

  // GSE1658 / audit 87d9d77f: findings ship ``factor:1/2/3`` (storage
  // ids) while the boss feed names the element (``fv:timepoint/2 h``).
  // Pre-fix every such verdict missed its card and piled up in the
  // unmatched block at the section tail.
  describe("numeric existing-design ids, bridged by the route index", () => {
    const index = {
      factorSlugById: new Map([
        [1, "cell-line"],
        [2, "timepoint"],
        [3, "treatment"],
      ]),
      tagSlugById: new Map([
        [1, { cat: "developmental-stage", val: "prime-adult-stage" }],
      ]),
    };

    it("nests an fv verdict into its numeric parent-factor card", () => {
      const [g] = groupBossReviews([rev({ target_id: "fv:timepoint/2 h" })]);
      expect(
        bossMatchesFinding(
          g,
          finding({ target_kind: "factor", target_id: "factor:2" }),
          index,
        ),
      ).toBe(true);
      // and doesn't leak onto a sibling factor card
      expect(
        bossMatchesFinding(
          g,
          finding({ target_kind: "factor", target_id: "factor:3" }),
          index,
        ),
      ).toBe(false);
    });

    it("nests a factor verdict into its numeric factor card", () => {
      const [g] = groupBossReviews([rev({ target_id: "factor:timepoint" })]);
      expect(
        bossMatchesFinding(
          g,
          finding({ target_kind: "factor", target_id: "factor:2" }),
          index,
        ),
      ).toBe(true);
    });

    it("nests a tag verdict into its numeric tag card", () => {
      const [g] = groupBossReviews([
        rev({ target_id: "tag:developmental stage|prime adult stage" }),
      ]);
      expect(
        bossMatchesFinding(
          g,
          finding({ target_kind: "tag", target_id: "tag:1" }),
          index,
        ),
      ).toBe(true);
    });

    it("leaves an id the index doesn't cover, and a foreign category, unmatched", () => {
      const [g] = groupBossReviews([rev({ target_id: "fv:individual/H510" })]);
      expect(
        bossMatchesFinding(
          g,
          finding({ target_kind: "factor", target_id: "factor:2" }),
          index,
        ),
      ).toBe(false);
      expect(
        bossMatchesFinding(
          g,
          finding({ target_kind: "factor", target_id: "factor:99" }),
          index,
        ),
      ).toBe(false);
    });

    // Near-match cards hold BOTH namings of one factor: the boss
    // reasons over the agent's proposal (``individual``) while the
    // target_id and design say ``cell line``.
    it("anchors an agent-named verdict to the near-match card that renames it", () => {
      const nearMatch = finding({
        target_kind: "factor",
        target_id: "factor:1",
        issue_code: "calibration_factor_match_near",
        rename: {
          agent: { category: { label: "individual", uri: null, resolver: null, score: null } },
          gold: { category: { label: "cell line", uri: null, resolver: null, score: null } },
          fv_pairs: [],
          direction: "equivalent",
        },
      } as Partial<AuditFinding>);
      for (const target of ["factor:individual", "fv:individual/H510"]) {
        const [g] = groupBossReviews([rev({ target_id: target })]);
        expect(bossMatchesFinding(g, nearMatch, index)).toBe(true);
      }
      // the gold-side naming still anchors to the same card
      const [gGold] = groupBossReviews([rev({ target_id: "factor:cell line" })]);
      expect(bossMatchesFinding(gGold, nearMatch, index)).toBe(true);
      // an unrelated factor doesn't
      const [gOther] = groupBossReviews([rev({ target_id: "factor:treatment" })]);
      expect(bossMatchesFinding(gOther, nearMatch, index)).toBe(false);
    });
  });

  it("matches a tag verdict to the calibration:extra tag shape", () => {
    const [g] = groupBossReviews([rev({ target_id: "tag:biological-sex|male" })]);
    expect(
      bossMatchesFinding(
        g,
        finding({
          target_kind: "tag",
          target_id: "calibration:extra:biological sex/male",
        }),
      ),
    ).toBe(true);
  });
});

describe("identical verdicts re-emitted under a second issue code", () => {
  /** GSE28555 / audit 2d3a1434: the boss raised one ungrounded-FV point
   *  in round 1 under CORRECTNESS and again in round 2 under E4, with
   *  byte-identical text. finding_key splits per issue, so the card
   *  showed the same advisory twice. */
  const wm = (findingKey: string, round: number) => ({
    target_id: "fv:melanoma cell line vs normal/neural crest cells/WM266-4",
    finding_key: findingKey,
    round,
    is_final: true,
    severity: "advisory",
    verdict:
      "WM266-4 ungrounded while sibling lines carry CLO URIs — resolver gap for this melanoma line",
  });

  it("merges them into one row", () => {
    const groups = groupBossReviews([
      wm("fv:…/wm266-4::CORRECTNESS", 1),
      wm("fv:…/wm266-4::E4", 2),
    ] as unknown as BossCriticReview[]);
    expect(groups).toHaveLength(1);
    expect(groups[0].maxRound).toBe(2);
  });

  it("keeps a genuine second issue on the same target as its own row", () => {
    const groups = groupBossReviews([
      wm("fv:…/wm266-4::CORRECTNESS", 1),
      {
        ...wm("fv:…/wm266-4::E4", 2),
        verdict: "WM266-4 assigned to 5 samples but n=11 elsewhere",
      },
    ] as unknown as BossCriticReview[]);
    expect(groups).toHaveLength(2);
  });

  it("does not merge across different severities", () => {
    const groups = groupBossReviews([
      wm("fv:…/wm266-4::CORRECTNESS", 1),
      { ...wm("fv:…/wm266-4::E4", 2), severity: "blocker" },
    ] as unknown as BossCriticReview[]);
    expect(groups).toHaveLength(2);
  });
});
