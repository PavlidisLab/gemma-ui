import type { ReactNode } from "react";
import { shortenUri } from "@/lib/curie";
import { Link } from "@tanstack/react-router";
import { browseTermLink } from "@/lib/appLinks";

/**
 * Read-only ontology-term chip ported from the curation UI's
 * conventions (see ``apps/curation/src/components/ui/Term.tsx``).
 * Three variants:
 *
 *  - **resolved** (URI present, default) — emerald chip with a CURIE
 *    tail, linking to a Gemma search for datasets carrying the term.
 *    It used to open the term's page on the ontology's own site, which
 *    ended the reader's visit on a third-party page to answer a
 *    question Gemma can answer better: what ELSE is annotated this way
 *    (Paul, 2026-09-01). The full URI stays in the tooltip, so the
 *    ontology id is still there to copy.
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
  labelTitle,
  termLabel,
  categoryUri,
  categoryLabel,
}: {
  children: ReactNode;
  uri?: string | null;
  variant?: TermVariant;
  asLink?: boolean;
  className?: string;
  /** Full label text, shown as the hover tooltip on the (possibly
   *  truncated) label span. Use when the chip is width-capped so the
   *  reader can still recover the whole term on hover. The chip's own
   *  tooltip stays the URI. */
  labelTitle?: string;
  /** The term's own label + its category, forwarded to the browse
   *  link so the annotation facet arrives with this term ticked under
   *  its category. Without them the term still filters, but the side
   *  panel can't show WHICH term produced the list. */
  termLabel?: string;
  categoryUri?: string | null;
  categoryLabel?: string | null;
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
      <span className="truncate" title={labelTitle}>
        {children}
      </span>
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

  const browse = browseTermLink({
    uri,
    label: termLabel,
    categoryUri,
    categoryLabel,
  });
  if (asLink && browse && effective !== "free") {
    return (
      // Same tab on purpose: this is navigation within Gemma, and a new
      // tab per term chip would litter the reader's window.
      <Link
        to={browse.to}
        search={browse.search}
        title={
          tooltip
            ? `Browse datasets annotated with this term\n${tooltip}`
            : undefined
        }
        className={cls + " no-underline hover:underline"}
      >
        {inner}
      </Link>
    );
  }
  return (
    <span className={cls} title={tooltip}>
      {inner}
    </span>
  );
}
