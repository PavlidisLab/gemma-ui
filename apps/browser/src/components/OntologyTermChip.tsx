import type { ReactNode } from "react";
import { curieToUrl, shortenUri } from "@/lib/curie";

/**
 * Read-only ontology-term chip ported from the curation UI's
 * conventions (see ``apps/curation/src/components/ui/Term.tsx``).
 * Three variants:
 *
 *  - **resolved** (URI present, default) — emerald chip with a CURIE
 *    tail. Wraps in an `<a target="_blank">` opening the term page;
 *    tooltip carries the full URI.
 *  - **free** (URI absent, default) — muted italic chip, no link.
 *    Signals the label hasn't been mapped to ontology.
 *  - **predicate** — slate chip; connective tissue between subject
 *    and object. Visually steps back so the two real terms carry
 *    the weight.
 *
 *  Inline Tailwind instead of a shared ``.term`` class so the
 *  browser app doesn't acquire a global stylesheet coupling for one
 *  read-only surface.
 */
export type TermVariant = "default" | "free" | "predicate";

export function OntologyTermChip({
  children,
  uri,
  variant = "default",
  asLink = true,
  className,
}: {
  children: ReactNode;
  uri?: string | null;
  variant?: TermVariant;
  asLink?: boolean;
  className?: string;
}) {
  const effective: TermVariant = variant === "default" && !uri ? "free" : variant;
  const variantCls =
    effective === "free"
      ? "bg-stone-50 text-stone-600 border-stone-200 italic"
      : effective === "predicate"
        ? "bg-slate-100 text-slate-600 border-slate-300"
        : "bg-emerald-50 text-emerald-800 border-emerald-200";
  const base =
    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs leading-4 " +
    "whitespace-nowrap max-w-full overflow-hidden border align-baseline";
  const cls = [base, variantCls, className].filter(Boolean).join(" ");
  const tooltip = uri || undefined;

  const inner = (
    <>
      <span className="truncate">{children}</span>
      {uri ? (
        <span
          className="text-slate-400 font-mono text-[10px] whitespace-nowrap"
          title={tooltip}
        >
          {shortenUri(uri)}
        </span>
      ) : null}
    </>
  );

  if (asLink && uri && effective !== "free") {
    return (
      <a
        href={curieToUrl(uri) ?? uri}
        target="_blank"
        rel="noopener noreferrer"
        title={tooltip}
        className={cls + " no-underline hover:underline"}
      >
        {inner}
      </a>
    );
  }
  return (
    <span className={cls} title={tooltip}>
      {inner}
    </span>
  );
}
