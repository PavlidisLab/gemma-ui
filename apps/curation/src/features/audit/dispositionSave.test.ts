import { describe, expect, it } from "vitest";
import {
  deriveAcceptReason,
  deriveDismissReason,
  deriveStatus,
  verdictToStructureDetails,
} from "./dispositionSave";

/** These tests pin down the wire-shape derivation that surfaces in
 *  the editor's per-button-click PATCH. Three regressions have hit
 *  in the last two sessions; every row below corresponds to a
 *  shape the running server has 422'd at least once. New
 *  issue_codes the agent ships should grow a matching row. */

describe("verdictToStructureDetails", () => {
  // ---- verdict = currently ("keep gold / keep Curator A's") ----

  it("currently on _match_near → accepted-shape (not dismissed)", () => {
    // The regression the reviewer caught 2026-05-20: "keep Curator A's" on a
    // match_near finding was producing structure_ok=false →
    // dismissed → 422 (no dismiss_reason). For matches the
    // curator's "keep gold" semantically means "yes, gold is
    // correct, accept the audit as no-action".
    expect(
      verdictToStructureDetails("currently", "calibration_factor_match_near"),
    ).toEqual({ structureOk: true, detailsOk: true });
  });

  it("currently on _match_exact → accepted-shape", () => {
    expect(
      verdictToStructureDetails("currently", "calibration_factor_match_exact"),
    ).toEqual({ structureOk: true, detailsOk: true });
  });

  it("currently on _rename → accepted-shape", () => {
    expect(
      verdictToStructureDetails("currently", "calibration_factor_rename"),
    ).toEqual({ structureOk: true, detailsOk: true });
  });

  it("currently on tag _match → accepted-shape", () => {
    expect(verdictToStructureDetails("currently", "calibration_match")).toEqual(
      { structureOk: true, detailsOk: true },
    );
  });

  it("currently on factor _extra → dismiss-shape", () => {
    expect(
      verdictToStructureDetails("currently", "calibration_factor_extra"),
    ).toEqual({ structureOk: false, detailsOk: null });
  });

  it("currently on factor _partition_mismatch → dismiss-shape", () => {
    // The "keep gold's view" button on a partition_mismatch finding
    // — curator rejects the agent's structural call (split or
    // combine). Same shape as the other agent-extra-family
    // findings: structure_ok=false, dismissed with wont_fix.
    expect(
      verdictToStructureDetails(
        "currently",
        "calibration_factor_partition_mismatch",
      ),
    ).toEqual({ structureOk: false, detailsOk: null });
  });

  it("currently on factor _gold_only_miss → dismiss-shape", () => {
    expect(
      verdictToStructureDetails(
        "currently",
        "calibration_factor_gold_only_miss",
      ),
    ).toEqual({ structureOk: false, detailsOk: null });
  });

  it("currently on tag _agent_extra → dismiss-shape", () => {
    expect(
      verdictToStructureDetails("currently", "calibration_agent_extra"),
    ).toEqual({ structureOk: false, detailsOk: null });
  });

  it("currently on tag _gold_only_miss → dismiss-shape", () => {
    expect(
      verdictToStructureDetails("currently", "calibration_gold_only_miss"),
    ).toEqual({ structureOk: false, detailsOk: null });
  });

  it("currently on unknown issue_code → dismiss-shape (conservative)", () => {
    expect(verdictToStructureDetails("currently", "future_code_x")).toEqual({
      structureOk: false,
      detailsOk: null,
    });
  });

  // ---- verdict = proposal ("adopt Curator B's") ----

  it("proposal on _extra → accept (structure + details both ok)", () => {
    expect(
      verdictToStructureDetails("proposal", "calibration_factor_extra"),
    ).toEqual({ structureOk: true, detailsOk: true });
  });

  it("proposal on _match_near → accept", () => {
    expect(
      verdictToStructureDetails("proposal", "calibration_factor_match_near"),
    ).toEqual({ structureOk: true, detailsOk: true });
  });

  it("proposal on _partition_mismatch → accept", () => {
    // "Adopt agent's split / combine" — curator endorses the
    // agent's structural call. Accept across the board.
    expect(
      verdictToStructureDetails(
        "proposal",
        "calibration_factor_partition_mismatch",
      ),
    ).toEqual({ structureOk: true, detailsOk: true });
  });

  it("proposal on _gold_only_miss → accept (curator agrees with removal)", () => {
    expect(
      verdictToStructureDetails(
        "proposal",
        "calibration_factor_gold_only_miss",
      ),
    ).toEqual({ structureOk: true, detailsOk: true });
  });

  // ---- verdict = reference ("match Gemma") ----

  it("reference on any code → accept", () => {
    expect(
      verdictToStructureDetails("reference", "calibration_factor_match_near"),
    ).toEqual({ structureOk: true, detailsOk: true });
    expect(
      verdictToStructureDetails("reference", "calibration_factor_extra"),
    ).toEqual({ structureOk: true, detailsOk: true });
  });
});

