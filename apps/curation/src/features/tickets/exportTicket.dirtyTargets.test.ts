import { describe, expect, it } from "vitest";
import type { Ticket, TicketTarget } from "@/api/tickets";
import { dirtyExperimentTargets } from "./exportTicket";

/**
 * Contract test for the ticket-finalize dirty-draft guard
 * (UIB_REPLY_2026_07_20_MATERIALIZE_ON_FINALIZE_CURATOR_KEY_PARITY.md
 * follow-up). The ticket export + close read the PERSISTED design, so a
 * target experiment with uncommitted draft edits is silently dropped;
 * ``dirtyExperimentTargets`` is what the header warns on. The mapping
 * that must not drift: the draft cache is keyed by the route experiment
 * id, which equals the EE target's numeric ``target_id``, stringified.
 */
function target(partial: Partial<TicketTarget> & { target_id: number }): TicketTarget {
  return {
    target_type: "EXPRESSION_EXPERIMENT",
    status: "NOT_DONE",
    ...partial,
  } as TicketTarget;
}

function ticket(targets: TicketTarget[]): Ticket {
  return { id: 1, targets } as Ticket;
}

describe("dirtyExperimentTargets", () => {
  it("returns EE targets whose stringified target_id is in the dirty set", () => {
    const t = ticket([
      target({ target_id: 7985, display_name: "GSE43566" }),
      target({ target_id: 9001, display_name: "GSE9001" }),
    ]);
    // Dirty set is string-keyed (localStorage keys); target_id is numeric.
    const dirty = dirtyExperimentTargets(t, new Set(["7985"]));
    expect(dirty.map((x) => x.target_id)).toEqual([7985]);
  });

  it("ignores non-EE targets even when the id collides with a dirty key", () => {
    const t = ticket([
      target({ target_id: 42, target_type: "GEO_ACCESSION" }),
      target({ target_id: 7985, display_name: "GSE43566" }),
    ]);
    const dirty = dirtyExperimentTargets(t, new Set(["42", "7985"]));
    expect(dirty.map((x) => x.target_id)).toEqual([7985]);
  });

  it("returns empty when no target is dirty (the common clean-commit case)", () => {
    const t = ticket([target({ target_id: 7985 }), target({ target_id: 9001 })]);
    expect(dirtyExperimentTargets(t, new Set())).toEqual([]);
    expect(dirtyExperimentTargets(t, new Set(["123456"]))).toEqual([]);
  });
});
