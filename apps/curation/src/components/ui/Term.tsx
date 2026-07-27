import { cn } from "@/lib/cn";
import { curieToUrl } from "@/lib/curie";
import type { ReactNode } from "react";
import { CurieLink } from "./CurieLink";
import type { FvTermProvenance, FvTermRenderer } from "@gemma/ontology";

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
export type TermVariant =
  | "default"
  | "free"
  | "predicate"
  | "category"
  /** Frameless leaf — no chip border / background / padding, just the
   *  inline label + CURIE link, inheriting colour from the caller's
   *  ``className``. For hosts that already provide their own frame
   *  (e.g. the TagBar value sits INSIDE a bordered group chip, so a
   *  second frame would double-border). Still shares the leaf logic:
   *  CURIE popover, label truncation, tooltip. Design review 2026-06-21. */
  | "bare";

export function Term({
  children,
  uri,
  variant = "default",
  className,
  asLink = true,
  provenance,
  diff = false,
  title,
  size = "default",
}: {
  children: ReactNode;
  uri?: string | null;
  variant?: TermVariant;
  className?: string;
  /** Chip scale. ``"sm"`` shrinks the text + padding one notch (via
   *  the ``.term.sm`` modifier for framed variants, ``text-[10px]``
   *  for the bare variant). Used by the side-by-side factor
   *  comparison so the whole statement reads smaller; reusable size
   *  knob for the TagBar / StatementChip later. Omitting it is
   *  byte-for-byte the existing render. Design review 2026-06-21. */
  size?: "default" | "sm";
  /** Override the chip's hover tooltip. When omitted, the tooltip is
   *  the URI (resolved) / provenance (free-text). Callers that
   *  abbreviate the visible label (e.g. the TagBar) pass the full
   *  label here so it's recoverable on hover; the CURIE link keeps
   *  showing the URI. */
  title?: string;
  /** Whether a URI-resolved Term renders as an `<a>` that opens the
   *  ontology page in a new tab. Default ``true`` keeps the existing
   *  behaviour for callers (proposal cards, audit reports) where the
   *  term is read-only and the link is the only thing to click.
   *  Pass ``false`` on surfaces where clicking the term should
   *  either open an inline editor or do nothing — the convention
   *  The reviewer confirmed 2026-05-19 for the per-element disposition
   *  editor. */
  asLink?: boolean;
  /** Statement-level provenance for free-text chips — the agent's
   *  ``original_value`` + per-statement ``supporting_evidence`` quotes
   *  / sources. When provided AND the chip is rendering in the
   *  ``free`` (uri-less) variant, the chip's ``title`` tooltip
   *  surfaces the provenance so curators can see where the
   *  unresolved free-text came from. Threaded through by the shared
   *  ``FvDisplayRow`` renderer; ignored when a URI is present
   *  (resolved chips already carry their identity via the CURIE
   *  link-out). */
  provenance?: FvTermProvenance;
  /** When true, the chip's diff styling lays an amber palette over
   *  whatever variant the chip is rendering — used inside side-by-
   *  side comparison surfaces to mark chips that differ from their
   *  paired counterpart on the other side. The variant's italic /
   *  non-italic stays so role (category / value / free) still reads.
   *  Per design review 2026-06-15. */
  diff?: boolean;
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
  const isBare = effectiveVariant === "bare";
  const isLink = asLink && !!uri && effectiveVariant !== "free" && !isBare;
  // For free-text chips, build a multi-line tooltip from any
  // statement-level provenance the row passed in. Resolved chips
  // keep the URI as their tooltip (existing behaviour).
  const provenanceTooltip = (() => {
    if (effectiveVariant !== "free" || !provenance) return undefined;
    const lines: string[] = [];
    const orig = provenance.originalValue?.trim();
    if (orig) lines.push(`"${orig}"`);
    for (const e of provenance.evidence ?? []) {
      const q = (e?.quote ?? "").trim();
      const src = (e?.source ?? "").trim();
      if (q && src) lines.push(`"${q}" — ${src}`);
      else if (q) lines.push(`"${q}"`);
      else if (src) lines.push(`source: ${src}`);
    }
    return lines.length ? lines.join("\n") : undefined;
  })();
  const tooltipUri = uri || provenanceTooltip || undefined;
  // Caller-supplied title wins for the chip body + label; the CURIE
  // link keeps the URI tooltip below.
  const outerTitle = title ?? tooltipUri;

  // CURIE inline → ALWAYS opens the modular CuriePopover (label /
  // definition / parents from Gemma; explicit "Fetch from OLS"
  // button when Gemma doesn't know the term). ``CurieLink`` stops
  // click bubbling so the surrounding card / row / cell doesn't
  // react. Per design review 2026-06-13: "make sure this is a modular item
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
        title={outerTitle}
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
        // Bare = frameless leaf (the host supplies its own frame); keep
        // only the flex + truncation scaffold so the label/CURIE split
        // and ellipsis still work. Otherwise the full ``.term`` chip.
        isBare
          ? cn(
              "inline-flex items-baseline gap-1 max-w-full overflow-hidden align-bottom",
              size === "sm" && "text-[10px]",
            )
          : cn(
              "term",
              effectiveVariant !== "default" && effectiveVariant,
              diff && "diff",
              size === "sm" && "sm",
            ),
        className,
      )}
      title={outerTitle}
    >
      {/* Label shrinks + ellipsises when the chip is width-constrained so
          the CURIE (the term's identity) is never the thing clipped.
          ``truncate`` adds the ellipsis; the full label stays in the
          ``title`` tooltip + the CuriePopover. We floor the shrink at
          ``min-w-[6ch]`` (was ``min-w-0``) so that in cramped columns —
          the side-by-side comparison grid especially — short labels like
          "astrocyte" don't collapse to "a…" while the CURIE keeps its
          width. ``6ch`` still allows long labels to ellipsize (they
          shrink TO 6ch, not below), so the only behaviour change is the
          floor on over-truncation. Design review 2026-06-21. */}
      <span className="min-w-[6ch] truncate">{labelNode}</span>
      {uri ? (
        <span className="ml-1 shrink-0">
          <CurieLink uri={uri} title={tooltipUri} />
        </span>
      ) : null}
    </span>
  );
}

/** Shared ``FvTermRenderer`` adapter — satisfies the
 *  ``@gemma/ontology`` contract that ``FvDisplayRow`` consumes by
 *  passing each chip through the canonical ``Term`` component above.
 *  Use this on every ``FvDisplayRow`` call site (audit cards,
 *  comparison grid, FindingDetailsEditor) so the visual contract for
 *  ontology chips stays uniform across surfaces. Design review 2026-06-15:
 *  "make ALL surfaces use a single Term component."
 *
 *  Variant mapping:
 *   - ``predicate`` → ``predicate`` (slate, mono)
 *   - URI absent  → ``free`` (italic stone)
 *   - URI present → ``default`` (emerald + bookmark)
 *
 *  Diff flag is passed through verbatim — the parent surface
 *  (e.g. ``computeFvDiff`` in ``factorComparison/fvDiff.ts``)
 *  decides which chips are different. */
export const termRenderer: FvTermRenderer = ({
  label,
  uri,
  variant,
  provenance,
  diff,
  size,
}) => (
  <Term
    uri={uri}
    variant={variant === "predicate" ? "predicate" : "default"}
    asLink={false}
    provenance={provenance}
    diff={diff}
    size={size}
  >
    {label}
  </Term>
);
