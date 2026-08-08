import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// Inline localStorage polyfill so this runs in the default (node)
// vitest env, matching proposalDispositions.test.ts.
beforeAll(() => {
  if (typeof window === "undefined") {
    const store = new Map<string, string>();
    const ls = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      get length() {
        return store.size;
      },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
    };
    const g = globalThis as unknown as {
      window?: { localStorage: typeof ls };
      localStorage?: typeof ls;
    };
    g.window = { localStorage: ls };
    g.localStorage = ls;
  }
});
import {
  agentFeedbackKey,
  clearAgentFeedback,
  exportAgentFeedback,
  readAgentFeedback,
  setAgentFeedback,
} from "./agentFeedback";

const EXP = 2427;
const KEY = "fv:timepoint/2h::CORRECTNESS";
const AUDIT = "audit-123";

const base = { judge: "boss_critic" as const, auditId: AUDIT, at: "2026-08-08T00:00:00Z" };

beforeEach(() => window.localStorage.clear());

describe("agentFeedback", () => {
  it("records a stance and reads it back", () => {
    setAgentFeedback(EXP, KEY, { stance: "endorse", ...base });
    expect(readAgentFeedback(EXP)[KEY]).toEqual({
      stance: "endorse",
      judge: "boss_critic",
      auditId: AUDIT,
      at: "2026-08-08T00:00:00Z",
    });
  });

  it("switches stance in place rather than accumulating", () => {
    setAgentFeedback(EXP, KEY, { stance: "endorse", ...base });
    setAgentFeedback(EXP, KEY, { stance: "flag", ...base });
    expect(readAgentFeedback(EXP)[KEY].stance).toBe("flag");
    expect(Object.keys(readAgentFeedback(EXP))).toHaveLength(1);
  });

  // A misclick must cost exactly one click to undo — the curator is
  // never stuck having said something they didn't mean.
  it("clicking the active stance again clears it", () => {
    setAgentFeedback(EXP, KEY, { stance: "flag", ...base });
    setAgentFeedback(EXP, KEY, { stance: "flag", ...base });
    expect(readAgentFeedback(EXP)[KEY]).toBeUndefined();
  });

  it("drops the storage key entirely once the last entry is cleared", () => {
    setAgentFeedback(EXP, KEY, { stance: "flag", ...base });
    setAgentFeedback(EXP, KEY, { stance: "flag", ...base });
    expect(window.localStorage.getItem(agentFeedbackKey(EXP))).toBeNull();
  });

  it("scopes by experiment", () => {
    setAgentFeedback(EXP, KEY, { stance: "endorse", ...base });
    setAgentFeedback(9999, KEY, { stance: "flag", ...base });
    expect(readAgentFeedback(EXP)[KEY].stance).toBe("endorse");
    expect(readAgentFeedback(9999)[KEY].stance).toBe("flag");
    clearAgentFeedback(EXP);
    expect(readAgentFeedback(EXP)).toEqual({});
    expect(readAgentFeedback(9999)[KEY].stance).toBe("flag");
  });

  describe("self-validation on read", () => {
    const put = (v: unknown) =>
      window.localStorage.setItem(
        agentFeedbackKey(EXP),
        JSON.stringify({ [KEY]: v }),
      );

    it("drops an entry with an unknown stance", () => {
      put({ ...base, stance: "meh" });
      expect(readAgentFeedback(EXP)).toEqual({});
    });

    it("drops an entry with an unknown judge — a future build's shape", () => {
      put({ ...base, stance: "endorse", judge: "arbiter" });
      expect(readAgentFeedback(EXP)).toEqual({});
    });

    it("drops an entry missing its audit id, which can't be attributed", () => {
      put({ stance: "endorse", judge: "boss_critic", at: base.at });
      expect(readAgentFeedback(EXP)).toEqual({});
    });

    it("survives malformed JSON without throwing", () => {
      window.localStorage.setItem(agentFeedbackKey(EXP), "{not json");
      expect(readAgentFeedback(EXP)).toEqual({});
    });

    it("keeps the good entries when a sibling is bad", () => {
      window.localStorage.setItem(
        agentFeedbackKey(EXP),
        JSON.stringify({
          [KEY]: { ...base, stance: "endorse" },
          bad: { stance: "nope" },
        }),
      );
      expect(Object.keys(readAgentFeedback(EXP))).toEqual([KEY]);
    });
  });

  it("exports a flat, audit-attributed payload for the eventual POST", () => {
    setAgentFeedback(EXP, KEY, { stance: "flag", ...base, note: "wrong axis" });
    expect(exportAgentFeedback(EXP)).toEqual({
      experiment_id: EXP,
      entries: [
        {
          verdict_key: KEY,
          stance: "flag",
          judge: "boss_critic",
          auditId: AUDIT,
          at: base.at,
          note: "wrong axis",
        },
      ],
    });
  });
});
