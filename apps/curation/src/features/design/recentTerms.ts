/**
 * localStorage MRU list backing "recently used" in the
 * OntologyTermPicker dropdown. Global (not experiment-scoped) — a
 * curator picking the same disease/treatment term across several
 * experiments in one session benefits from it following them, and
 * there's no natural "reset" event to clear it on.
 *
 * Capped at 3 entries, most-recent-first, deduped on
 * ``label + uri`` so re-picking an existing entry just moves it to
 * the front instead of creating a duplicate.
 */

const KEY = "gca:recent-terms:v1";
const MAX = 3;

export interface RecentTerm {
  label: string;
  uri: string | null;
}

export function getRecentTerms(): RecentTerm[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (t): t is RecentTerm =>
          !!t && typeof t === "object" && typeof t.label === "string",
      )
      .slice(0, MAX);
  } catch {
    return [];
  }
}

export function pushRecentTerm(term: RecentTerm): RecentTerm[] {
  const label = term.label.trim();
  if (!label) return getRecentTerms();
  const uri = term.uri ?? null;
  try {
    const existing = getRecentTerms().filter(
      (t) => !(t.label === label && t.uri === uri),
    );
    const next = [{ label, uri }, ...existing].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  } catch {
    return getRecentTerms();
  }
}
