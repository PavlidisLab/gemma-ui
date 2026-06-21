/**
 * Shared factor-value display row used across the curation app (audit
 * panel + proposal-review surface) and the browser app. Single-line
 * inline layout per FV; modeled on the audit's
 * `renderProposeNewFactorEditor` pattern Paul preferred.
 *
 * Layout (single statement / no statement):
 *   [FV N] [subject Term] [- pred - object Term]? [★ baseline]? (n) […trailing]
 *
 * Multi-statement FVs render the first statement on the main row and
 * stack the remaining statements as indented sublines below.
 *
 * Term rendering is caller-supplied via `termRenderer` so the curation
 * app can use its rich chip Term and the browser app can swap in a
 * simpler renderer.
 */

import type { ReactNode } from "react";

export interface FvDisplayTerm {
  label?: string | null;
  uri?: string | null;
}

export interface FvDisplayEvidence {
  quote?: string | null;
  source?: string | null;
}

export interface FvDisplayStatement {
  subject?: FvDisplayTerm | null;
  predicate?: FvDisplayTerm | null;
  object?: FvDisplayTerm | null;
  /** Original free-text the agent decomposed into (subject, predicate,
   *  object). Mirrors Gemma's ``Characteristic.originalValue`` /
   *  agent wire-field ``StatementProposal.original_value``. Surfaced
   *  by the term renderer on free-text (uri-less) chips so curators
   *  can see where the unresolved term came from. Optional — older
   *  proposals leave it absent. */
  original_value?: string | null;
  /** Paper-sentence quotes the agent anchored the statement on.
   *  Subset of the wire ``FindingEvidence`` shape — quote + source
   *  ("characteristic" / "paper" / "Methods" / etc.). */
  supporting_evidence?: ReadonlyArray<FvDisplayEvidence> | null;
}

/** Per-call provenance handed to the caller-supplied ``termRenderer``
 *  for free-text (uri-less) subject / object chips. Resolved chips
 *  and predicates receive ``undefined``. Renderers use this to build
 *  a richer tooltip / popover that names where the unresolved
 *  free-text came from. */
export interface FvTermProvenance {
  originalValue?: string | null;
  evidence?: ReadonlyArray<FvDisplayEvidence> | null;
}

export interface FvDisplayLike {
  free_text_label?: string | null;
  is_baseline?: boolean;
  biomaterial_short_names?: string[] | null;
  statements?: FvDisplayStatement[] | null;
}

/** Caller-supplied term renderer. The curation app passes its chip-
 *  framed `Term` component; the browser app passes a plain link
 *  renderer. */
export type FvTermRenderer = (props: {
  label: string;
  uri: string | null;
  variant?: "default" | "predicate";
  /** Statement-level provenance, supplied by ``FvDisplayRow`` only
   *  for free-text (uri-less) subject / object chips. Undefined for
   *  resolved chips and predicates. */
  provenance?: FvTermProvenance;
  /** True when the chip is part of a side-by-side comparison and the
   *  caller's diff resolver flagged this slot as differing from the
   *  paired chip on the other side. Set only by ``FvDisplayRow`` when
   *  ``diffChips`` is supplied; renderers that don't care about
   *  comparison can ignore it. Default ``false``. */
  diff?: boolean;
}) => JSX.Element;

export interface FvDisplayRowProps {
  fv: FvDisplayLike;
  /** Caller-supplied ontology-term renderer. */
  termRenderer: FvTermRenderer;
  /** When set, prepends "FV {indexLabel}" as an uppercase mono label
   *  to the row — matches the audit's audit-card factor display.
   *  Omit (or pass null) for surfaces that want a leaner row. */
  indexLabel?: string | number | null;
  /** Slot rendered before the FV-index label / subject Term. */
  leading?: ReactNode;
  /** Slot rendered after the sample count. */
  trailing?: ReactNode;
  /** Optional class on the outer wrapper. */
  className?: string;
  /** Optional set of chip keys (format
   *  ``s{originalStatementIndex}:{subject|predicate|object}``) that
   *  the caller's diff resolver marked as differing from the paired
   *  chip on the other side of a side-by-side comparison. When set,
   *  matching chip renders receive ``diff: true`` so the term
   *  renderer can apply a visual mark (ring / tint). Undefined →
   *  no diff plumbing (every chip renders with ``diff: false``). */
  diffChips?: ReadonlySet<string>;
  /** Suppress the trailing ``(N)`` sample-count badge. Used by the
   *  paired-factor comparison grids where the middle column already
   *  carries the sample count once, in colour — repeating ``(N)`` on
   *  each side is visual noise. Per Paul 2026-06-15: "the number of
   *  samples should be shown ONCE and in the MIDDLE". */
  suppressSampleCount?: boolean;
}

