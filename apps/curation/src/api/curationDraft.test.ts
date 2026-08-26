/**
 * @vitest-environment jsdom
 *
 * The save indicator's honesty depends on three things this pins:
 * the request going to the AGENT and not the store, `onBehalfOf` always
 * riding along, and each failure landing on the state that describes it.
 *
 * Verified against the live agent 2026-08-25:
 *   GET /curation-draft/9?onBehalfOf=paul -> 404 {"detail":"no draft for dataset 9"}
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { ApiError } from "./client";
import type { Design } from "@/features/experiment/types";
import {
  getCurationDraft,
  parseDraft,
  putCurationDraft,
  saveStateForError,
} from "./curationDraft";

const design = { experiment_id: 9, tags: [], factors: [] } as unknown as Design;

function stub(status: number, body: unknown) {
  // Params typed explicitly: `vi.fn(async () => …)` infers a zero-arg
  // tuple, so `spy.mock.calls[0][0]` is a type error even though the
  // test passes — vitest strips types, tsc does not.
  const spy = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

describe("where the request goes", () => {
  it("uses the agent prefix, never /rest", async () => {
    const spy = stub(200, { saved_at: "2026-08-25T19:04:00Z" });
    await putCurationDraft(9, "paul", { design });
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain("/curation-draft/9");
    // 🛑 The failure this exists to prevent: /rest is a catch-all to
    // the STORE, whose /draft route is the agent's crash backup. A save
    // that goes there writes the backup and forwards nothing, and every
    // state the indicator renders becomes a lie.
    expect(url).not.toContain("/rest");
  });

  it("always sends onBehalfOf — the agent 422s without it", async () => {
    const spy = stub(200, { saved_at: "x" });
    await putCurationDraft(9, "paul o'brien", { design });
    expect(String(spy.mock.calls[0][0])).toContain(
      `onBehalfOf=${encodeURIComponent("paul o'brien")}`,
    );
  });

  it("sends the design as a STRING, and omits what was not given", async () => {
    const spy = stub(200, { saved_at: "x" });
    await putCurationDraft(9, "paul", { design });
    const init = spy.mock.calls[0][1];
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ payloadJson: JSON.stringify(design) });
    expect(typeof body.payloadJson).toBe("string");
  });
});

describe("reading a draft", () => {
  it("treats 404 as 'no draft', not as an error", async () => {
    stub(404, { detail: "no draft for dataset 9" });
    await expect(getCurationDraft(9, "paul")).resolves.toBeNull();
  });

  it("THROWS on any other failure — absent and unreadable are different", async () => {
    // A null here would have the caller seed from the saved design and
    // silently discard whatever the draft held.
    stub(500, { detail: "boom" });
    await expect(getCurationDraft(9, "paul")).rejects.toThrow();
  });

  it("unwraps the stringified payload", () => {
    expect(parseDraft({ payload_json: JSON.stringify(design) })).toEqual(design);
    expect(parseDraft({ draft_id: 1 })).toBeNull();
  });

  it("throws on a payload that will not parse", () => {
    expect(() => parseDraft({ payload_json: "{nope" })).toThrow(/not valid JSON/);
  });
});

describe("what the curator is told when a save fails", () => {
  it("502 means offline, and the work is not lost", () => {
    const s = saveStateForError(
      new ApiError("x", 502, "Bad Gateway", "unreachable: connection refused"),
    );
    expect(s.kind).toBe("offline");
  });

  it("409 is a conflict that keeps the draft, and is never a retry", () => {
    const s = saveStateForError(
      new ApiError("x", 409, "Conflict", '{"draftRetained":true,"detail":"moved"}'),
    );
    expect(s).toMatchObject({ kind: "conflict", draftRetained: true });
  });

  it("assumes the draft survived when the 409 does not say", () => {
    // Implying loss we cannot confirm is worse than the reverse: the
    // curator abandons work that is still there.
    const s = saveStateForError(new ApiError("x", 409, "Conflict", "baseline moved"));
    expect(s).toMatchObject({ kind: "conflict", draftRetained: true });
  });

  it("names the missing identity on a 422 rather than saying 'failed'", () => {
    const s = saveStateForError(new ApiError("x", 422, "Unprocessable", ""));
    expect(s.kind).toBe("failed");
    expect((s as { detail: string }).detail).toMatch(/curator identity/i);
  });

  it("falls back to the server's own sentence", () => {
    const s = saveStateForError(new ApiError("x", 500, "Error", "index rebuilding"));
    expect(s).toEqual({ kind: "failed", detail: "index rebuilding" });
  });
});
