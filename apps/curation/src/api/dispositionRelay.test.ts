/**
 * Composing the curator's reason for the relay.
 *
 * Gemma stores ONE free-text `reason` where the UI holds a structured
 * chip plus separate notes. cab talked gembro out of a column per chip,
 * so composing is the agreed shape — following the precedent Gemma set
 * for the curation commit's audit note (`"reasonCode: reason"`).
 */
import { describe, expect, it } from "vitest";

import { composeDispositionReason } from "./audits";
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
