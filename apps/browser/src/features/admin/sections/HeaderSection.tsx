/**
 * Top-of-page identity strip — build version + gitHash + uptime +
 * roll-up health pill. Anonymous-safe endpoints (`/info`, `/health`),
 * so this renders even when the admin gate hasn't authenticated
 * yet; that lets a curator see "the server is up" before signing in.
 */

import { useBuildInfo, useHealthRollup } from "../api";
import { HealthDot } from "../components/HealthDot";
import { fmtDuration } from "../timeseries";

export function HeaderSection() {
  const info = useBuildInfo();
  const health = useHealthRollup(15_000);
  const build = info.data;
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 px-4 py-2 flex items-center justify-between flex-wrap gap-3">
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Gemma {build?.version ?? "—"}
        </span>
        {build?.buildTimestamp ? (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            built {build.buildTimestamp}
          </span>
        ) : null}
        {build?.gitHash ? (
          <a
            href={`https://github.com/PavlidisLab/Gemma/commits/${build.gitHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-blue-700 dark:text-blue-300 hover:underline"
            title={`open ${build.gitHash} on GitHub`}
          >
            {build.gitHash.slice(0, 10)}
          </a>
        ) : null}
        {build?.jvmName ? (
          <span
            className="text-[11px] text-slate-500 dark:text-slate-400"
            title={`${build.jvmName} ${build.jvmVersion ?? ""} · ${build.osName ?? ""} ${build.osVersion ?? ""} ${build.osArch ?? ""}`}
          >
            {build.jvmName}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-3 text-xs">
        {health.data ? (
          <HealthDot
            status={health.data.status}
            withLabel
            label={health.data.status.toLowerCase()}
          />
        ) : null}
        {build?.uptimeMillis != null ? (
          <span className="text-slate-600 dark:text-slate-300">
            uptime{" "}
            <span className="font-mono">
              {fmtDuration(build.uptimeMillis)}
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
