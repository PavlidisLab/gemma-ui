/**
 * Holding the editing lease while a curator has an experiment open.
 *
 * gembro's §4/§5: acquire once when the dataset opens; the autosaves
 * hold it from there, because Gemma refreshes `EXPIRES_AT` server-side
 * on every draft PUT. **No refresh call belongs here** — and
 * `refresh()` returns empty rather than acquiring when the caller holds
 * no lock, so a save can never take a lease nobody asked for.
 *
 * 🛑 Advisory throughout. A failure to acquire is not a failure to
 * edit: the curator carries on, the chip says who has it, and
 * correctness stays with Gemma's `baseline.lastModified` 409. Nothing
 * here may block, disable, or gate.
 *
 * Only acquires when editing is possible. A read-only viewer taking
 * the lease would lock out the person who can actually change things.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useMe } from "@/api/session";
import {
  acquireCurationLock,
  getCurationLock,
  releaseCurationLock,
  type CurationLock,
} from "@/api/curationLock";

/** How often the chip re-reads. Slow on purpose: this answers "has
 *  someone taken over", which is a minutes-scale question, and a
 *  tighter poll would spend requests to tell the curator nothing. */
export const LOCK_POLL_MS = 30_000;

export interface CurationLockHandle {
  lock: CurationLock | null;
  /** The current curator, so the chip can tell "you" from "Alice". */
  me: string | null;
  takeOver: () => void;
  takingOver: boolean;
}

export function useCurationLock({
  experimentId,
  enabled = true,
}: {
  experimentId: number | string;
  enabled?: boolean;
}): CurationLockHandle {
  const meQuery = useMe();
  const me = meQuery.data?.username ?? null;
  const [lock, setLock] = useState<CurationLock | null>(null);
  const [takingOver, setTakingOver] = useState(false);
  const alive = useRef(true);

  const read = useCallback(async () => {
    try {
      const l = await getCurationLock(experimentId);
      if (alive.current) setLock(l);
    } catch {
      // A lock we cannot read is not an editing problem. Leave the last
      // known state rather than flashing the chip away and back.
    }
  }, [experimentId]);

  // Acquire on open, release on leave. The cleanup runs before the id
  // changes, so walking to another experiment releases the one being
  // left rather than the one being entered.
  useEffect(() => {
    alive.current = true;
    if (!enabled || !me) return;
    let released = false;
    void (async () => {
      try {
        const res = await acquireCurationLock(experimentId, me);
        if (!alive.current) return;
        // Held by someone else is an ordinary answer, not an error —
        // render it and let the curator decide.
        setLock(
          res.granted
            ? res.lock
            : {
                locked: true,
                locked_by: res.heldBy.locked_by,
                locked_at: res.heldBy.locked_at,
                expires_at: res.heldBy.expires_at,
                stolen_from: null,
                stolen_at: null,
              },
        );
      } catch {
        // Could not reach the lock service at all. Editing continues.
        void read();
      }
    })();
    return () => {
      alive.current = false;
      if (released) return;
      released = true;
      // Best-effort. An unreleased lease expires on its TTL, so a
      // failed release costs a stale chip for a while and nothing else.
      void releaseCurationLock(experimentId, me).catch(() => {});
    };
  }, [experimentId, enabled, me, read]);

  // Poll for display only — this is how the curator learns someone
  // took over. Never re-acquires.
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => void read(), LOCK_POLL_MS);
    return () => window.clearInterval(id);
  }, [enabled, read]);

  const takeOver = useCallback(() => {
    if (!me || takingOver) return;
    setTakingOver(true);
    void (async () => {
      try {
        const res = await acquireCurationLock(experimentId, me, { steal: true });
        if (res.granted && alive.current) setLock(res.lock);
      } catch {
        void read();
      } finally {
        if (alive.current) setTakingOver(false);
      }
    })();
  }, [experimentId, me, takingOver, read]);

  return { lock, me, takeOver, takingOver };
}
