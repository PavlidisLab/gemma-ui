import { describe, expect, it } from "vitest";
import {
  decideComparisonBanner,
  type ComparisonBannerAudit,
} from "./comparisonBanner";

/** Unit tests for the inter-curator-audit comparison banner decision
 *  logic. Pinning the leak fix from Paul's 2026-05-21 repro (memory:
 *  ``ui_bug_curator_banner_leak.md``):
 *
 *  Reproducer was:
 *    1. Open an inter-curator package (amanda+cyan) — banner shows.
 *    2. Navigate to a non-inter-curator package (e.g.
 *       ``hardcase10-sonnet-s0v8``) where the same experimentId
 *       happens to have a historical inter-curator audit in its
 *       audit list.
 *    3. Banner stayed visible because the audit-history fallback
 *       fired regardless of the current package's group identity.
 *
 *  Fix: gate the audit-history fallback on ``!groupId``. The
 *  ``leakFix`` test below would FAIL against the pre-fix code.
 */

const interCuratorAudit: ComparisonBannerAudit = {
  model:
    "inter-curator audit · amanda's curation applied · cyan reviews",
};

const normalAudit: ComparisonBannerAudit = {
  model: "Sonnet S0v8+chain+FV-concept-defender",
};

describe("decideComparisonBanner", () => {
  it("fires from group name when the URL group is inter-curator", () => {
    const d = decideComparisonBanner(
      "amanda-cyan-2026-05-20",
      "inter-curator audit · amanda's curation applied · cyan reviews",
      [],
    );
    expect(d.show).toBe(true);
    expect(d.goldCurator).toBe("amanda");
    expect(d.reviewer).toBe("cyan");
  });

  it("fires from audit model when the URL has no group context", () => {
    const d = decideComparisonBanner(undefined, "", [interCuratorAudit]);
    expect(d.show).toBe(true);
    expect(d.goldCurator).toBe("amanda");
    expect(d.reviewer).toBe("cyan");
  });

  it("hides when neither group nor audit history match", () => {
    const d = decideComparisonBanner(undefined, "", [normalAudit]);
    expect(d.show).toBe(false);
  });

  it("hides when the URL group is a normal (non-inter-curator) package", () => {
    const d = decideComparisonBanner(
      "hardcase10-sonnet-s0v8-r6",
      "hardcase10-sonnet-s0v8-r6",
      [],
    );
    expect(d.show).toBe(false);
  });

  // ---------- the leak fix ----------
  it(
    "leakFix: suppresses audit-history fallback when the URL has a " +
      "non-inter-curator groupId (Paul 2026-05-21 repro)",
    () => {
      // Same experiment was previously audited in an inter-curator
      // package, so its audit history carries that marker. The
      // curator has since navigated to a normal package
      // (``hardcase10-sonnet-s0v8``). Pre-fix, ``fromAudit`` would
      // fire and the banner would leak. Post-fix, the explicit
      // ``groupId`` suppresses the audit-history fallback and the
      // banner stays hidden.
      const d = decideComparisonBanner(
        "hardcase10-sonnet-s0v8-r6",
        "hardcase10-sonnet-s0v8-r6",
        [interCuratorAudit, normalAudit],
      );
      expect(d.show).toBe(false);
      expect(d.sourceText).toBe("");
      expect(d.goldCurator).toBeNull();
      expect(d.reviewer).toBeNull();
    },
  );

  it(
    "still fires when the URL groupId resolves to an inter-curator group, " +
      "even if audit history also contains an unrelated inter-curator entry",
    () => {
      // Sanity-check the other side of the gate: when ``groupId`` IS
      // an inter-curator group, the group path fires as before. The
      // audit list is ignored on this path; group name is the
      // source of identities.
      const d = decideComparisonBanner(
        "cyan-amanda-2026-05-19",
        "inter-curator audit · cyan's curation applied · amanda reviews",
        [interCuratorAudit],
      );
      expect(d.show).toBe(true);
      expect(d.goldCurator).toBe("cyan");
      expect(d.reviewer).toBe("amanda");
    },
  );

  it(
    "handles a stale group fetch (groupId set, name empty) by hiding " +
      "the banner — same gate as the leak fix",
    () => {
      // During navigation the group query is briefly in flight:
      // ``groupId`` is the new value but ``groupName`` hasn't
      // resolved yet. We must not fall back to audit history just
      // because the name is empty — that would re-introduce the
      // leak for one render. Banner stays hidden until the group
      // name resolves.
      const d = decideComparisonBanner("some-group-id", "", [
        interCuratorAudit,
      ]);
      expect(d.show).toBe(false);
    },
  );
});
