import { Fragment } from "react";
import { Term } from "./Term";
import type { OntologyTerm } from "@/features/experiment/types";

/**
 * StatementSequence — the shared "subject · predicate · object" walk.
 *
 * This is the core S-P-O primitive extracted from ``StatementChip``
 * (widget-unification Phase 1). It renders ONLY the inner sequence:
 *
 *   <subject Term> [ <sep> <predicate text> <sep> <object Term> ]...
 *
 * No chip frame, no padding, no interactivity — callers own that. The
 * leaf chips go through the canonical ``Term`` so subject + object pick
 * up the one ontology-chip treatment (palette, CURIE popover, truncation).
 *
 * Parameterised by the bits that legitimately differ between callers:
 *   - ``separator`` — the glue glyph (e.g. "·" for the chip, " - "
 *     elsewhere).
 *   - ``separatorClassName`` — styling for the separator span.
 *   - ``predicateClassName`` — styling for the predicate text (italic
 *     muted slate in the chip).
 *   - ``asLink`` — whether subject + object Terms render as link-outs.
 *
 * The data shape mirrors ``StatementChip``'s existing props: a
 * ``subject: OntologyTerm`` plus an ordered list of predicate/object
 * ``pairs``. Pairs with neither a predicate label nor an object label
 * are skipped (same filter ``StatementChip`` applied inline).
 */

export interface StatementSequencePair {
  predicate?: OntologyTerm | null;
  object?: OntologyTerm | null;
}

export interface StatementSequenceProps {
  /** The subject term — rendered as the leading ``Term`` leaf. */
  subject: OntologyTerm;
  /** Predicate / object pairs, in order. Pairs that carry neither a
   *  predicate label nor an object label are dropped. */
  pairs?: StatementSequencePair[];
  /** Separator glyph rendered before each predicate and before each
   *  object. Defaults to "·" (the StatementChip convention). */
  separator?: string;
  /** className applied to each separator span. */
  separatorClassName?: string;
  /** className applied to the predicate text span. */
  predicateClassName?: string;
  /** Whether subject + object Terms render as link-outs. Defaults to
   *  ``false`` to match the chip (clicking opens the edit modal, not
   *  the ontology page). */
  asLink?: boolean;
}

export function StatementSequence({
  subject,
  pairs,
  separator = "·",
  separatorClassName,
  predicateClassName,
  asLink = false,
}: StatementSequenceProps) {
  const activePairs = (pairs ?? []).filter(
    (p) => (p.predicate && p.predicate.label) || (p.object && p.object.label),
  );

  return (
    <>
      <Term uri={subject.uri ?? null} asLink={asLink}>
        {subject.label}
      </Term>
      {activePairs.map((pair, i) => (
        <span key={i} className="inline-flex items-baseline gap-[inherit]">
          <span className={separatorClassName}>{separator}</span>
          {pair.predicate?.label ? (
            <span
              className={predicateClassName}
              title={pair.predicate.uri ?? undefined}
            >
              {pair.predicate.label}
            </span>
          ) : null}
          {pair.object?.label ? (
            <Fragment>
              <span className={separatorClassName}>{separator}</span>
              <Term uri={pair.object.uri ?? null} asLink={asLink}>
                {pair.object.label}
              </Term>
            </Fragment>
          ) : null}
        </span>
      ))}
    </>
  );
}
