/**
 * localStorage MRU backing "recent" in the experiment quick-search —
 * the datasets this curator opened, newest first. Same shape and the
 * same reasons as `design/recentTerms.ts` and `tickets/recentTickets.ts`:
 * global rather than experiment-scoped, because a curator moving
 * between experiments wants the list to follow them, and there is no
 * natural reset event.
 *
 * **Labels ARE stored here, unlike `recentTickets`.** That module keeps
 * ids only and re-resolves them, because the list it feeds is resolved
 * against the server each time it opens. This one cannot do that: in
 * remote mode the catalogue the quick-search holds is a bounded prefix
 * of Gemma's corpus (`REMOTE_CATALOGUE_CAP`), so an experiment past the
 * cut does not resolve — an ids-only list would drop the very dataset
 * the curator just came out of. The stored label is a fallback: the
 * caller prefers the catalogue's current row when the id is in it (see
 * `resolveRecentExperiments`), so a rename through `ShortNameEditor`
 * shows through where the catalogue can answer, and the visit itself
 * rewrites the label on the way in.
 *
 * Ids are kept as STRINGS and stay opaque end-to-end — the route id may
 * be a bare number or the `preboarding:N` form, and both round-trip
 * through `#/experiments/<id>`.
 */

const KEY = "gca:recent-experiments:v1";

/** Ten: what Paul asked for, and about as many rows as the header
 *  dropdown shows without a scrollbar. */
export const MAX_RECENT_EXPERIMENTS = 10;

/** Titles are stored to give each row a second line; a Gemma title can
 *  run to several hundred characters and the row truncates anyway, so
 *  only the part that can be rendered is kept. */
const MAX_TITLE = 160;

export interface RecentExperiment {
  /** Opaque dataset identifier, exactly as it appears in the route. */
  id: string;
  /** Accession / short name as of the visit. */
  label: string;
  title?: string;
  taxon?: string;
}

function coerce(v: unknown): RecentExperiment | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  // Written as a string, but an older or hand-edited entry could hold a
  // number. Anything else — including an empty id, which would navigate
  // to `#/experiments/` — is dropped rather than passed on.
  const id =
    typeof r.id === "string"
      ? r.id.trim()
      : typeof r.id === "number" && Number.isFinite(r.id)
        ? String(r.id)
        : "";
  if (!id) return null;
  const label = typeof r.label === "string" && r.label.trim() ? r.label : id;
  const out: RecentExperiment = { id, label };
  if (typeof r.title === "string" && r.title.trim()) out.title = r.title;
  if (typeof r.taxon === "string" && r.taxon.trim()) out.taxon = r.taxon;
  return out;
}

export function getRecentExperiments(): RecentExperiment[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: RecentExperiment[] = [];
    for (const v of parsed) {
      const entry = coerce(v);
      if (!entry || seen.has(entry.id)) continue;
      seen.add(entry.id);
      out.push(entry);
      if (out.length >= MAX_RECENT_EXPERIMENTS) break;
    }
    return out;
  } catch {
    // A private window, cleared site data, or storage disabled. The
    // dropdown simply has no recents — never an error.
    return [];
  }
}

/** Record a visit. Re-visiting moves the experiment to the front rather
 *  than duplicating it, and refreshes the stored label / title / taxon
 *  from what is on screen now. */
export function pushRecentExperiment(
  entry: RecentExperiment,
): RecentExperiment[] {
  const clean = coerce({
    ...entry,
    title: entry.title ? entry.title.slice(0, MAX_TITLE) : undefined,
  });
  if (!clean) return getRecentExperiments();
  try {
    const next = [
      clean,
      ...getRecentExperiments().filter((r) => r.id !== clean.id),
    ].slice(0, MAX_RECENT_EXPERIMENTS);
    window.localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  } catch {
    return getRecentExperiments();
  }
}

export function clearRecentExperiments(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}

/** The rows to render: stored entries, freshened from the catalogue
 *  where it can answer, minus anything the caller is already showing.
 *
 *  🛑 A stored entry whose id is NOT in `catalogue` is kept, not
 *  dropped. The catalogue is a bounded prefix in remote mode, so
 *  "absent from it" means "beyond the cap or not fetched yet" at least
 *  as often as it means "gone" — and the curator was in that dataset
 *  minutes ago. This is the opposite of the ticket recents rule, where
 *  the server resolves every id and an absence is an answer. */
export function resolveRecentExperiments(
  stored: RecentExperiment[],
  catalogue: {
    experiment_id: number | string;
    short_name: string;
    title?: string;
    taxon?: string;
  }[],
  excludeId?: number | string | null,
): RecentExperiment[] {
  const byId = new Map(catalogue.map((r) => [String(r.experiment_id), r]));
  const exclude = excludeId == null ? null : String(excludeId);
  const out: RecentExperiment[] = [];
  for (const entry of stored) {
    if (exclude !== null && entry.id === exclude) continue;
    const live = byId.get(entry.id);
    out.push(
      live
        ? {
            id: entry.id,
            label: live.short_name || entry.label,
            title: live.title || entry.title,
            taxon: live.taxon || entry.taxon,
          }
        : entry,
    );
  }
  return out;
}
