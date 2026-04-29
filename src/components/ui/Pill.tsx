import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

type PillVariant =
  | "high"
  | "medium"
  | "low"
  | "pending"
  | "accepted"
  | "rejected"
  | "needs"
  | "baseline";

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