describe("deriveStatus", () => {
  // The wire convention documented on AuditFindingDisposition's
  // structure_ok / details_ok JSDoc.

  it("structure_ok=false → dismissed", () => {
    expect(deriveStatus(false, null)).toBe("dismissed");
    expect(deriveStatus(false, true)).toBe("dismissed");
    expect(deriveStatus(false, false)).toBe("dismissed");
  });

  it("structure_ok=null && details_ok=null → needs_more_info", () => {
    expect(deriveStatus(null, null)).toBe("needs_more_info");
  });

  it("structure_ok=true → accepted (regardless of details)", () => {
    expect(deriveStatus(true, true)).toBe("accepted");
    expect(deriveStatus(true, false)).toBe("accepted");
    expect(deriveStatus(true, null)).toBe("accepted");
  });

  it("structure_ok=null with details_ok set → accepted", () => {
    // Curator answered details but not structure — server treats
    // that as a partial accept rather than dismiss.
    expect(deriveStatus(null, true)).toBe("accepted");
    expect(deriveStatus(null, false)).toBe("accepted");
  });
});

describe("deriveDismissReason", () => {
  // The regression the reviewer caught 2026-05-20: PATCHes with
  // status=dismissed and no dismiss_reason 422'd because the
  // server's AuditFindingDispositionPatch model-validator rejects
  // dismiss-without-reason. The editor's one-click "keep gold"
  // path bypasses the chip dialog and needs a backfilled reason.

  it("dismissed + gold_only_miss (factor) → agent_real_miss", () => {
    expect(
      deriveDismissReason("dismissed", "calibration_factor_gold_only_miss"),
    ).toBe("agent_real_miss");
  });

  it("dismissed + gold_only_miss (tag) → agent_real_miss", () => {
    expect(deriveDismissReason("dismissed", "calibration_gold_only_miss")).toBe(
      "agent_real_miss",
    );
  });

  it("dismissed + factor_extra → wont_fix (catch-all)", () => {
    expect(deriveDismissReason("dismissed", "calibration_factor_extra")).toBe(
      "wont_fix",
    );
  });

  it("dismissed + agent_extra (tag) → wont_fix", () => {
    expect(deriveDismissReason("dismissed", "calibration_agent_extra")).toBe(
      "wont_fix",
    );
  });

  it("dismissed + unknown issue_code → wont_fix", () => {
    expect(deriveDismissReason("dismissed", "future_code_x")).toBe("wont_fix");
  });

  it("accepted → no dismiss_reason emitted", () => {
    expect(deriveDismissReason("accepted", "calibration_factor_match_near")).toBeUndefined();
    expect(
      deriveDismissReason("accepted", "calibration_factor_gold_only_miss"),
    ).toBeUndefined();
  });

  it("needs_more_info → no dismiss_reason emitted", () => {
    expect(
      deriveDismissReason("needs_more_info", "calibration_factor_match_near"),
    ).toBeUndefined();
  });

  it("pending → no dismiss_reason emitted", () => {
    expect(
      deriveDismissReason("pending", "calibration_factor_extra"),
    ).toBeUndefined();
  });
});

describe("deriveAcceptReason", () => {
  // The 2026-05-21 bug: server requires accept_reason for
  // calibration_agent_extra / calibration_factor_extra accepts.
  // The structured editor bypasses the chip dialog, so defaults
  // must be backfilled here — mirrors deriveDismissReason.

  it("accepted + calibration_agent_extra → well_evidenced", () => {
    expect(deriveAcceptReason("accepted", "calibration_agent_extra")).toBe(
      "well_evidenced",
    );
  });

  it("accepted + calibration_factor_extra → well_evidenced", () => {
    expect(deriveAcceptReason("accepted", "calibration_factor_extra")).toBe(
      "well_evidenced",
    );
  });

  it("accepted + calibration_gold_only_miss → gold_was_wrong", () => {
    expect(deriveAcceptReason("accepted", "calibration_gold_only_miss")).toBe(
      "gold_was_wrong",
    );
  });

  it("accepted + calibration_factor_gold_only_miss → gold_was_wrong", () => {
    expect(
      deriveAcceptReason("accepted", "calibration_factor_gold_only_miss"),
    ).toBe("gold_was_wrong");
  });

  it("accepted + match / rename codes → no accept_reason (not required)", () => {
    expect(
      deriveAcceptReason("accepted", "calibration_factor_match_near"),
    ).toBeUndefined();
    expect(
      deriveAcceptReason("accepted", "calibration_factor_rename"),
    ).toBeUndefined();
    expect(deriveAcceptReason("accepted", "calibration_match")).toBeUndefined();
  });

  it("dismissed → no accept_reason emitted", () => {
    expect(
      deriveAcceptReason("dismissed", "calibration_agent_extra"),
    ).toBeUndefined();
  });

  it("needs_more_info → no accept_reason emitted", () => {
    expect(
      deriveAcceptReason("needs_more_info", "calibration_agent_extra"),
    ).toBeUndefined();
  });
});

