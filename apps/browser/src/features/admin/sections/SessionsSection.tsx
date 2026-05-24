/**
 * Authenticated-sessions panel. Replaces the legacy `activeUsers.jsp`
 * "FIXME table of authenticated users should go here." Anonymous
 * sessions are not tracked by SessionRegistry; this is authenticated
 * traffic only.
 */

import { useSessions } from "../api";
import { SectionCard } from "../components/SectionCard";
import { BigNumber } from "../components/BigNumber";
import { useTimeseries, fmtRelative } from "../timeseries";

export function SessionsSection() {
  const { data, isError, error } = useSessions(30_000);

  const activeSeries = useTimeseries(
    "sessions.active",
    data?.activeSessionCount ?? null,
  );

  return (
    <SectionCard
      title="Sessions"
      summary={
        data
          ? `${data.authenticatedUserCount} user${data.authenticatedUserCount === 1 ? "" : "s"} · ${data.activeSessionCount} active session${data.activeSessionCount === 1 ? "" : "s"}`
          : undefined
      }
    >
      <div className="grid grid-cols-2 gap-3 mb-3">
        <BigNumber
          label="users"
          value={data?.authenticatedUserCount ?? "—"}
        />
        <BigNumber
          label="active sessions"
          value={data?.activeSessionCount ?? "—"}
          samples={activeSeries}
        />
      </div>
      {isError ? (
        <div className="text-[11px] text-rose-700 dark:text-rose-300 mb-2">
          {(error as Error).message}
        </div>
      ) : null}
      {data && data.principals.length > 0 ? (
        <div className="max-h-56 overflow-auto border-t border-slate-100 dark:border-slate-700">
          <table className="w-full text-[11px]">
            <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 sticky top-0">
              <tr>
                <th className="text-left px-2 py-1 font-medium">user</th>
                <th className="text-left px-2 py-1 font-medium">sessions</th>
                <th className="text-left px-2 py-1 font-medium">last request</th>
                <th className="text-left px-2 py-1 font-medium">groups</th>
              </tr>
            </thead>
            <tbody>
              {data.principals.map((p) => (
                <tr
                  key={p.username}
                  className="border-t border-slate-100 dark:border-slate-700"
                >
                  <td className="px-2 py-1 font-medium">{p.username}</td>
                  <td className="px-2 py-1 tabular-nums">{p.sessionCount}</td>
                  <td className="px-2 py-1 text-slate-500 dark:text-slate-400">
                    {fmtRelative(p.lastRequest)}
                  </td>
                  <td className="px-2 py-1 text-slate-500 dark:text-slate-400 font-mono">
                    {p.authorities && p.authorities.length > 0
                      ? p.authorities
                          .map((a) => a.replace(/^GROUP_/, ""))
                          .join(", ")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-xs text-slate-500 italic">
          no authenticated users right now.
        </div>
      )}
    </SectionCard>
  );
}
