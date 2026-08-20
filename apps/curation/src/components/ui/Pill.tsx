import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

/** ``baseline`` is FILLED and means "this FV carries the
 *  ``is_baseline`` mark". ``baseline-auto`` is HOLLOW and means the
 *  opposite — nothing is marked here, Gemma's own detector just reads
 *  this level as the reference anyway. The two used to differ only by
 *  ``opacity-70`` plus a "(Gemma)" suffix, which on a factor where two
 *  levels both carry control terms made unmarking one look like it did
 *  nothing but resort the rows. */
type PillVariant = "high" | "medium" | "baseline" | "baseline-auto";

export function Pill({
  variant,
  children,
  className,
}: {
  variant: PillVariant;
  children: ReactNode;
  className?: string;
}) {
  return <span className={cn("pill", variant, className)}>{children}</span>;
}