describe("end-to-end button → wire derivation", () => {
  // The full chain the editor + sidebar produces. Each row maps
  // one curator button click through the helpers in order, asserting
  // the final wire-shape tuple. If any of these regresses the
  // editor's PATCH 422s on the running server.

  type Row = {
    name: string;
    verdict: "proposal" | "currently" | "reference";
    issueCode: string;
    expectStatus: string;
    expectStructure: boolean | null;
    expectDetails: boolean | null;
    expectDismissReason: string | undefined;
    expectAcceptReason: string | undefined;
  };

  const cases: Row[] = [
    {
      name: "keep Curator A's on match_near (the 2026-05-20 bug)",
      verdict: "currently",
      issueCode: "calibration_factor_match_near",
      expectStatus: "accepted",
      expectStructure: true,
      expectDetails: true,
      expectDismissReason: undefined,
      expectAcceptReason: undefined,
    },
    {
      name: "keep Curator A's on factor_extra",
      verdict: "currently",
      issueCode: "calibration_factor_extra",
      expectStatus: "dismissed",
      expectStructure: false,
      expectDetails: null,
      expectDismissReason: "wont_fix",
      expectAcceptReason: undefined,
    },
    {
      name: "keep Curator A's on factor_gold_only_miss",
      verdict: "currently",
      issueCode: "calibration_factor_gold_only_miss",
      expectStatus: "dismissed",
      expectStructure: false,
      expectDetails: null,
      expectDismissReason: "agent_real_miss",
      expectAcceptReason: undefined,
    },
    {
      name: "adopt Curator B's on match_near",
      verdict: "proposal",
      issueCode: "calibration_factor_match_near",
      expectStatus: "accepted",
      expectStructure: true,
      expectDetails: true,
      expectDismissReason: undefined,
      expectAcceptReason: undefined,
    },
    {
      name: "adopt Curator B's on factor_extra (the 2026-05-21 bug)",
      verdict: "proposal",
      issueCode: "calibration_factor_extra",
      expectStatus: "accepted",
      expectStructure: true,
      expectDetails: true,
      expectDismissReason: undefined,
      expectAcceptReason: "well_evidenced",
    },
    {
      name: "adopt Curator B's on tag agent_extra (the 2026-05-21 bug)",
      verdict: "proposal",
      issueCode: "calibration_agent_extra",
      expectStatus: "accepted",
      expectStructure: true,
      expectDetails: true,
      expectDismissReason: undefined,
      expectAcceptReason: "well_evidenced",
    },
    {
      name: "adopt Curator B's on factor_gold_only_miss",
      verdict: "proposal",
      issueCode: "calibration_factor_gold_only_miss",
      expectStatus: "accepted",
      expectStructure: true,
      expectDetails: true,
      expectDismissReason: undefined,
      expectAcceptReason: "gold_was_wrong",
    },
    {
      name: "adopt Curator B's on tag gold_only_miss",
      verdict: "proposal",
      issueCode: "calibration_gold_only_miss",
      expectStatus: "accepted",
      expectStructure: true,
      expectDetails: true,
      expectDismissReason: undefined,
      expectAcceptReason: "gold_was_wrong",
    },
    {
      name: "match Gemma on match_near",
      verdict: "reference",
      issueCode: "calibration_factor_match_near",
      expectStatus: "accepted",
      expectStructure: true,
      expectDetails: true,
      expectDismissReason: undefined,
      expectAcceptReason: undefined,
    },
    {
      name: "keep Curator A's on tag gold_only_miss",
      verdict: "currently",
      issueCode: "calibration_gold_only_miss",
      expectStatus: "dismissed",
      expectStructure: false,
      expectDetails: null,
      expectDismissReason: "agent_real_miss",
      expectAcceptReason: undefined,
    },
    {
      name: "adopt agent's split on partition_mismatch",
      verdict: "proposal",
      issueCode: "calibration_factor_partition_mismatch",
      expectStatus: "accepted",
      expectStructure: true,
      expectDetails: true,
      expectDismissReason: undefined,
      expectAcceptReason: undefined,
    },
    {
      name: "keep gold's view on partition_mismatch",
      verdict: "currently",
      issueCode: "calibration_factor_partition_mismatch",
      expectStatus: "dismissed",
      expectStructure: false,
      expectDetails: null,
      expectDismissReason: "wont_fix",
      expectAcceptReason: undefined,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const { structureOk, detailsOk } = verdictToStructureDetails(
        c.verdict,
        c.issueCode,
      );
      const status = deriveStatus(structureOk, detailsOk);
      const dismissReason = deriveDismissReason(status, c.issueCode);
      const acceptReason = deriveAcceptReason(status, c.issueCode);
      expect(structureOk).toBe(c.expectStructure);
      expect(detailsOk).toBe(c.expectDetails);
      expect(status).toBe(c.expectStatus);
      expect(dismissReason).toBe(c.expectDismissReason);
      expect(acceptReason).toBe(c.expectAcceptReason);
    });
  }
});
