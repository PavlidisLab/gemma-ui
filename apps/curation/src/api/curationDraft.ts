/**
 * The curation draft, saved through the agent.
 *
 * 🛑 **Not `/rest/v2/...`.** Its own top-level prefix, proxied to the
 * agent (`vite.config.ts`). `/rest` is a catch-all to the curation
 * store, whose `/draft` route is the agent's crash BACKUP — so a
 * `/rest/v2/datasets/{id}/curation-draft` would land on the store no
 * matter what it was named, write the backup, forward nothing to
 * Gemma, and leave every state the save indicator renders a lie.
 *
 * **Why the agent and not Gemma:** the curation UI is a read-only
 * client of Gemma; the agent does the writes (Paul, 2026-08-25). The
 * agent writes its crash backup to disk BEFORE calling Gemma and
 * clears it only on a confirmed 200 — so the edit is durable at every
 * instant, and the agent returns only after Gemma has committed.
 *
 * ⇒ **That is what makes `Saved 12:04` honest.** It is not an
 * agent-received acknowledgement; the agent does not return until
 * Gemma has the write. If that ever changes to an early ack, this
 * wording has to weaken with it.
 */

import { api, ApiError } from "./client";
import type { Design } from "@/features/experiment/types";

/** Every state the save indicator can be in. The failure ones are the
 *  agent's own vocabulary, mapped here once. */
export type SaveState =
  | { kind: "idle" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  /** The agent could not reach Gemma. The edit is NOT lost — it is on
   *  the agent's disk and in localStorage. */
  | { kind: "offline"; detail: string }
  /** The baseline moved under the curator. Never a retry: which
   *  version wins is a human decision. */
  | { kind: "conflict"; detail: string; draftRetained: boolean }
  | { kind: "failed"; detail: string };

export interface DraftWrite {
  design: Design;
  /** The proposal this draft descends from, when it started as one. */
  parentId?: number | null;
  /** Elements the curator set aside; serialized by the caller. */
  parkedElements?: string | null;
}

export interface DraftSaved {
  /** When the AGENT OBSERVED GEMMA'S 200 — not request receipt. The
   *  agent's clock at that instant rather than a server-supplied commit
   *  time, because Gemma's draft response carries none. The difference
   *  is one round trip and this renders minutes. */
  saved_at: string;
  // 🛑 No baseline token here, deliberately. This carried
  // `baseline_last_modified` and it was structurally always null:
  // `baseline.lastModified` is what a client SENDS to get a
  // stale-baseline 409, not something a draft save returns. A draft
  // save is not a commit and has no new baseline to name.
  //
  // The token comes from the COMMIT report (`PUT /datasets/{id}/curation`
  // -> `newBaseline`) or from a preflight, which returns the current one
  // because a dry run moves nothing. Neither is the autosave path.
  // Removed agent-side 2026-08-26 rather than left permanently empty.
}

function draftPath(experimentId: number | string, curator: string): string {
  // `onBehalfOf` is REQUIRED — the agent 422s without it. It is what
  // stops every curator's draft keying to the agent and overwriting
  // each other, which is the collision both Gemma and the store were
  // fixed for on 2026-08-25.
  return `/curation-draft/${experimentId}?onBehalfOf=${encodeURIComponent(curator)}`;
}

/** Read this curator's draft. `null` when there is none — both hops
 *  answer 404 for that, which is an ordinary state.
 *
 *  Any other failure throws: a draft that exists but could not be read
 *  must not be reported as absent, because the caller's next move on a
 *  `null` is to seed from the saved design, silently discarding work. */
export async function getCurationDraft(
  experimentId: number | string,
  curator: string,
): Promise<Design | null> {
  try {
    const raw = await api.get<unknown>(draftPath(experimentId, curator));
    return parseDraft(raw);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** Pull the design out of the envelope. The payload is stored as a
 *  STRING on both hops, so it arrives as a JSON document inside a JSON
 *  document — which is what keeps it safe: `snakeify` cannot reach
 *  inside a string, so the design keeps the casing it was written with.
 *
 *  Exported for test. */
export function parseDraft(raw: unknown): Design | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const payload = o.payload_json ?? o.payload;
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload) as Design;
    } catch {
      // Corruption is not absence. Returning null here would have the
      // caller seed over the curator's work.
      throw new Error("draft payload is not valid JSON");
    }
  }
  if (payload && typeof payload === "object") return payload as Design;
  return null;
}

/**
 * Turn a failed save into the state the indicator shows.
 *
 * The agent maps its own failures onto these before we see them; this
 * is the one place that vocabulary becomes UI wording. Exported for
 * test.
 */
export function saveStateForError(e: unknown): SaveState {
  if (e instanceof ApiError) {
    if (e.status === 502) {
      return { kind: "offline", detail: e.detail || "agent could not reach Gemma" };
    }
    if (e.status === 409) {
      // `draftRetained` is the field today's UI gets wrong: it discards
      // the draft on baseline drift and never tells the curator.
      //
      // Read off the PARSED body, not off `detail`. `detail` is the
      // flattened sentence — the agent sends
      // `{error, detail, draftRetained}` and the field is a SIBLING of
      // the sentence, so scanning the string for it could never match
      // and this answered from its default every time. Right answer,
      // wrong reason, and silently so.
      const body = e.body as { draftRetained?: unknown } | null | undefined;
      // Absent ⇒ assume retained. Implying loss we cannot confirm is
      // worse than the reverse: the curator abandons work that is
      // still there.
      const retained = body?.draftRetained !== false;
      return {
        kind: "conflict",
        detail: e.detail || "the saved design moved since this draft started",
        draftRetained: retained,
      };
    }
    if (e.status === 422) {
      return { kind: "failed", detail: "no curator identity was sent with the save" };
    }
    return { kind: "failed", detail: e.detail || e.message };
  }
  return { kind: "failed", detail: e instanceof Error ? e.message : "save failed" };
}

/** Write the draft. Resolves only after the agent has Gemma's 200. */
export async function putCurationDraft(
  experimentId: number | string,
  curator: string,
  w: DraftWrite,
): Promise<DraftSaved> {
  return await api.put<DraftSaved>(draftPath(experimentId, curator), {
    payloadJson: JSON.stringify(w.design),
    ...(w.parentId != null ? { parentId: w.parentId } : {}),
    ...(w.parkedElements != null ? { parkedElements: w.parkedElements } : {}),
  });
}
