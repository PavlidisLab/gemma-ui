import { cn } from "@/lib/cn";
import { curieToUrl } from "@/lib/curie";
import type { ReactNode } from "react";
import { CurieLink } from "./CurieLink";

/**
 * One ontology term, rendered as an inline chip.
 *
 * Visual semantics (house standard):
 *
 *   - **Resolved** (URI present, default variant) — emerald chip,
 *     wraps the label in an ``<a>`` with the URI as ``href`` so
 *     clicks open the term page in a new tab. Hover shows the
 *     shortened URI inline + the full URI in the ``title`` tooltip.
 *   - **Free-text** (URI absent, default variant) — grey italic
 *     chip, no link. Signals at a glance that the curator still
 *     needs to resolve the term.
 *   - **Predicate** — muted slate chip (connective tissue between
 *     subject/object; steps back visually so the two real Terms
 *     carry the weight). Earlier fuchsia variant clashed with the
 *     purple boss-verdict chip — 2026-05-22.
 *
 * Baseline status is **not** a Term variant — green is reserved
 * for "ontology-resolved", and reusing it for baseline conflated
 * two distinct states. Callers signal baseline via a separate
 * ``<Pill variant="baseline">▂ baseline</Pill>`` chip alongside
 * the term.
 */
export type TermVariant = "default" | "free" | "predicate";

export function Term({
  children,
  uri,
  variant = "default",
  className,
  asLink = true,
}: {
  children: ReactNode;
  uri?: string | null;
  variant?: TermVariant;
  className?: string;
  /** Whether a URI-resolved Term renders as an `<a>` that opens the
   *  ontology page in a new tab. Default ``true`` keeps the existing
   *  behaviour for callers (proposal cards, audit reports) where the
   *  term is read-only and the link is the only thing to click.
   *  Pass ``false`` on surfaces where clicking the term should
   *  either open an inline editor or do nothing — the convention
   *  Paul confirmed 2026-05-19 for the per-element disposition
   *  editor. */
  asLink?: boolean;
}) {
  // Auto-pick free vs default based on URI presence when caller
  // didn't pin a variant. Predicates and baselines bypass the auto-
  // pick (they have their own colour).
  const effectiveVariant: TermVariant =
    variant === "default" && !uri ? "free" : variant;

  // Resolved (variant default with URI present, or explicit "baseline"
  // with a URI) → render the chip as a link so a click opens the
  // ontology term page, unless the caller opted out via ``asLink=false``.
  // Free-text and predicates without URIs always render as a span.
  // We open in a new tab; ``rel`` follows the standard noopener+
  // noreferrer pair to avoid window.opener leakage.
  const isLink = asLink && !!uri && effectiveVariant !== "free";
  const tooltipUri = uri || undefined;

  // CURIE inline → ALWAYS opens the modular CuriePopover (label /
  // definition / parents from Gemma; explicit "Fetch from OLS"
  // button when Gemma doesn't know the term). ``CurieLink`` stops
  // click bubbling so the surrounding card / row / cell doesn't
  // react. Per Paul 2026-06-13: "make sure this is a modular item
  // that shows up for all places ontology terms go".
  //
  // The outer chip is a span (not an anchor) so the popover-button
  // inside is valid HTML. When ``asLink`` is set, the LABEL portion
  // wraps in its own ``<a>`` — clicking the term name still opens
  // the OBO page in a new tab, but clicking the small CURIE opens
  // the inline popover instead. Two distinct click-targets, no
  // nested anchors.
  const labelNode =
    isLink && uri ? (
      <a
        href={curieToUrl(uri) ?? uri}
        target="_blank"
        rel="noopener noreferrer"
        title={tooltipUri}
        onClick={(e) => e.stopPropagation()}
        className="no-underline hover:underline"
      >
        {children}
      </a>
    ) : (
      children
    );

  return (
    <span
      className={cn(
        "term",
        effectiveVariant !== "default" && effectiveVariant,
        className,
      )}
      title={tooltipUri}
    >
      {labelNode}
      {uri ? (
        <span className="ml-1">
          <CurieLink uri={uri} title={tooltipUri} />
        </span>
      ) : null}
    </span>
  );
}
