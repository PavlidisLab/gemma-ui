/**
 * Open-ticket roll-up — total + per-TicketType breakdown across the
 * corpus (not scoped to the current admin; the per-admin variant is
 * /tickets/summary/me, surfaced elsewhere).
 *
 * Data source: GET /tickets/summary — single grouped count query,
 * cheap to refetch. The CAB pilot writes localstore tickets with
 * associated entities; Gemma carries the parallel model so this
 * panel reflects whatever's been opened against the corpus.
 */

import { useTicketsSummary } from "../api";
import { SectionCard } from "../components/SectionCard";
import { BigNumber } from "../components/BigNumber";
import { useTimeseries } from "../timeseries";

// Sort by count desc — the priority of "what's stacking up" reads
// better than alphabetical when scanning quickly.
function sortedTypeRows(byType: Record<string, number>): Array<[string, number]> {
  return Object.entries(byType)
    .filter(([, n]) => typeof n === "number")
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function TicketsSection() {
  const { data, isError, error } = useTicketsSummary(30_000);
  const totalSeries = useTimeseries("tickets.open", data?.totalOpen ?? null);

  const rows = data ? sortedTypeRows(data.byType ?? {}) : [];
  const nonZero = rows.filter(([, n]) => n > 0);

  return (
    <SectionCard
      title="Open tickets"
      summary={data ? `${data.totalOpen} open across ${nonZero.length || 0} types` : undefined}
    >
      <div className="grid grid-cols-1 gap-3 mb-3">
        <BigNumber
          label="open"
          value={data?.totalOpen ?? "—"}
          samples={totalSeries}
        />
      </div>
      {isError ? (
        <div className="text-[11px] text-rose-700 dark:text-rose-300 mb-2">
          {(error as Error).message}
        </div>
      ) : !data ? (
        <div className="text-xs text-slate-500 italic">loading…</div>
      ) : nonZero.length === 0 ? (
        <div className="text-xs text-slate-500 italic">no open tickets.</div>
      ) : (
        <div className="max-h-48 overflow-auto border-t border-slate-100 dark:border-slate-700">
          <table className="w-full text-[11px]">
            <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 sticky top-0">
              <tr>
                <th className="text-left px-2 py-1 font-medium">type</th>
                <th className="text-right px-2 py-1 font-medium">open</th>
              </tr>
            </thead>
            <tbody>
              {nonZero.map(([type, n]) => (
                <tr
                  key={type}
                  className="border-t border-slate-100 dark:border-slate-700"
                >
                  <td className="px-2 py-1">{type}</td>
                  <td className="px-2 py-1 text-right tabular-nums font-medium">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
