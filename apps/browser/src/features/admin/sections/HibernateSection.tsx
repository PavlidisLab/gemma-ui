/**
 * Hibernate stats panel — query / cache counters with sparklines of
 * the per-tick delta. The cumulative counters get reset by the
 * `[reset]` button (POST /admin/hibernate/reset).
 *
 * `statisticsEnabled=false` means counters are frozen at zero; we
 * surface that as an amber pill so a curator doesn't stare at "0"
 * wondering if traffic is dead.
 */

import {
  useHibernateStats,
  useResetHibernateStats,
} from "../api";
import { SectionCard } from "../components/SectionCard";
import { BigNumber } from "../components/BigNumber";
import { ConfirmButton } from "../components/ConfirmButton";
import { useDeltaTimeseries, useTimeseries, fmtNumber } from "../timeseries";

export function HibernateSection() {
  const { data, isError, error } = useHibernateStats(10_000);
  const reset = useResetHibernateStats();

  const queryExec = data?.queryExecutionCount ?? null;
  const queryMax = data?.queryExecutionMaxTime ?? null;
  const sessionOpen = data?.sessionOpenCount ?? null;

  const queryExecDelta = useDeltaTimeseries(
    "hib.query.exec",
    typeof queryExec === "number" ? queryExec : null,
  );
  const queryMaxSamples = useTimeseries(
    "hib.query.maxMs",
    typeof queryMax === "number" ? queryMax : null,
  );

  const qCacheHit = data?.queryCacheHitCount ?? 0;
  const qCacheMiss = data?.queryCacheMissCount ?? 0;
  const qCacheRatio =
    qCacheHit + qCacheMiss > 0
      ? qCacheHit / (qCacheHit + qCacheMiss)
      : null;

  const l2Hit = data?.secondLevelCacheHitCount ?? 0;
  const l2Miss = data?.secondLevelCacheMissCount ?? 0;
  const l2Ratio =
    l2Hit + l2Miss > 0 ? l2Hit / (l2Hit + l2Miss) : null;

  const statsOff = data?.statisticsEnabled === false;

  return (
    <SectionCard
      title="Hibernate"
      summary={
        statsOff
          ? "statisticsEnabled=false — counters are frozen at zero"
          : undefined
      }
      accessory={
        <ConfirmButton
          label="reset counters"
          confirmLabel="reset"
          tone="danger"
          disabled={reset.isPending}
          onConfirm={() => reset.mutate()}
          title="POST /admin/hibernate/reset — zeroes every counter on the live SessionFactory"
        />
      }
    >
      {statsOff ? (
        <div className="mb-2 inline-block text-[11px] px-2 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100 dark:border-amber-700">
          stats disabled server-side
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <BigNumber
          label="queries executed"
          value={typeof queryExec === "number" ? fmtNumber(queryExec) : "—"}
          detail={
            queryExecDelta.length > 1 ? (
              <>per-tick delta over last 15m</>
            ) : undefined
          }
          samples={queryExecDelta}
        />
        <BigNumber
          label="max query time"
          value={
            typeof queryMax === "number" ? `${fmtNumber(queryMax)} ms` : "—"
          }
          detail={
            data?.queryExecutionMaxTimeQueryString ? (
              <span
                className="truncate inline-block max-w-[18ch] font-mono"
                title={data.queryExecutionMaxTimeQueryString}
              >
                {data.queryExecutionMaxTimeQueryString}
              </span>
            ) : undefined
          }
          samples={queryMaxSamples}
        />
        <BigNumber
          label="sessions opened"
          value={typeof sessionOpen === "number" ? fmtNumber(sessionOpen) : "—"}
          detail={
            data?.sessionCloseCount != null
              ? `${fmtNumber(data.sessionCloseCount)} closed`
              : undefined
          }
        />
        <BigNumber
          label="transactions"
          value={
            typeof data?.transactionCount === "number"
              ? fmtNumber(data.transactionCount)
              : "—"
          }
          detail={
            data?.flushCount != null ? `${fmtNumber(data.flushCount)} flushes` : undefined
          }
        />
        <BigNumber
          label="query-cache hit ratio"
          value={
            qCacheRatio != null
              ? `${(qCacheRatio * 100).toFixed(0)}%`
              : "—"
          }
          detail={
            qCacheRatio != null
              ? `${fmtNumber(qCacheHit)} hits / ${fmtNumber(qCacheMiss)} misses`
              : "no query-cache traffic"
          }
        />
        <BigNumber
          label="L2 hit ratio"
          value={
            l2Ratio != null ? `${(l2Ratio * 100).toFixed(0)}%` : "—"
          }
          detail={
            l2Ratio != null
              ? `${fmtNumber(l2Hit)} hits / ${fmtNumber(l2Miss)} misses`
              : "no L2 traffic"
          }
        />
      </div>
      {reset.isError ? (
        <div className="mt-2 text-[11px] text-rose-700 dark:text-rose-300">
          reset failed: {(reset.error as Error).message}
        </div>
      ) : null}
      {isError ? (
        <div className="mt-2 text-[11px] text-rose-700 dark:text-rose-300">
          {(error as Error).message}
        </div>
      ) : null}
    </SectionCard>
  );
}
