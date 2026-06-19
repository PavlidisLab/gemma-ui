import { cn } from "@/lib/cn";
import { Term } from "./Term";
import type { OntologyTerm } from "@/features/experiment/types";

/**
 * StatementChip — compact one-line render of a tag statement.
 *
 *   <subject Term + CURIE> [· <predicate text> · <object Term + CURIE>]...
 *
 * Works for the four cases Gemma 2.0 emits at the EE-tag level:
 *
 *   1. Subject only            — flat Characteristic, no predicate/object.
 *   2. Subject + S-P-O         — primary predicate/object only.
 *   3. Subject + S-P-O-P-O     — primary + secondary predicate/object pair.
 *   4. Free-text subject       — italic slate, no CURIE chip; matches the
 *                                TagBar "unresolved" convention.
 *
 * Per Paul 2026-06-17: category is hidden in the compact view (surfaced
 * in the hover tooltip only). Predicates render as italic muted text —
 * relational glue, not a clickable Term. Objects render through the
 * canonical ``Term`` so ontology-resolved objects pick up the emerald
 * + CURIE popover treatment.
 *
 * The wire shape (``AnnotationValueObject`` from gemma-rest 2.0 — see
 * ``handoffs/UIB_HANDOFF_2026_06_17_TAG_AND_BM_STATEMENT_ENDPOINTS.md``)
 * stores at most two predicate/object pairs per tag (``predicate``+
 * ``object`` and ``secondPredicate``+``secondObject``); the ``pairs``
 * prop here is flat to mirror that.
 *
 * Size variants:
 *   - ``compact``     — dense table cells, sample popover, search rows.
 *   - ``default``     — audit cards, design editor, TagBar (the host
 *                       picks this unless it has a density reason).
 *   - ``comfortable`` — browser-app filter chips, larger touch targets.
 *
 * Predicate vocabulary is enforced upstream by the edit modal (typeahead
 * over ``PREDICATES`` from ``@/generated/predicates``). The chip itself
 * just renders whatever predicates the wire carries.
 */

export interface StatementChipPair {
  predicate?: OntologyTerm | null;
  object?: OntologyTerm | null;
}

export interface StatementChipProps {
  /** Tag category — rendered ONLY in the hover tooltip, not inline.
   *  Optional because some hosts (e.g. a category-grouped section
   *  header) already display the category and don't want it doubled
   *  up. */
  category?: OntologyTerm | null;
  /** The subject term. On the wire this IS the ``value`` field of the
   *  tag (per UIB_HANDOFF: "Subject = value. There is no separate
   *  subject field"). */
  subject: OntologyTerm;
  /** Predicate / object pairs, in order. Max 2 per the wire contract
   *  (primary + secondary). Empty / undefined renders as a subject-only
   *  chip — same shape as today's flat-Characteristic TagBar chip. */
  pairs?: StatementChipPair[];
  size?: "compact" | "default" | "comfortable";
  /** Click handler — typically opens the edit modal. When undefined,
   *  the chip renders without the pointer-cursor affordance so it
   *  reads as display-only. */
  onClick?: () => void;
  /** Extra tooltip content appended after the category line. Used by
   *  hosts that want to surface inferred-source / evidence-code on
   *  hover without cluttering the chip. */
  extraTooltip?: string | null;
  className?: string;
}

const SIZE_CLS: Record<NonNullable<StatementChipProps["size"]>, string> = {
  compact: "text-[11px] px-2 py-0.5 gap-1",
  default: "text-xs px-2.5 py-1 gap-1.5",
  comfortable: "text-sm px-3 py-1.5 gap-2",
};

const SEP_CLS = "text-slate-400 dark:text-slate-600 select-none";
const PRED_CLS = "italic text-slate-500 dark:text-slate-400 font-normal";

export function StatementChip({
  category,
  subject,
  pairs,
  size = "default",
  onClick,
  extraTooltip,
  className,
}: StatementChipProps) {
  const title = (() => {
    const parts: string[] = [];
    if (category?.label) parts.push(`category: ${category.label}`);
    if (extraTooltip) parts.push(extraTooltip);
    return parts.length ? parts.join("\n") : undefined;
  })();

  const activePairs = (pairs ?? []).filter(
    (p) => (p.predicate && p.predicate.label) || (p.object && p.object.label),
  );

  const isInteractive = !!onClick;

  return (
    <span
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        isInteractive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      title={title}
      className={cn(
        "inline-flex items-baseline rounded-full border",
        "border-slate-300 bg-white text-slate-800",
        "dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100",
        isInteractive &&
          "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors",
        SIZE_CLS[size],
        className,
      )}
    >
      <Term uri={subject.uri ?? null} asLink={false}>
        {subject.label}
      </Term>
      {activePairs.map((pair, i) => (
        <span key={i} className="inline-flex items-baseline gap-[inherit]">
          <span className={SEP_CLS}>·</span>
          {pair.predicate?.label ? (
            <span className={PRED_CLS} title={pair.predicate.uri ?? undefined}>
              {pair.predicate.label}
            </span>
          ) : null}
          {pair.object?.label ? (
            <>
              <span className={SEP_CLS}>·</span>
              <Term uri={pair.object.uri ?? null} asLink={false}>
                {pair.object.label}
              </Term>
            </>
          ) : null}
        </span>
      ))}
    </span>
  );
}
