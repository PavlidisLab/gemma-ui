/**
 * Big-number stat with optional sparkline. Used heavily on the
 * Systems Monitoring page — same shape for "Heap 7.2 / 12.0 GB"
 * + sparkline, "Queries executed 42,318", "Threads 87 / 65 d", etc.
 */

import type { ReactNode } from "react";
import type { Sample } from "../timeseries";
import { Sparkline } from "./Sparkline";

export interface BigNumberProps {
  label: string;
  value: ReactNode;
  /** Optional second line under the value — "of 12.0 GB", "(16 cpus)", etc. */
  detail?: ReactNode;
  /** Optional sparkline samples — when present, renders to the right
   *  of the value. */
  samples?: Sample[];
  /** Optional tooltip on the whole stat. */
  title?: string;
  /** Optional small icon / status pill above the label. */
  badge?: ReactNode;
  className?: string;
}

export function BigNumber({
  label,
  value,
  detail,
  samples,
  title,
  badge,
  className,
}: BigNumberProps) {
  return (
    <div
      className={
        "flex flex-col gap-0.5 " + (className ?? "")
      }
      title={title}
    >
      <div className="flex items-baseline gap-2">
        {badge ? <span className="flex-none">{badge}</span> : null}
        <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100 leading-none">
          {value}
        </span>
        {samples && samples.length > 0 ? (
          <Sparkline samples={samples} width={96} height={20} />
        ) : null}
      </div>
      {detail ? (
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          {detail}
        </span>
      ) : null}
    </div>
  );
}
