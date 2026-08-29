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
      summary="not public, or targeted by an open ticket"
    >
      <div className="grid grid-cols-1 gap-3 mb-3">
        <BigNumber
          label="datasets"
          value={data?.either != null ? data.either.toLocaleString() : "—"}
          detail={
            data
              ? `${data.openTickets.toLocaleString()} open ticket${
                  data.openTickets === 1 ? "" : "s"
                } with an experiment target`
              : undefined
          }
          samples={series}
        />
      </div>
      {isError ? (
        <div className="text-[11px] text-rose-700 dark:text-rose-300">
          {(error as Error).message}
        </div>
      ) : !data ? (
        <div className="text-xs text-slate-500 italic">loading…</div>
      ) : (
        <div className="border-t border-slate-100 dark:border-slate-700">
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
          {data.truncated ? (
            <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
              Ticket sweep stopped at the page cap — these are lower bounds.
            </div>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}
