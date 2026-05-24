/**
 * Background-jobs panel — counts by status + a recent-tasks table.
 * Tasks evict from the in-memory store ~10 minutes after completion,
 * so this is a near-real-time view, not a job history.
 */

import { useJobs, type JobStatus } from "../api";
import { SectionCard } from "../components/SectionCard";
import { BigNumber } from "../components/BigNumber";
import { useTimeseries, fmtRelative } from "../timeseries";

const STATUS_ORDER: JobStatus[] = [
  "running",
  "queued",
  "completed",
  "failed",
  "cancelling",
  "unknown",
];

const STATUS_TONE: Record<JobStatus, string> = {
  running: "text-emerald-700 dark:text-emerald-300",
  queued: "text-amber-700 dark:text-amber-300",
  completed: "text-slate-600 dark:text-slate-300",
  failed: "text-rose-700 dark:text-rose-300",
  cancelling: "text-amber-700 dark:text-amber-300",
  unknown: "text-slate-500 dark:text-slate-400",
};

export function JobsSection() {
  const { data, isError, error } = useJobs(10_000);

  const queuedSeries = useTimeseries("jobs.queued", data?.counts?.queued ?? null);
  const runningSeries = useTimeseries("jobs.running", data?.counts?.running ?? null);

  return (
    <SectionCard
      title="Background jobs"
      summary={
        data
          ? `${data.counts?.running ?? 0} running · ${data.counts?.queued ?? 0} queued · ${data.counts?.completed ?? 0} done`
          : undefined
      }
    >
      <div className="grid grid-cols-2 gap-3 mb-3">
        <BigNumber
          label="running"
          value={data?.counts?.running ?? "—"}
          samples={runningSeries}
        />
        <BigNumber
          label="queued"
          value={data?.counts?.queued ?? "—"}
          samples={queuedSeries}
        />
      </div>
      <div className="flex flex-wrap gap-2 text-[11px] mb-2">
        {STATUS_ORDER.map((s) => {
          const n = data?.counts?.[s] ?? 0;
          if (n === 0 && s !== "running" && s !== "queued") return null;
          return (
            <span
              key={s}
              className={"inline-flex items-baseline gap-1 " + STATUS_TONE[s]}
            >
              <span className="font-medium tabular-nums">{n}</span>
              <span>{s}</span>
            </span>
          );
        })}
      </div>
      {isError ? (
        <div className="text-[11px] text-rose-700 dark:text-rose-300 mb-2">
          {(error as Error).message}
        </div>
      ) : null}
      {(data?.tasks ?? []).length > 0 ? (
        <div className="max-h-56 overflow-auto border-t border-slate-100 dark:border-slate-700">
          <table className="w-full text-[11px]">
            <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 sticky top-0">
              <tr>
                <th className="text-left px-2 py-1 font-medium">task</th>
                <th className="text-left px-2 py-1 font-medium">status</th>
                <th className="text-left px-2 py-1 font-medium">owner</th>
                <th className="text-left px-2 py-1 font-medium">submitted</th>
              </tr>
            </thead>
            <tbody>
              {(data?.tasks ?? []).map((t) => (
                <tr
                  key={t.taskId}
                  className="border-t border-slate-100 dark:border-slate-700"
                  title={t.message ?? t.error ?? t.taskClass ?? ""}
                >
                  <td className="px-2 py-1 font-mono truncate max-w-[24ch]">
                    {t.taskName ?? t.taskClass ?? t.taskId}
                  </td>
                  <td className={"px-2 py-1 " + STATUS_TONE[t.status]}>
                    {t.status}
                  </td>
                  <td className="px-2 py-1">{t.owner ?? "—"}</td>
                  <td className="px-2 py-1 text-slate-500 dark:text-slate-400">
                    {fmtRelative(t.submittedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-xs text-slate-500 italic">no tasks tracked.</div>
      )}
    </SectionCard>
  );
}
