/**
 * Which tickets this curator has pinned to the top of the dashboard.
 *
 * Client-side and local by design (Paul, 2026-09-03: *"it can be a
 * client side thing"*) — a pin is a view preference, not a fact about
 * the ticket, so it never leaves the browser and no other curator sees
 * it. That also means it does not follow the curator to another machine,
 * which is the trade the localStorage choice makes.
 *
 * The dashboard is cross-experiment, so the key is unscoped — same shape
 * as `curator_dashboard.ticket_filter` / `.ticket_sort` beside it. (The
 * per-experiment scoping rule applies to flags ABOUT an experiment;
 * there is no experiment here to scope to.)
 *
 * 🛑 **Validated on every read.** What comes back is whatever was in the
 * browser the last time any version of this app wrote it, so it is
 * parsed defensively and anything that is not a finite ticket id is
 * dropped rather than trusted into the ordering.
 */
import { useCallback, useEffect, useState } from "react";

export const PINNED_STORAGE_KEY = "curator_dashboard.pinned_tickets";

/** Fired on `window` after a write, so every mounted reader re-reads.
 *  The native `storage` event only fires in OTHER tabs, which would
 *  leave a second list on the same page stale. */
const PINNED_EVENT = "curator-dashboard:pinned-tickets";

/** Parse a stored value into a set of ticket ids, dropping anything
 *  that isn't one. Exported for test. */
export function parsePinned(raw: string | null): Set<number> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter(
        (v): v is number => typeof v === "number" && Number.isInteger(v),
      ),
    );
  } catch {
    // Not JSON at all — treat it as no pins rather than throwing on a
    // dashboard render.
    return new Set();
  }
}

function readPinned(): Set<number> {
  if (typeof window === "undefined") return new Set();
  try {
    return parsePinned(window.localStorage.getItem(PINNED_STORAGE_KEY));
  } catch {
    return new Set();
  }
}

function writePinned(ids: Set<number>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PINNED_STORAGE_KEY,
      JSON.stringify([...ids].sort((a, b) => a - b)),
    );
  } catch {
    // Quota / private mode — the pin is lost on reload, which is a
    // better outcome than a dashboard that throws on a click.
  }
  window.dispatchEvent(new Event(PINNED_EVENT));
}

/** The curator's pinned ticket ids, plus a toggle.
 *
 *  `prune` drops ids the curator can no longer see. Call it once the
 *  ticket list has actually loaded, never on an empty in-flight list —
 *  pruning against a list that has not arrived would clear every pin on
 *  a cold load. */
export function usePinnedTickets(): {
  pinned: Set<number>;
  isPinned: (id: number) => boolean;
  toggle: (id: number) => void;
  prune: (visibleIds: Iterable<number>) => void;
} {
  const [pinned, setPinned] = useState<Set<number>>(readPinned);

  useEffect(() => {
    const sync = () => setPinned(readPinned());
    window.addEventListener(PINNED_EVENT, sync);
    // Another TAB pinning something should show up here too.
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PINNED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const toggle = useCallback((id: number) => {
    const next = readPinned();
    if (next.has(id)) next.delete(id);
    else next.add(id);
    writePinned(next);
    setPinned(next);
  }, []);

  const prune = useCallback((visibleIds: Iterable<number>) => {
    const visible = new Set(visibleIds);
    const current = readPinned();
    const kept = new Set([...current].filter((id) => visible.has(id)));
    if (kept.size === current.size) return;
    writePinned(kept);
    setPinned(kept);
  }, []);

  const isPinned = useCallback((id: number) => pinned.has(id), [pinned]);

  return { pinned, isPinned, toggle, prune };
}
