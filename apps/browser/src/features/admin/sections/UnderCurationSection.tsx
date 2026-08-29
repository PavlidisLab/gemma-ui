/**
 * "Under curation" — Paul's definition: **private, or in a ticket.**
 *
 * The two halves live in different places and neither can answer the
 * other's question, so both are counted and the overlap is asked for
 * rather than assumed. See `useUnderCurationCounts` for the queries.
 *
 * Shown as three rows and not one number on purpose: a curator
 * reading "2,147" needs to know it is almost entirely the private
 * pile, and that the ticket queue is the small, actionable half.
 */

import { useUnderCurationCounts } from "../api";
import { SectionCard } from "../components/SectionCard";
import { BigNumber } from "../components/BigNumber";
import { useTimeseries } from "../timeseries";
import { CountRow } from "../components/CountRow";

export function UnderCurationSection() {
  const { data, isError, error } = useUnderCurationCounts();
  const series = useTimeseries("curation.under", data?.either ?? null);

  return (
    <SectionCard
      title="Under curation"
      summary={
        data
          ? `not public, or in one of ${data.openTickets.toLocaleString()} open ticket${
              data.openTickets === 1 ? "" : "s"
            }`
          : "not public, or targeted by an open ticket"
      }
    >
      <div className="flex items-start gap-4">
        <BigNumber
          className="flex-none w-28"
          label="datasets"
          // A bare dash reads as "broken" when half the answer is in
          // hand. With no `isPublic` filter the ticket half is still a
          // true lower bound, so say so with a `≥` rather than throw it
          // away — and the footnote below names what is missing.
          value={
            !data
              ? "—"
              : data.either != null
                ? data.either.toLocaleString()
                : `≥${data.inOpenTicket.toLocaleString()}`
          }
          samples={series}
        />
        <div className="flex-1 min-w-0">
      {isError ? (
        <div className="text-[11px] text-rose-700 dark:text-rose-300">
          {(error as Error).message}
        </div>
      ) : !data ? (
        <div className="text-xs text-slate-500 italic">loading…</div>
      ) : (
        <div>
          <table className="w-full text-[11px]">
            <tbody>
              <CountRow
                label="in an open ticket"
                n={data.inOpenTicket}
                of={data.either ?? undefined}
                title="Distinct experiments targeted by an OPEN or IN_PROGRESS ticket (GET /tickets?openOnly=true&targetType=EXPRESSION_EXPERIMENT)."
              />
              <CountRow
                label="not public"
                n={data.notPublic}
                of={data.either ?? undefined}
                title="datasets/count?filter=isPublic = false, as this admin sees it."
              />
              <CountRow
                label="both"
                n={data.notPublic === null ? null : data.overlap}
                of={data.either ?? undefined}
                title="Counted once in the total above. Asked for exactly (id in (…) and isPublic = false) rather than inferred."
              />
            </tbody>
          </table>
          {data.notPublic === null ? (
            <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
              This Gemma cannot filter on <code>isPublic</code>, so the total
              counts the ticket half only.
            </div>
          ) : null}
          {data.truncated ? (
            <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
              Ticket sweep stopped at the page cap — these are lower bounds.
            </div>
          ) : null}
        </div>
      )}
        </div>
      </div>
    </SectionCard>
  );
}
