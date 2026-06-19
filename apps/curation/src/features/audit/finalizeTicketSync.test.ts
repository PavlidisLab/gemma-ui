import { describe, expect, it } from "vitest";
import { ticketTargetPatchForFinalize } from "./finalizeTicketSync";

/**
 * Contract tests for the Finalize → ticket-target sync helper.
 *
 * What broke (2026-06-11): the sync block was added inside the
 * ``SidebarHeader`` sub-component instead of the top-level
 * ``AuditSidebarPanel`` that owned the ``experimentId`` prop. The
 * sub-component never had ``experimentId`` in scope, so the
 * ``typeof experimentId`` reference threw
 * ``ReferenceError: experimentId is not defined`` and surfaced as
 * ``Couldn't close proposal: experimentId is not defined`` in the
 * curator-facing toast. The helper here ISOLATES the decision so
 * those scope errors can't recur silently — the helper accepts only
 * what it can normalise, and the SidebarHeader call site is a thin
 * pass-through that the TS compiler types end-to-end.
 *
 * These tests pin: (a) the happy path, (b) every degenerate input
 * that should produce ``null`` instead of throwing, (c) the
 * numeric-string normalisation, (d) the protected-payload shape.
 */

describe("ticketTargetPatchForFinalize — happy path", () => {
  it("returns a complete patch when ticket + numeric experimentId are both valid", () => {
    const patch = ticketTargetPatchForFinalize({
      experimentId: 91644,
      ticketContext: "30",
    });
    expect(patch).toEqual({
      ticketId: 30,
      target_type: "EXPRESSION_EXPERIMENT",
      target_id: 91644,
      status: "DONE",
    });
  });

  it("normalises a string-numeric experimentId (URL params arrive as strings)", () => {
    const patch = ticketTargetPatchForFinalize({
      experimentId: "91644",
      ticketContext: "30",
    });
    expect(patch).not.toBeNull();
    expect(patch!.target_id).toBe(91644);
    expect(typeof patch!.target_id).toBe("number");
  });

  it("normalises a numeric-with-trailing-junk experimentId via parseInt", () => {
    // parseInt("91644abc", 10) → 91644 — matches the existing route
    // resolution which tolerates trailing crud.
    const patch = ticketTargetPatchForFinalize({
      experimentId: "91644abc",
      ticketContext: "30",
    });
    expect(patch?.target_id).toBe(91644);
  });
});

describe("ticketTargetPatchForFinalize — skip-without-throwing", () => {
  it("returns null when ticketContext is undefined (route has no ?ticket=)", () => {
    const patch = ticketTargetPatchForFinalize({
      experimentId: 91644,
      ticketContext: undefined,
    });
    expect(patch).toBeNull();
  });

  it("returns null when ticketContext is null", () => {
    const patch = ticketTargetPatchForFinalize({
      experimentId: 91644,
      ticketContext: null,
    });
    expect(patch).toBeNull();
  });

  it("returns null when ticketContext is the empty string", () => {
    const patch = ticketTargetPatchForFinalize({
      experimentId: 91644,
      ticketContext: "",
    });
    expect(patch).toBeNull();
  });

  it("returns null when ticketContext doesn't parse as a positive integer", () => {
    const patch = ticketTargetPatchForFinalize({
      experimentId: 91644,
      ticketContext: "not-a-number",
    });
    expect(patch).toBeNull();
  });

  it("returns null when ticketContext parses as zero", () => {
    // Zero is the sentinel ``usePatchTicketTarget`` uses for "no
    // ticket" — we must NOT emit a patch for it.
    const patch = ticketTargetPatchForFinalize({
      experimentId: 91644,
      ticketContext: "0",
    });
    expect(patch).toBeNull();
  });

  it("returns null when ticketContext is negative", () => {
    const patch = ticketTargetPatchForFinalize({
      experimentId: 91644,
      ticketContext: "-30",
    });
    expect(patch).toBeNull();
  });

  it("returns null when experimentId is non-numeric (route mis-resolved)", () => {
    const patch = ticketTargetPatchForFinalize({
      experimentId: "GSE93824",
      ticketContext: "30",
    });
    expect(patch).toBeNull();
  });

  it("returns null when experimentId is zero", () => {
    const patch = ticketTargetPatchForFinalize({
      experimentId: 0,
      ticketContext: "30",
    });
    expect(patch).toBeNull();
  });

  it("returns null when experimentId is negative", () => {
    const patch = ticketTargetPatchForFinalize({
      experimentId: -1,
      ticketContext: "30",
    });
    expect(patch).toBeNull();
  });

  it("returns null when experimentId is NaN", () => {
    const patch = ticketTargetPatchForFinalize({
      experimentId: Number.NaN,
      ticketContext: "30",
    });
    expect(patch).toBeNull();
  });
});

describe("ticketTargetPatchForFinalize — payload shape contract", () => {
  it("always sets target_type to the EXPRESSION_EXPERIMENT literal", () => {
    const patch = ticketTargetPatchForFinalize({
      experimentId: 1,
      ticketContext: "1",
    });
    expect(patch?.target_type).toBe("EXPRESSION_EXPERIMENT");
  });

  it("always sets status to DONE — Finalize is the only caller today", () => {
    const patch = ticketTargetPatchForFinalize({
      experimentId: 1,
      ticketContext: "1",
    });
    expect(patch?.status).toBe("DONE");
  });

  it("never throws on any input shape the route layer can produce", () => {
    // Defence against future-me reintroducing the ReferenceError by
    // accident — every input the route layer can hand over (numeric,
    // numeric-string, undefined, null, empty, junk) MUST resolve to
    // a value, never throw.
    const inputs: Array<{ experimentId: number | string; ticketContext: string | undefined | null }> = [
      { experimentId: 1, ticketContext: "1" },
      { experimentId: "1", ticketContext: "1" },
      { experimentId: 1, ticketContext: undefined },
      { experimentId: 1, ticketContext: null },
      { experimentId: 1, ticketContext: "" },
      { experimentId: "abc", ticketContext: "30" },
      { experimentId: "", ticketContext: "30" },
      { experimentId: Number.NaN, ticketContext: "30" },
    ];
    for (const i of inputs) {
      expect(() => ticketTargetPatchForFinalize(i)).not.toThrow();
    }
  });
});
