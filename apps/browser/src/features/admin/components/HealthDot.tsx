/**
 * Status indicator dot — UP / DOWN / UNKNOWN / WARN. Pulses when
 * DOWN so a glance picks it out against a wall of "UP" green.
 */

import type { HealthStatus } from "../api";

export interface HealthDotProps {
  status: HealthStatus | "WARN";
  label?: string;
  withLabel?: boolean;
  className?: string;
}

export function HealthDot({
  status,
  label,
  withLabel = false,
  className,
}: HealthDotProps) {
  const cls = {
    UP: "bg-emerald-500",
    WARN: "bg-amber-500",
    DOWN: "bg-rose-500 animate-pulse",
    UNKNOWN: "bg-slate-400",
  }[status];
  const text = label ?? status.toLowerCase();
  const tint = {
    UP: "text-emerald-700 dark:text-emerald-300",
    WARN: "text-amber-700 dark:text-amber-300",
    DOWN: "text-rose-700 dark:text-rose-300",
    UNKNOWN: "text-slate-500 dark:text-slate-400",
  }[status];
  return (
    <span
      className={"inline-flex items-center gap-1.5 " + (className ?? "")}
      title={text}
    >
      <span
        aria-hidden
        className={"inline-block w-2 h-2 rounded-full " + cls}
      />
      {withLabel ? (
        <span className={"text-[11px] font-medium " + tint}>{text}</span>
      ) : null}
    </span>
  );
}