export function FvDisplayRow({
  fv,
  termRenderer,
  indexLabel = null,
  leading,
  trailing,
  className,
  diffChips,
  suppressSampleCount = false,
}: FvDisplayRowProps): JSX.Element {
  const statements = fv.statements ?? [];
  const head = statements[0] ?? null;
  // Preserve each ``rest`` entry's ORIGINAL index in ``statements``
  // so the diff resolver's ``s{i}:{slot}`` keys still resolve after
  // the head/sibling/other-rest partitioning below. Without the
  // tagging, ``rest[0]`` looks like statement #0 to the diff
  // resolver when it's really statement #1, and every ring is on the
  // wrong chip.
  const rest: Array<{ s: FvDisplayStatement; originalIndex: number }> =
    statements.slice(1).map((s, i) => ({ s, originalIndex: i + 1 }));
  const isDiff = (originalIndex: number, slot: "subject" | "predicate" | "object"): boolean =>
    diffChips?.has(`s${originalIndex}:${slot}`) ?? false;
  // Subject label falls back to the FV's free-text label so a
  // statement that ships only a URI (no subject.label) doesn't blank
  // out the row.
  // Name slot and subject slot are independent columns — no cross-
  // promotion. When the FV has a ``free_text_label``, render it in
  // the name slot; when it doesn't, the name slot is empty. Same for
  // the subject — render what the statement carries (or empty if the
  // statement's subject is blank). Per Paul 2026-06-13: "I want the
  // name shown, don't promote anything, if it's blank (it's not a
  // prefix!)".
  const subjLabel = head?.subject?.label?.trim() ?? "";
  const subjUri = head?.subject?.uri ?? null;
  const fvName = (fv.free_text_label ?? "").trim();
  // Partition `rest` into the head-subject siblings (collapse into a
  // stacked P/O column under the head's subject — mirrors the design
  // editor's `CompactStatementGroup` so curators don't read the same
  // subject chip twice) and everything else (a different subject, or
  // a free-text label that doesn't match — render as full sub-row).
  // Paul 2026-06-11: "the subject needn't be repeated if it is the
  // same."
  const headSubjectKey = subjectKey(head?.subject ?? null);
  const headSiblings: Array<{ s: FvDisplayStatement; originalIndex: number }> = [];
  const otherRest: Array<{ s: FvDisplayStatement; originalIndex: number }> = [];
  for (const entry of rest) {
    if (headSubjectKey && subjectKey(entry.s.subject ?? null) === headSubjectKey) {
      headSiblings.push(entry);
    } else {
      otherRest.push(entry);
    }
  }
  const n = fv.biomaterial_short_names?.length ?? 0;
  return (
    <div className={cx("text-[11px]", className)}>
      {/* Optional FV-name caption — rendered ABOVE the chip row so
          the statement chips line up cleanly across LEFT/RIGHT
          panes in side-by-side comparator surfaces regardless of
          how wide the FV name is. Paul 2026-06-13: "why can't you
          make things line up well" — before this split, long FV
          names like "reference substance role with calorie
          restricted" forced the chip row to wrap and broke the
          left/right alignment. Suppresses when no FV name is
          present (single-row layout, no extra vertical space). */}
      {fvName ? (
        <div
          className={cx(
            "flex items-baseline gap-x-1.5",
            // Mirror the leading + FV-N gutter of the chip row below
            // so the caption hangs in the column to the RIGHT of the
            // FV-index label, aligned with the first chip.
          )}
        >
          {leading != null ? (
            <span aria-hidden className="inline-block w-[1ch] shrink-0" />
          ) : null}
          {indexLabel != null ? (
            <span aria-hidden className="w-10 shrink-0" />
          ) : null}
          <span
            className="text-[11px] italic text-slate-700 dark:text-slate-200 font-medium leading-snug"
            title="Factor value name"
          >
            {fvName}
          </span>
        </div>
      ) : null}
      {/* Single-line flex (no wrap) so paired FvDisplayRows align
          vertically across rows in side-by-side comparator surfaces
          — the trailing `(n)` count + baseline glyph stay on the
          row instead of breaking onto a second line for FVs that
          happen to be slightly wider than their siblings. */}
      <div className="flex items-baseline gap-x-1.5">
        {leading}
        {indexLabel != null ? (
          <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400 w-10 shrink-0">
            FV {indexLabel}
          </span>
        ) : null}
        {subjLabel ? (
          termRenderer({
            label: subjLabel,
            uri: subjUri,
            // Provenance only surfaces when the chip is free-text —
            // resolved chips already carry their identity in the
            // CURIE link-out, no tooltip enrichment needed.
            provenance: subjUri ? undefined : _statementProvenance(head),
            diff: isDiff(0, "subject"),
          })
        ) : !fvName ? (
          // Only show the "(blank)" placeholder when the WHOLE row
          // is empty — when fvName is present the row already reads
          // as a named FV, even if the statement carries no subject.
          <span className="italic text-slate-400">(blank)</span>
        ) : statements.length === 0 ? (
          // Named FV with NO statements at all — a value-less FV (the
          // agent named a level but never grounded it; usually an
          // over-split). Render an explicit muted "(no value)" marker
          // so it reads as intentional, not a render glitch. This is
          // NOT the free-text case: a free-text value ships a statement
          // (uri-less subject) and renders as a normal first-class chip
          // above. Per Paul 2026-06-21.
          <span className="italic text-slate-400 border border-dashed border-slate-300 dark:border-slate-600 rounded px-1.5 py-0.5">
            (no value)
          </span>
        ) : null}
        {/* Predicate/object column. When the FV has multiple
            statements sharing the head subject, stack each pair as
            its own row underneath the head pair — the subject chip on
            the left stays single, predicates line up vertically. */}
        {head && headSiblings.length > 0 ? (
          // Two-column grid: predicate cells in col 1, object cells in
          // col 2. ``auto`` col 1 sizes to the widest predicate, so
          // every object starts at the same x and the objects line up
          // vertically across stacked statements (Paul 2026-06-21:
          // "astrocyte should be under the homozygous object").
          <div className="grid grid-cols-[auto_auto] gap-x-1.5 gap-y-0.5 items-baseline min-w-0">
            {[{ s: head, oi: 0 }, ...headSiblings.map(({ s, originalIndex }) => ({ s, oi: originalIndex }))].map(
              ({ s, oi }, i) => (
                <StatementPredObjCells
                  key={i}
                  statement={s}
                  termRenderer={termRenderer}
                  predDiff={isDiff(oi, "predicate")}
                  objDiff={isDiff(oi, "object")}
                />
              ),
            )}
          </div>
        ) : head ? (
          // Single-statement (or no siblings) — keep the original
          // inline pred/obj rendering so the (n) + baseline glyph
          // stay on the same row.
          <StatementPredicateObject
            statement={head}
            termRenderer={termRenderer}
            inline
            predDiff={isDiff(0, "predicate")}
            objDiff={isDiff(0, "object")}
          />
        ) : null}
        {fv.is_baseline ? (
          <span
            className="text-amber-600 dark:text-amber-400 leading-none ml-0.5"
            title="baseline (reference level)"
            aria-label="baseline"
          >
            ▂
          </span>
        ) : null}
        {n > 0 && !suppressSampleCount ? (
          <span className="text-[10px] text-slate-500 dark:text-slate-400 ml-0.5">
            ({n})
          </span>
        ) : null}
        {trailing}
      </div>
      {/* Sub-rows for statements whose subject differs from the head
          (rare — multi-subject FVs). Each row mirrors the head's
          flex-row layout: a leading-slot spacer (only when the head
          has one) + an empty ``FV N``-width gutter + the statement
          itself. This way the subject chip on the extra row lands in
          the SAME column as the head's subject chip — vertically
          aligned regardless of how wide the FV-N label rendered or
          whether a leading glyph is present. Per Paul 2026-06-13:
          "you should be aligning the two statements so they are
          vertically aligned". */}
      {otherRest.length > 0 ? (
        <div className="mt-0.5 space-y-0.5">
          {otherRest.map(({ s, originalIndex }, i) => (
            <div
              key={i}
              className="flex items-baseline gap-x-1.5"
            >
              {/* Leading-slot spacer — only present (and only sized)
                  when the head row has a leading element, so the
                  subject column lines up across head + extras. We
                  approximate the leading width with a ``1ch``
                  spacer to match the typical glyph slot used by
                  ``FvStatusGlyph`` in side-by-side surfaces; when
                  no leading is supplied, the spacer collapses. */}
              {leading != null ? (
                <span aria-hidden className="inline-block w-[1ch] shrink-0" />
              ) : null}
              {indexLabel != null ? (
                <span aria-hidden className="w-10 shrink-0" />
              ) : null}
              <ExtraStatementLine
                statement={s}
                termRenderer={termRenderer}
                subjDiff={isDiff(originalIndex, "subject")}
                predDiff={isDiff(originalIndex, "predicate")}
                objDiff={isDiff(originalIndex, "object")}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Stable subject identity for "same subject across statements"
 *  grouping. URI wins when both sides carry one; falls back to the
 *  case-insensitive trimmed label. Returns empty string when both
 *  are missing — callers skip the grouping path in that case. */
function subjectKey(subject: FvDisplayTerm | null): string {
  if (!subject) return "";
  const uri = (subject.uri ?? "").trim();
  if (uri) return `uri:${uri}`;
  const label = (subject.label ?? "").trim().toLowerCase();
  return label ? `lbl:${label}` : "";
}

/** One predicate-object pair render — reused by both the head's
 *  inline form and the stacked-siblings column. `inline` keeps it
 *  inside the parent flex row (no wrapper); the column form wraps
 *  it in its own flex row. */
function StatementPredicateObject({
  statement,
  termRenderer,
  inline = false,
  predDiff = false,
  objDiff = false,
}: {
  statement: FvDisplayStatement;
  termRenderer: FvTermRenderer;
  inline?: boolean;
  predDiff?: boolean;
  objDiff?: boolean;
}): JSX.Element | null {
  const predLabel = statement.predicate?.label?.trim() ?? "";
  const predUri = statement.predicate?.uri ?? null;
  const objLabel = statement.object?.label?.trim() ?? "";
  const objUri = statement.object?.uri ?? null;
  if (!predLabel && !objLabel) return null;
  // Predicates are intrinsically un-chip-rendered (plain mono text);
  // when they differ, wrap them in an amber-tinted box so curators
  // see the diff against the same-position predicate on the other
  // side. The chip helper below handles the resolved-/free-text
  // subject + object slots via the term renderer.
  const predCls = predClassName(predDiff);
  const content = (
    <>
      {predLabel ? (
        <>
          <span className="text-slate-400 dark:text-slate-500"> - </span>
          <span
            className={predCls}
            title={predUri || undefined}
          >
            {predLabel}
          </span>
        </>
      ) : null}
      {objLabel ? (
        <>
          <span className="text-slate-400 dark:text-slate-500"> - </span>
          {termRenderer({
            label: objLabel,
            uri: objUri,
            provenance: objUri ? undefined : _statementProvenance(statement),
            diff: objDiff,
          })}
        </>
      ) : null}
    </>
  );
  if (inline) return content;
  return (
    <div className="flex items-baseline gap-x-1.5">
      {content}
    </div>
  );
}

/** Predicate text styling. ``whitespace-nowrap`` keeps a two-word
 *  predicate ("located in") on one line — without it the predicate
 *  wrapped inside its (diff) box and threw the stacked-statement
 *  alignment off (Paul 2026-06-21). */
function predClassName(predDiff: boolean): string {
  return predDiff
    ? "text-[10px] text-amber-800 dark:text-amber-200 font-mono whitespace-nowrap rounded ring-1 ring-amber-400/70 dark:ring-amber-500/60 bg-amber-50/80 dark:bg-amber-900/30 px-1"
    : "text-[10px] text-slate-500 dark:text-slate-200 font-mono whitespace-nowrap";
}

/** A statement's predicate + object rendered as TWO grid cells (a
 *  ``- predicate`` cell and a ``- object`` cell). Used by the
 *  stacked-multi-statement layout so a two-column grid lines the
 *  objects up vertically — e.g. ``astrocyte`` sits under the head
 *  object, not under the predicate (Paul 2026-06-21). Returns a
 *  fragment so its two spans become direct children of the grid. */
function StatementPredObjCells({
  statement,
  termRenderer,
  predDiff = false,
  objDiff = false,
}: {
  statement: FvDisplayStatement;
  termRenderer: FvTermRenderer;
  predDiff?: boolean;
  objDiff?: boolean;
}): JSX.Element {
  const predLabel = statement.predicate?.label?.trim() ?? "";
  const predUri = statement.predicate?.uri ?? null;
  const objLabel = statement.object?.label?.trim() ?? "";
  const objUri = statement.object?.uri ?? null;
  return (
    <>
      <span className="flex items-baseline gap-x-1 min-w-0">
        <span className="text-slate-400 dark:text-slate-500">-</span>
        {predLabel ? (
          <span className={predClassName(predDiff)} title={predUri || undefined}>
            {predLabel}
          </span>
        ) : null}
      </span>
      <span className="flex items-baseline gap-x-1 min-w-0">
        <span className="text-slate-400 dark:text-slate-500">-</span>
        {objLabel
          ? termRenderer({
              label: objLabel,
              uri: objUri,
              provenance: objUri ? undefined : _statementProvenance(statement),
              diff: objDiff,
            })
          : null}
      </span>
    </>
  );
}

function ExtraStatementLine({
  statement,
  termRenderer,
  subjDiff = false,
  predDiff = false,
  objDiff = false,
}: {
  statement: FvDisplayStatement;
  termRenderer: FvTermRenderer;
  subjDiff?: boolean;
  predDiff?: boolean;
  objDiff?: boolean;
}): JSX.Element {
  const subjLabel = statement.subject?.label?.trim() ?? "";
  const subjUri = statement.subject?.uri ?? null;
  const predLabel = statement.predicate?.label?.trim() ?? "";
  const predUri = statement.predicate?.uri ?? null;
  const objLabel = statement.object?.label?.trim() ?? "";
  const objUri = statement.object?.uri ?? null;
  const predCls = predClassName(predDiff);
  return (
    <div className="flex items-baseline gap-x-1.5 text-[11px]">
      {subjLabel
        ? termRenderer({
            label: subjLabel,
            uri: subjUri,
            provenance: subjUri
              ? undefined
              : _statementProvenance(statement),
            diff: subjDiff,
          })
        : null}
      {predLabel ? (
        <>
          <span className="text-slate-400 dark:text-slate-500"> - </span>
          <span
            className={predCls}
            title={predUri || undefined}
          >
            {predLabel}
          </span>
        </>
      ) : null}
      {objLabel ? (
        <>
          <span className="text-slate-400 dark:text-slate-500"> - </span>
          {termRenderer({
            label: objLabel,
            uri: objUri,
            provenance: objUri ? undefined : _statementProvenance(statement),
            diff: objDiff,
          })}
        </>
      ) : null}
    </div>
  );
}

/** Local className-merge — packages/ontology stays dep-light. */
function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Derive the provenance handed to the ``termRenderer`` for free-text
 *  chips inside a statement. Returns ``undefined`` when nothing useful
 *  is on the wire so the renderer can fall back to its plain
 *  "free-text" tooltip. */
function _statementProvenance(
  s: FvDisplayStatement | null | undefined,
): FvTermProvenance | undefined {
  if (!s) return undefined;
  const orig = (s.original_value ?? "").trim();
  const ev = (s.supporting_evidence ?? []).filter(
    (e) => ((e?.quote ?? "").trim() || (e?.source ?? "").trim()),
  );
  if (!orig && ev.length === 0) return undefined;
  return {
    originalValue: orig || null,
    evidence: ev.length ? ev : null,
  };
}
