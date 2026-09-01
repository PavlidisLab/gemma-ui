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
import { useCurationCounts } from "@/api/curationCounts";

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
    // 🛑 The live-holder list is still not answerable — `GET
    // /datasets/curation/locks` takes a `datasets` list and answers
    // per-id, and with no ids it returns `{}`, which means "I checked
    // nothing" rather than "the corpus is quiet". Building on that
    // empty object would print a confident, wrong all-clear.
    //
    // But counts and statuses ARE answerable, which is what the panel
    // was asked for (Paul, 2026-09-01: "we just want counts and
    // statuses, and we also have a link on the page that goes to the
    // list of experiments"). So the panel stops being a placeholder and
    // becomes the summary, with the one thing still missing named in a
    // line rather than a paragraph.
    return <CurationCounts />;
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

/** Corpus-wide curation counts. What the panel shows until — and
 *  arguably after — the live-holder list exists.
 *
 *  🛑 **A dash is not a zero.** `null` means the count could not be
 *  asked for (local mode serves no `/datasets/count`, or the filter
 *  property changed under us); `0` means it was asked and the answer is
 *  none. Rendering both as "0" is the same confident-wrong-all-clear
 *  this panel was built to avoid, one level down. */
function CurationCounts() {
  const { statuses, summary, isLoading } = useCurationCounts();
  return (
    <Frame>
      {isLoading ? (
        <p className="text-sm text-slate-500">Counting…</p>
      ) : (
        <>
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            {statuses.map((s) => (
              <div key={s.key} title={s.hint}>
                <dt className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {s.label}
                </dt>
                <dd className="text-lg font-semibold text-slate-800 dark:text-slate-100 tabular-nums">
                  {s.count === null ? (
                    <span
                      className="text-slate-400"
                      title="Could not ask — this count is unavailable here, which is not the same as none."
                    >
                      —
                    </span>
                  ) : (
                    s.count.toLocaleString()
                  )}
                </dd>
              </div>
            ))}
            {summary ? (
              <div title="Open curation tickets across the corpus. Scratchpads are counted separately — one is never 'done', so counting it as outstanding work would leave every curator permanently behind.">
                <dt className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Open tickets
                </dt>
                <dd className="text-lg font-semibold text-slate-800 dark:text-slate-100 tabular-nums">
                  {(summary.total_open ?? 0).toLocaleString()}
                  {summary.scratchpad_open ? (
                    <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">
                      + {summary.scratchpad_open} scratchpad
                      {summary.scratchpad_open === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </dd>
              </div>
            ) : null}
          </dl>

          <div className="mt-3 flex items-baseline gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => navigate("#/all-experiments")}
              className="text-xs text-blue-700 hover:underline dark:text-blue-300"
            >
              All experiments →
            </button>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Who is holding a dataset right now is still per-dataset
              only — the lock chip inside an experiment answers it.
            </span>
          </div>
        </>
      )}
    </Frame>
  );
}
