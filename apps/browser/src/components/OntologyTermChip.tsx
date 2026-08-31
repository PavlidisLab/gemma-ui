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
 *
 *  Pass ``pairs`` to render a compact subject-predicate-object
 *  STATEMENT instead of a bare term — ``children``/``uri`` become the
 *  subject, and each pair renders as "· predicate · object" inside
 *  the SAME chip frame (see ``StatementTermChip`` below). Adopts the
 *  S-P-O ordering, dot separator, and muted-italic-predicate grammar
 *  of the curation app's ``StatementChip``/``StatementSequence``
 *  (``apps/curation/src/components/ui/``), but flattens subject +
 *  predicate + object into ONE bordered chip rather than nesting a
 *  bordered Term per leaf inside an outer pill — curation's nested
 *  chips (each leaf carries its own ``border`` + ``py-0.5``) stack to
 *  a taller total than this card's plain single-bordered term chips
 *  sitting beside them; one frame keeps a statement exactly as tall
 *  as a plain chip.
 */
export type TermVariant = "default" | "free" | "predicate";

/** One predicate/object pair on a statement chip. Mirrors the wire's
 *  ``predicate``/``object`` (+ ``secondPredicate``/``secondObject``)
 *  fields — at most two pairs per statement, matching Gemma's own
 *  cap. */
export interface StatementPair {
  predicate?: string | null;
  predicateUri?: string | null;
  object?: string | null;
  objectUri?: string | null;
}

export function OntologyTermChip({
  children,
  uri,
  variant = "default",
  asLink = true,
  className,
  labelTitle,
  pairs,
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
  /** Predicate/object pairs — see the doc comment above. When
   *  present (non-empty), ``children`` is read as a plain string (the
   *  subject label) and the chip renders as a statement instead of a
   *  bare term. */
  pairs?: StatementPair[];
}) {
  if (pairs && pairs.length > 0) {
    return (
      <StatementTermChip
        subjectLabel={typeof children === "string" ? children : String(children ?? "")}
        subjectUri={uri ?? null}
        pairs={pairs}
        asLink={asLink}
        className={className}
      />
    );
  }

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

/** One label+CURIE leaf inside a statement chip — the subject, or a
 *  pair's object. No border/background of its own (the outer
 *  ``StatementTermChip`` frame is the chip's one border); colour +
 *  italic alone carry resolved-vs-free-text, same signal the framed
 *  chip above gives via ``bg-emerald-50``/``bg-stone-50``. Links out
 *  independently when it has a URI, same as a plain term chip —
 *  ``StatementTermChip`` can't wrap the whole statement in one ``<a>``
 *  since the subject and each object may point at different terms.
 *  ``maxWidthClassName`` caps + truncates a long object so it can't
 *  wrap the card open; the full text stays reachable via
 *  ``labelTitle``. */
function chipLeaf({
  label,
  uri,
  asLink,
  labelTitle,
  maxWidthClassName,
}: {
  label: string;
  uri?: string | null;
  asLink: boolean;
  labelTitle?: string;
  maxWidthClassName?: string;
}) {
  const isFree = !uri;
  const textCls = isFree ? "italic text-stone-600" : "text-emerald-800";
  const leafCls = ["inline-flex items-baseline gap-1 min-w-0", textCls].join(" ");
  const body = (
    <>
      <span
        className={["truncate", maxWidthClassName].filter(Boolean).join(" ")}
        title={labelTitle}
      >
        {label}
      </span>
      {uri ? (
        <span
          className="text-slate-400 font-mono text-[10px] whitespace-nowrap"
          title={uri}
        >
          {shortenUri(uri)}
        </span>
      ) : null}
    </>
  );
  if (asLink && uri) {
    return (
      <a
        href={curieToUrl(uri) ?? uri}
        target="_blank"
        rel="noopener noreferrer"
        title={uri}
        className={leafCls + " no-underline hover:underline"}
      >
        {body}
      </a>
    );
  }
  return (
    <span className={leafCls} title={labelTitle ?? uri ?? undefined}>
      {body}
    </span>
  );
}

const SEP = (
  <span className="text-slate-400 select-none" aria-hidden>
    ·
  </span>
);

/** Compact subject-predicate-object render, one chip frame. See the
 *  doc comment on ``OntologyTermChip``'s ``pairs`` prop for why this
 *  doesn't nest a bordered leaf per term the way the curation app's
 *  ``StatementChip`` does. */
function StatementTermChip({
  subjectLabel,
  subjectUri,
  pairs,
  asLink,
  className,
}: {
  subjectLabel: string;
  subjectUri: string | null;
  pairs: StatementPair[];
  asLink: boolean;
  className?: string;
}) {
  const frameCls = [
    "inline-flex items-baseline gap-1 px-1.5 py-0.5 rounded text-xs leading-4",
    "whitespace-nowrap max-w-full overflow-hidden border align-baseline",
    subjectUri ? "bg-emerald-50 border-emerald-200" : "bg-stone-50 border-stone-200",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  // At most two pairs on the wire (primary + secondPredicate/
  // secondObject) — an extra entry would be a payload surprise, not
  // silently dropped truncation, so it's left to render rather than
  // sliced away.
  return (
    <span className={frameCls} title={subjectUri ?? undefined}>
      {chipLeaf({ label: subjectLabel, uri: subjectUri, asLink })}
      {pairs.map((p, i) => {
        const predLabel = (p.predicate ?? "").trim();
        const objLabel = (p.object ?? "").trim();
        if (!predLabel && !objLabel && !p.objectUri) return null;
        return (
          <span key={i} className="inline-flex items-baseline gap-1 min-w-0">
            {SEP}
            {predLabel ? (
              <span
                className="italic text-slate-500 font-normal"
                title={p.predicateUri ?? undefined}
              >
                {predLabel}
              </span>
            ) : null}
            {objLabel || p.objectUri ? (
              <>
                {SEP}
                {chipLeaf({
                  label: objLabel || "(unnamed)",
                  uri: p.objectUri,
                  asLink,
                  labelTitle: objLabel || undefined,
                  maxWidthClassName: "max-w-[14ch]",
                })}
              </>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}
