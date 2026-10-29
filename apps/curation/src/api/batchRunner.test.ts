import { describe, expect, it } from "vitest";
import ticket49 from "./__fixtures__/batchRunnerEvents.ticket49.json";
import { batchState, commentText, renderRequest, type TicketEvent } from "./batchRunner";
import { snakeify } from "./client";

// The two real events from Gemma ticket #49 (2026-10-29): amaximo's preview request
// (1362) and the agents' runner's reply (1363) — the contract between
// ticket_channel.py and this module, measured rather than restated.
const real = snakeify(ticket49) as TicketEvent[];

const comment = (id: number, who: string, text: string): TicketEvent => ({
  id, type: "COMMENTED", actor_name: who, occurred_at: "2026-10-29T12:00:00Z", payload: JSON.stringify(text),
});

describe("batch runner channel", () => {
  it("reads the runner's real reply on ticket 49", () => {
    const s = batchState(real);
    expect(s.latest?.request_event_id).toBe(1362);
    expect(s.latest?.kind).toBe("preview");
    expect(s.latest?.next_label).toBe("Land in Gemma");
    expect(s.latest?.experiments.length).toBeGreaterThan(10);
    expect(s.latest?.experiments.find((x) => x.accession === "GSE344711")?.action).toBe("curator_review");
    expect(s.pending).toEqual([]);
    expect(s.auto.on).toBe(false);
  });

  it("writes the same request the Python runner parses", () => {
    // The real request (event 1362) came from the Python side: same prose line, and a
    // block that parses to the same request (Python writes `6.0` and spaces; JSON is JSON).
    const ours = renderRequest("preview", "amaximo");
    const theirs = commentText(real[0]);
    expect(ours.split("\n")[0]).toBe(theirs.split("\n")[0]);
    const blockOf = (t: string) => JSON.parse(/batch-executor:request (\{.*\})/.exec(t)![1]);
    expect(blockOf(ours)).toEqual(blockOf(theirs));
    expect(renderRequest("run", "amaximo", 5)).toContain('"action":"run","agent_runs":5');
    expect(renderRequest("run", "amaximo", 9999)).toContain('"agent_runs":100');
  });

  it("a request newer than the latest result is pending", () => {
    const s = batchState([...real, comment(1400, "amaximo", renderRequest("run", "amaximo", 3))]);
    expect(s.pending).toEqual([{ id: 1400, action: "run", who: "amaximo", at: "2026-10-29T12:00:00Z" }]);
  });

  it("auto-continue follows the newest request until a result reports it", () => {
    let s = batchState([...real, comment(1401, "amaximo", renderRequest("auto_on", "amaximo", 2, 4))]);
    expect(s.auto).toMatchObject({ on: true, interval_hours: 4, agent_runs: 2 });
    s = batchState([...real, comment(1401, "amaximo", renderRequest("auto_on", "amaximo", 2, 4)),
                    comment(1402, "amaximo", renderRequest("auto_off", "amaximo"))]);
    expect(s.auto.on).toBe(false);
  });

  it("ignores requests written by the agent and comments without a block", () => {
    const s = batchState([comment(1, "gemmaAgent", renderRequest("run", "x")), comment(2, "amaximo", "please run")]);
    expect(s.pending).toEqual([]);
    expect(s.latest).toBeNull();
  });
});
