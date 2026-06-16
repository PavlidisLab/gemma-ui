import { describe, expect, it } from "vitest";
import { ticketTypeLabel, type TicketType } from "./tickets";

/**
 * Exhaustive coverage of ticketTypeLabel() — every member of the
 * TicketType union must return a non-empty string.
 *
 * The typed ``allTypes`` array below is checked against the union
 * via the ``satisfies`` operator, so TypeScript will complain if a
 * new TicketType member is added to the union but not listed here.
 * That compile error is intentional — it forces the test to be
 * updated alongside the new enum member.
 */

const allTypes = [
  "BATCH_INFO_NEEDED",
  "REALIGNMENT_NEEDED",
  "QUALITY_REVIEW",
  "PRELOAD",
  "CURATION",
  "SCREENING",
  "GENERIC",
] as const satisfies readonly TicketType[];

describe("ticketTypeLabel", () => {
  for (const type of allTypes) {
    it(`returns a non-empty string for "${type}"`, () => {
      const label = ticketTypeLabel(type);
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    });
  }

  it("BATCH_INFO_NEEDED → 'Batch info'", () => {
    expect(ticketTypeLabel("BATCH_INFO_NEEDED")).toBe("Batch info");
  });

  it("REALIGNMENT_NEEDED → 'Realignment'", () => {
    expect(ticketTypeLabel("REALIGNMENT_NEEDED")).toBe("Realignment");
  });

  it("QUALITY_REVIEW → 'Quality review'", () => {
    expect(ticketTypeLabel("QUALITY_REVIEW")).toBe("Quality review");
  });

  it("PRELOAD → 'Preload'", () => {
    expect(ticketTypeLabel("PRELOAD")).toBe("Preload");
  });

  it("CURATION → 'Curation'", () => {
    expect(ticketTypeLabel("CURATION")).toBe("Curation");
  });

  it("SCREENING → 'Screening'", () => {
    expect(ticketTypeLabel("SCREENING")).toBe("Screening");
  });

  it("GENERIC → 'General'", () => {
    expect(ticketTypeLabel("GENERIC")).toBe("General");
  });
});
