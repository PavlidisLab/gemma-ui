/**
 * Platform roll-up — array designs and their curation flags.
 *
 * Data source: three `GET /platforms/count?filter=…` calls.
 *
 * No public/private split here. `platforms/count?filter=isPublic` is a
 * 400 ("the filter is not supported"), which is the correct answer —
 * a platform is not access-controlled the way a dataset is — so the
 * card does not offer the row rather than showing a permanent error.
 */

import { usePlatformCounts } from "../api";
import { SectionCard } from "../components/SectionCard";
import { BigNumber } from "../components/BigNumber";
import { useTimeseries } from "../timeseries";
import { CountRow } from "../components/CountRow";

export function PlatformsSection() {
  const { data, isError, error } = usePlatformCounts();
  const series = useTimeseries("corpus.platforms", data?.total ?? null);
  const flagged = data ? (data.troubled ?? 0) + (data.needsAttention ?? 0) : 0;

  return (
    <SectionCard
      title="Platforms"
      summary={data ? `${flagged.toLocaleString()} flagged` : undefined}
    >
      <div className="flex items-start gap-4">
        <BigNumber
          className="flex-none w-28"
          label="array designs"
          value={data ? data.total.toLocaleString() : "—"}
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
                label="troubled"
                n={data.troubled}
                of={data.total}
                tone={(data.troubled ?? 0) > 0 ? "warn" : undefined}
                title="curationDetails.troubled — something is known to be wrong with the platform."
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
        </div>
      )}
        </div>
      </div>
    </SectionCard>
  );
}
