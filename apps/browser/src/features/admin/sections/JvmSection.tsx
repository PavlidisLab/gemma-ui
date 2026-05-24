/**
 * JVM / OS panel — heap (with sparkline of usedBytes over time),
 * thread counts, system load average. Polls /admin/system every
 * 5s (cadence baked into the hook); the sparkline ring buffer
 * sees that and trims to the rolling window.
 */

import { useSystemSnapshot } from "../api";
import { SectionCard } from "../components/SectionCard";
import { BigNumber } from "../components/BigNumber";
import { useTimeseries, fmtBytes, fmtNumber } from "../timeseries";

export function JvmSection() {
  const { data, isError, error } = useSystemSnapshot(5_000);

  const heapUsed = data?.heap?.usedBytes ?? null;
  const heapCommitted = data?.heap?.committedBytes ?? null;
  const heapMax = data?.heap?.maxBytes ?? null;
  const liveThreads = data?.threads?.liveCount ?? null;
  const load =
    data?.systemLoadAverage != null && data.systemLoadAverage >= 0
      ? data.systemLoadAverage
      : null;

  const heapSamples = useTimeseries("jvm.heap.used", heapUsed);
  const threadSamples = useTimeseries("jvm.threads.live", liveThreads);
  const loadSamples = useTimeseries("jvm.load", load);

  return (
    <SectionCard
      title="JVM / OS"
      summary={
        data?.osName
          ? `${data.osName}${data.osArch ? " · " + data.osArch : ""} · ${data.availableProcessors} cpu`
          : undefined
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <BigNumber
          label="heap used"
          value={heapUsed != null ? fmtBytes(heapUsed) : "—"}
          detail={
            heapCommitted != null && heapMax != null && heapMax > 0 ? (
              <>
                committed {fmtBytes(heapCommitted)} · max {fmtBytes(heapMax)}
              </>
            ) : heapCommitted != null ? (
              <>committed {fmtBytes(heapCommitted)}</>
            ) : undefined
          }
          samples={heapSamples}
        />
        <div className="flex flex-col justify-end">
          {heapUsed != null && heapMax != null && heapMax > 0 ? (
            <HeapBar
              used={heapUsed}
              committed={heapCommitted ?? heapUsed}
              max={heapMax}
            />
          ) : null}
        </div>
        <BigNumber
          label="threads"
          value={liveThreads ?? "—"}
          detail={
            data?.threads
              ? `${data.threads.daemonCount} daemon · peak ${data.threads.peakCount}`
              : undefined
          }
          samples={threadSamples}
        />
        <BigNumber
          label="load avg"
          value={load != null ? fmtNumber(load) : "—"}
          detail={
            data?.availableProcessors
              ? `${data.availableProcessors} cpus available`
              : undefined
          }
          samples={loadSamples}
        />
      </div>
      {isError ? (
        <div className="mt-2 text-[11px] text-rose-700 dark:text-rose-300">
          {(error as Error).message}
        </div>
      ) : null}
    </SectionCard>
  );
}

function HeapBar({
  used,
  committed,
  max,
}: {
  used: number;
  committed: number;
  max: number;
}) {
  const usedPct = Math.min(100, (used / max) * 100);
  const committedPct = Math.min(100, (committed / max) * 100);
  return (
    <div className="space-y-1">
      <div className="relative h-2 rounded bg-slate-100 dark:bg-slate-700 overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-blue-200 dark:bg-blue-900"
          style={{ width: `${committedPct}%` }}
          title={`committed ${fmtBytes(committed)} (${committedPct.toFixed(0)}%)`}
        />
        <div
          className="absolute inset-y-0 left-0 bg-blue-600 dark:bg-blue-400"
          style={{ width: `${usedPct}%` }}
          title={`used ${fmtBytes(used)} (${usedPct.toFixed(0)}%)`}
        />
      </div>
      <div className="flex items-baseline justify-between text-[10px] text-slate-500 dark:text-slate-400">
        <span>{usedPct.toFixed(0)}% used</span>
        <span>{fmtBytes(max)} max</span>
      </div>
    </div>
  );
}
