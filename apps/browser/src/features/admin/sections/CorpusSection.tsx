/**
 * Corpus roll-up — how many datasets there are and how they split.
 *
 * Data source: five `GET /datasets/count?filter=…` calls in parallel.
 * Counts, not measured lists: the corpus is 25,695 datasets and only a
 * count query stays honest as that grows.
 *
 * The public/private split is new. `isPublic` is ACL-derived rather
 * than a stored column, and until `f675d0d45b` (2026-08-29) it threw
 * for authenticated admins — the only callers this page has. It is
 * here partly so the number keeps getting looked at.
 */

import { useCorpusCounts } from "../api";
import { SectionCard } from "../components/SectionCard";
import { BigNumber } from "../components/BigNumber";
import { useTimeseries } from "../timeseries";
import { CountRow, pct } from "../components/CountRow";

export function CorpusSection() {
  const { data, isError, error } = useCorpusCounts();
  const totalSeries = useTimeseries("corpus.datasets", data?.total ?? null);

  return (
    <SectionCard
      title="Datasets"
      summary={
        data
          ? [
              data.private === null
                ? null
                : `${data.private.toLocaleString()} not public`,
              data.needsAttention === null
                ? null
                : `${data.needsAttention.toLocaleString()} need attention`,
            ]
              .filter(Boolean)
              .join(" · ") || undefined
          : undefined
      }
    >
      <div className="grid grid-cols-1 gap-3 mb-3">
        <BigNumber
          label="datasets"
          value={data ? data.total.toLocaleString() : "—"}
          samples={totalSeries}
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
                label="public"
                n={data.public}
                of={data.total}
                title="Visible without signing in."
              />
              <CountRow
                label="not public"
                n={data.private}
                of={data.total}
                title="Restricted by ACL. Counted as this admin sees them — an anonymous caller's answer to the same question is 0, correctly."
              />
              <CountRow
                label="troubled"
                n={data.troubled}
                of={data.total}
                tone={(data.troubled ?? 0) > 0 ? "warn" : undefined}
                title="curationDetails.troubled — something is known to be wrong with the data."
              />
              <CountRow
                label="needs attention"
                n={data.needsAttention}
                of={data.total}
                tone={(data.needsAttention ?? 0) > 0 ? "warn" : undefined}
                title="curationDetails.needsAttention — flagged for a curator to look at."
              />
            </tbody>
          </table>
          {data.public !== null &&
          data.private !== null &&
          data.public + data.private !== data.total ? (
            <div
              className="mt-2 text-[11px] text-amber-700 dark:text-amber-300"
              title="public + not public should equal the total; a gap means the two questions were answered against different visibility."
            >
              {pct(data.public + data.private, data.total)} accounted for —{" "}
              {(data.total - data.public - data.private).toLocaleString()}{" "}
              dataset(s) in neither bucket.
            </div>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}
