import { describe, expect, it } from "vitest";
import { targetDisposition } from "./tickets";
import { findTargetForPreboarding, preboardingSiblings } from "@/features/triage/triagePayload";
import type { Ticket } from "./tickets";

// Gemma tickets carry the decision as `screeningResult` (snake-cased by the client) and
// never `triage_disposition`; the UI wrote it there but read only the store's field, so
// every decision on ticket #49 read back as undecided (2026-10-29).
describe("targetDisposition", () => {
  it("reads Gemma's screening_result", () => {
    expect(targetDisposition({ screening_result: "INCLUDE" })).toBe("include");
    expect(targetDisposition({ screening_result: "REJECT" })).toBe("exclude");
    expect(targetDisposition({ screening_result: "UNDECIDED" })).toBe("unsure");
    expect(targetDisposition({ screening_result: null })).toBeNull();
  });
  it("prefers the store's own field when present", () => {
    expect(targetDisposition({ triage_disposition: "exclude", screening_result: "INCLUDE" })).toBe("exclude");
    expect(targetDisposition(undefined)).toBeNull();
  });
});

describe("preboarded targets on a Gemma ticket", () => {
  const ticket = {
    id: 49, type: "SCREENING", targets: [
      { id: 600, target_type: "PREBOARDED_EXPERIMENT", target_id: 93530, screening_result: "INCLUDE" },
      { id: 601, target_type: "PREBOARDED_EXPERIMENT", target_id: 93529 },
    ],
  } as unknown as Ticket;
  it("finds the target by its own id when there is no payload", () => {
    expect(findTargetForPreboarding(ticket, 93529)?.id).toBe(601);
    expect(findTargetForPreboarding(ticket, 1)).toBeNull();
  });
  it("walks the queue in ticket order", () => {
    expect(preboardingSiblings(ticket, 93530)).toMatchObject({ index: 0, next: 93529, prev: null });
  });
});
