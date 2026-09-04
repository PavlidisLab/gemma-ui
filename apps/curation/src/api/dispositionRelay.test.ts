/**
 * Composing the curator's reason for the relay.
 *
 * Gemma stores ONE free-text `reason` where the UI holds a structured
 * chip plus separate notes. cab talked gembro out of a column per chip,
 * so composing is the agreed shape — following the precedent Gemma set
 * for the curation commit's audit note (`"reasonCode: reason"`).
 */
import { describe, expect, it } from "vitest";

import { buildDispositionBody, composeDispositionReason } from "./audits";
import type { AuditFindingDispositionPatch } from "./auditTypes";

const base: AuditFindingDispositionPatch = {
  target_id: "tag:developmental-stage/embryo-stage",
  status: "dismissed",
  reviewer: "paul",
};

describe("composeDispositionReason", () => {
  it("puts the chip in front of the prose", () => {
    expect(
      composeDispositionReason({
        ...base,
        dismiss_reason: "wrong_target",
        notes: "that is a factor value, not a tag",
      }),
    ).toBe("wrong_target: that is a factor value, not a tag");
  });

  it("carries a chip with no prose, and prose with no chip", () => {
    expect(
      composeDispositionReason({ ...base, dismiss_reason: "wrong_target" }),
    ).toBe("wrong_target");
    expect(composeDispositionReason({ ...base, notes: "no, keep it" })).toBe(
      "no, keep it",
    );
  });

  it("reads whichever chip family the status implies", () => {
    expect(
      composeDispositionReason({
        ...base,
        status: "accepted",
        accept_reason: "agent_real_miss",
      }),
    ).toBe("agent_real_miss");
    expect(
      composeDispositionReason({
        ...base,
        status: "needs_more_info",
        not_sure_reason: "needs_paper",
        notes: "check the methods section",
      }),
    ).toBe("needs_paper: check the methods section");
  });

  it("is empty when the curator said nothing — not the string 'null'", () => {
    expect(composeDispositionReason(base)).toBe("");
    expect(composeDispositionReason({ ...base, notes: "   " })).toBe("");
  });

  it("🛑 never folds applied_fix in — a receipt is not a judgement", () => {
    // It is a fact about what the agent DID, not what the curator
    // decided; folded into the ruling, a later read cannot tell the two
    // apart. It belongs in the apply journal.
    const reason = composeDispositionReason({
      ...base,
      notes: "drop it",
      applied_fix: "removed tag 5",
    });
    expect(reason).toBe("drop it");
    expect(reason).not.toContain("removed tag 5");
  });
});

describe("finding_id on the relayed ruling", () => {
  // Measured on gemma2 set 2565 (dataset 5381, GSE32321): 64 findings,
  // findingId on 64 of 64, and `fv:treatment/gsk-3-inhibitor-xv#126255`
  // carries TWO actionable findings — `ungrounded_fv` from the
  // grounding judge and `missing_statement` from the FV judge. A ruling
  // keyed on target_id alone cannot say which one the curator meant.
  it("🛑 is omitted, never blank, when the report has none", () => {
    // Set 2564 carries findingId on 0 of 37. A row with an empty id is
    // indistinguishable from a legacy row, so the consumer's
    // refusal-to-guess would quietly degrade into target keying.
    const body = buildDispositionBody({ ...base });
    expect("findingId" in body).toBe(false);
  });

  it("rides along when the card knew which finding it rendered", () => {
    expect(
      buildDispositionBody({ ...base, finding_id: "fa386fd376ce69ea" }),
    ).toMatchObject(
      { targetId: base.target_id, findingId: "fa386fd376ce69ea" },
    );
  });
});
