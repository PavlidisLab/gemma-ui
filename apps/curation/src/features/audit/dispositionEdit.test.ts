import { describe, expect, it } from "vitest";
import type { AuditFindingDisposition } from "@/api/auditTypes";
import { parsePrefixedNote, resolveEditInitial } from "./dispositionEdit";

/** Build a disposition with the bits the resolver cares about. The
 *  irrelevant required fields get throwaway values. */
function disposition(
  partial: Partial<AuditFindingDisposition> & { notes?: string },
): AuditFindingDisposition {
  return {
    target_id: "tag:42",
    status: "dismissed",
    reviewer: "test",
    reviewed_at: "2026-05-14T00:00:00Z",
    notes: partial.notes ?? "",
    ...partial,
  };
}

describe("parsePrefixedNote", () => {
  it("extracts a bracketed chip-key prefix and the rest", () => {
    expect(parsePrefixedNote("[missed_evidence] paper section 4")).toEqual({
      tag: "missed_evidence",
      plain: "paper section 4",
    });
  });

  it("handles prefix with no trailing body", () => {
    expect(parsePrefixedNote("[borderline]")).toEqual({
      tag: "borderline",
      plain: "",
    });
  });

  it("returns the full string when no prefix", () => {
    expect(parsePrefixedNote("just a regular note")).toEqual({
      tag: null,
      plain: "just a regular note",
    });
  });

  it("preserves multi-line bodies past the prefix", () => {
    expect(parsePrefixedNote("[gold_was_wrong] line one\nline two")).toEqual({
      tag: "gold_was_wrong",
      plain: "line one\nline two",
    });
  });
});

describe("resolveEditInitial — round-trip across wire regimes", () => {
  describe("post-2026-05-13 wire (calibration chips map straight through)", () => {
    // The agents-side enum extension on 2026-05-13 promoted the
    // calibration-specific chips to canonical DismissReason /
    // AcceptReason values. New dispositions land with the chip in
    // the structured field and no prefix in notes; the edit dialog
    // must preselect from the structured field.

    it("dismiss: missed_evidence round-trips via structured field", () => {
      const d = disposition({
        status: "dismissed",
        dismiss_reason: "missed_evidence",
        notes: "paper section 4",
      });
      expect(resolveEditInitial(d, "dismiss")).toEqual({
        tag: "missed_evidence",
        plain: "paper section 4",
      });
    });

    it("dismiss: no_evidence round-trips via structured field", () => {
      const d = disposition({
        status: "dismissed",
        dismiss_reason: "no_evidence",
        notes: "",
      });
      expect(resolveEditInitial(d, "dismiss")).toEqual({
        tag: "no_evidence",
        plain: "",
      });
    });

    it("dismiss: borderline round-trips via structured field", () => {
      const d = disposition({
        status: "dismissed",
        dismiss_reason: "borderline",
        notes: "could go either way",
      });
      expect(resolveEditInitial(d, "dismiss")).toEqual({
        tag: "borderline",
        plain: "could go either way",
      });
    });

    it("accept: gold_was_wrong round-trips via structured field", () => {
      const d = disposition({
        status: "accepted",
        accept_reason: "gold_was_wrong",
        notes: "agent caught a real omission",
      });
      expect(resolveEditInitial(d, "accept")).toEqual({
        tag: "gold_was_wrong",
        plain: "agent caught a real omission",
      });
    });

    it("accept: borderline round-trips via structured field", () => {
      const d = disposition({
        status: "accepted",
        accept_reason: "borderline",
        notes: "",
      });
      expect(resolveEditInitial(d, "accept")).toEqual({
        tag: "borderline",
        plain: "",
      });
    });

    it("not_sure: need_more_data round-trips via structured field", () => {
      const d = disposition({
        status: "needs_more_info",
        not_sure_reason: "need_more_data",
        notes: "waiting on PI confirmation",
      });
      expect(resolveEditInitial(d, "not_sure")).toEqual({
        tag: "need_more_data",
        plain: "waiting on PI confirmation",
      });
    });
  });

  describe("legacy-read: pre-2026-05-13 squash + prefix workaround", () => {
    // Rows written by v0.6.4 against a pre-2026-05-13 agent service
    // carry a squashed structured field (canonical value, not the
    // chip) and the specific chip stashed as a `[<chip>]` prefix.
    // The prefix has to win or the dialog re-selects the wrong chip.

    it("prefix wins when structured field is the squashed canonical value", () => {
      const d = disposition({
        status: "dismissed",
        dismiss_reason: "weak_evidence", // squashed
        notes: "[missed_evidence] paper section 4",
      });
      expect(resolveEditInitial(d, "dismiss")).toEqual({
        tag: "missed_evidence",
        plain: "paper section 4",
      });
    });

    it("prefix wins for gold_was_wrong squashed to 'other'", () => {
      const d = disposition({
        status: "accepted",
        accept_reason: "other", // squashed
        notes: "[gold_was_wrong] agent caught a real omission",
      });
      expect(resolveEditInitial(d, "accept")).toEqual({
        tag: "gold_was_wrong",
        plain: "agent caught a real omission",
      });
    });
  });

  describe("non-calibration canonical chips", () => {
    // Canonical chips (`weak_evidence`, `redundant`, etc.) never
    // went through the squash — they went straight to the structured
    // field. Edit must read them back from there with no prefix.

    it("dismiss: weak_evidence preselects from structured field", () => {
      const d = disposition({
        status: "dismissed",
        dismiss_reason: "weak_evidence",
        notes: "evidence too thin",
      });
      expect(resolveEditInitial(d, "dismiss")).toEqual({
        tag: "weak_evidence",
        plain: "evidence too thin",
      });
    });

    it("accept: well_evidenced preselects from structured field", () => {
      const d = disposition({
        status: "accepted",
        accept_reason: "well_evidenced",
        notes: "",
      });
      expect(resolveEditInitial(d, "accept")).toEqual({
        tag: "well_evidenced",
        plain: "",
      });
    });
  });

  describe("graceful degradation", () => {
    it("no structured field, no prefix → tag null, plain notes", () => {
      const d = disposition({
        status: "dismissed",
        notes: "free text only",
      });
      expect(resolveEditInitial(d, "dismiss")).toEqual({
        tag: null,
        plain: "free text only",
      });
    });

    it("empty notes, no structured field → tag null, plain empty", () => {
      const d = disposition({
        status: "needs_more_info",
        notes: "",
      });
      expect(resolveEditInitial(d, "not_sure")).toEqual({
        tag: null,
        plain: "",
      });
    });

    it("mode mismatch: dismiss-mode read of an accept disposition ignores accept_reason", () => {
      // Defensive: caller routes by `disposition.status`, but the
      // resolver shouldn't leak across mode boundaries if a caller
      // ever asks the wrong mode.
      const d = disposition({
        status: "accepted",
        accept_reason: "well_evidenced",
        notes: "",
      });
      expect(resolveEditInitial(d, "dismiss")).toEqual({
        tag: null,
        plain: "",
      });
    });
  });
});
