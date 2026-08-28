import { useQuery } from "@tanstack/react-query";

import {
  getActiveCurationLocks,
  lockHolderPhrase,
  LOCKS_ROUTE_ABSENT,
  type ActiveCurationLock,
} from "@/api/curationLock";
import { LOCK_POLL_MS } from "@/features/design/useCurationLock";
import { relativeSince } from "@/features/design/LockChip";
import { navigate } from "@/routes";

/**
 * "Under curation" — what is being worked on right now, across the
 * whole corpus.
 *
 * New rather than reused: `LockChip` answers this for ONE experiment
 * the curator already has open, and neither the experiment list nor the
 * ticket sections carry cross-experiment lock state. What IS reused is
 * the vocabulary — `lockHolderPhrase` and `relativeSince` are the same
 * functions the chip uses, so a holder cannot be described one way here
 * and another way inside the experiment.
 *
 * 🛑 **Read-only, and no take-over here.** Stealing a lease is a write,
 * writes go through the agent relay, and a per-row steal on a list is an
 * invitation to take a lease from someone whose work you cannot see. The
 * chip inside the experiment is where that decision belongs, with the
 * draft in front of you.
 *
 * 🛑 **Three states that must not collapse into each other:**
 *   - the route does not exist yet (`LOCKS_ROUTE_ABSENT`) — we cannot
 *     answer;
 *   - the route answered with nothing — a quiet corpus, a real answer;
 *   - rows.
 * Rendering "nothing is under curation" when we simply could not ask is
 * the failure that matters: it is a confident, wrong all-clear.
 */
export function UnderCurationPanel() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["curation-locks", "active"],
    queryFn: getActiveCurationLocks,
    // Same cadence as the per-experiment chip: this answers "has someone
    // picked something up", which is a minutes-scale question, and a
    // tighter poll would spend requests to say nothing changed.
    refetchInterval: LOCK_POLL_MS,
  });

  // The listing is not built on either side yet
  // (UIB_TO_ALL_2026_08_27_WHATS_UNDER_CURATION_NEEDS_THE_INVERSE_QUERY).
  // Say so plainly rather than showing an empty list that reads as "all
  // quiet" — the same reason DiagnosticsPanel names its unavailability
  // instead of rendering blank cards.
  if (data === LOCKS_ROUTE_ABSENT) {
    return (
      <Frame>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Not available yet.
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Gemma can say whether particular datasets are held, but not yet
          list everything currently held. Until that lands this panel
          cannot tell a quiet corpus from a question it could not ask, so
          it shows neither.
        </p>
      </Frame>
    );
  }

  if (isLoading) {
    return (
      <Frame>
        <p className="text-sm text-slate-500">Checking…</p>
      </Frame>
    );
  }

  if (error) {
    return (
      <Frame>
        <p className="text-sm text-amber-800 dark:text-amber-300">
          Couldn't read what's under curation.
        </p>
      </Frame>
    );
  }

  const rows: ActiveCurationLock[] = Array.isArray(data) ? data : [];

  if (rows.length === 0) {
    return (
      <Frame>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Nothing is under curation right now.
        </p>
      </Frame>
    );
  }

  return (
    <Frame count={rows.length}>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map((lock) => {
          const { who, kind, detail } = lockHolderPhrase(lock);
          const since = relativeSince(lock.locked_at);
          return (
            <li
              key={lock.experiment_id}
              className="py-1.5 flex items-baseline gap-2 flex-wrap text-sm"
            >
              <button
                type="button"
                onClick={() => navigate(`#/experiments/${lock.experiment_id}`)}
                className="font-medium text-blue-700 hover:underline dark:text-blue-300"
              >
                {lock.experiment_short_name || `Experiment ${lock.experiment_id}`}
              </button>
              <span className="text-slate-700 dark:text-slate-200">{who}</span>
              {/* Filled = a job, hollow = a person. Same convention the
                  rest of the app uses for set-vs-detected. */}
              <span
                title={detail ? `Run: ${detail}` : "A curator, not a batch job"}
                className={
                  kind === "batch"
                    ? "text-[10px] uppercase tracking-wide px-1 rounded bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200"
                    : "text-[10px] uppercase tracking-wide px-1 rounded border border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300"
                }
              >
                {kind === "batch" ? "job" : "curator"}
              </span>
              {since ? (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  last change {since}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Frame>
  );
}

function Frame({
  children,
  count,
}: {
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <section>
      <header className="flex items-baseline gap-2 mb-2 flex-wrap">
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
          Under curation
        </h2>
        {count !== undefined ? (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {count} {count === 1 ? "experiment" : "experiments"}
          </span>
        ) : null}
      </header>
      <div className="card p-3">{children}</div>
    </section>
  );
}
