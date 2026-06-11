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

export interface FvDisplayStatement {
  subject?: FvDisplayTerm | null;
  predicate?: FvDisplayTerm | null;
  object?: FvDisplayTerm | null;
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
}

export function FvDisplayRow({
  fv,
  termRenderer,
  indexLabel = null,
  leading,
  trailing,
  className,
}: FvDisplayRowProps): JSX.Element {
  const statements = fv.statements ?? [];
  const head = statements[0] ?? null;
  const rest = statements.slice(1);
  // Subject label falls back to the FV's free-text label so a
  // statement that ships only a URI (no subject.label) doesn't blank
  // out the row.
  const subjLabel = (head?.subject?.label?.trim() ||
    fv.free_text_label?.trim() ||
    "") as string;
  const subjUri = head?.subject?.uri ?? null;
  // Partition `rest` into the head-subject siblings (collapse into a
  // stacked P/O column under the head's subject — mirrors the design
  // editor's `CompactStatementGroup` so curators don't read the same
  // subject chip twice) and everything else (a different subject, or
  // a free-text label that doesn't match — render as full sub-row).
  // Paul 2026-06-11: "the subject needn't be repeated if it is the
  // same."
  const headSubjectKey = subjectKey(head?.subject ?? null);
  const headSiblings: FvDisplayStatement[] = [];
  const otherRest: FvDisplayStatement[] = [];
  for (const s of rest) {
    if (headSubjectKey && subjectKey(s.subject ?? null) === headSubjectKey) {
      headSiblings.push(s);
    } else {
      otherRest.push(s);
    }
  }
  const n = fv.biomaterial_short_names?.length ?? 0;
  return (
    <div className={cx("text-[11px]", className)}>
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
          termRenderer({ label: subjLabel, uri: subjUri })
        ) : (
          <span className="italic text-slate-400">(blank)</span>
        )}
        {/* Predicate/object column. When the FV has multiple
            statements sharing the head subject, stack each pair as
            its own row underneath the head pair — the subject chip on
            the left stays single, predicates line up vertically. */}
        {head && headSiblings.length > 0 ? (
          <div className="flex flex-col gap-y-0.5 min-w-0">
            <StatementPredicateObject
              statement={head}
              termRenderer={termRenderer}
            />
            {headSiblings.map((s, i) => (
              <StatementPredicateObject
                key={i}
                statement={s}
                termRenderer={termRenderer}
              />
            ))}
          </div>
        ) : head ? (
          // Single-statement (or no siblings) — keep the original
          // inline pred/obj rendering so the (n) + baseline glyph
          // stay on the same row.
          <StatementPredicateObject
            statement={head}
            termRenderer={termRenderer}
            inline
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
        {n > 0 ? (
          <span className="text-[10px] text-slate-500 dark:text-slate-400 ml-0.5">
            ({n})
          </span>
        ) : null}
        {trailing}
      </div>
      {/* Sub-rows for statements whose subject differs from the head
          (rare — multi-subject FVs). Each renders as a full Subj -
          Pred - Obj sub-line, indented to align with the head's
          subject column (w-10 FV-gutter + gap-1.5 ≈ 2.875rem). */}
      {otherRest.length > 0 ? (
        <div className="pl-[2.875rem] mt-0.5 space-y-0.5">
          {otherRest.map((s, i) => (
            <ExtraStatementLine
              key={i}
              statement={s}
              termRenderer={termRenderer}
            />
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
}: {
  statement: FvDisplayStatement;
  termRenderer: FvTermRenderer;
  inline?: boolean;
}): JSX.Element | null {
  const predLabel = statement.predicate?.label?.trim() ?? "";
  const predUri = statement.predicate?.uri ?? null;
  const objLabel = statement.object?.label?.trim() ?? "";
  const objUri = statement.object?.uri ?? null;
  if (!predLabel && !objLabel) return null;
  const content = (
    <>
      {predLabel ? (
        <>
          <span className="text-slate-400 dark:text-slate-500"> - </span>
          <span
            className="text-[10px] text-slate-500 dark:text-slate-200 font-mono"
            title={predUri || undefined}
          >
            {predLabel}
          </span>
        </>
      ) : null}
      {objLabel ? (
        <>
          <span className="text-slate-400 dark:text-slate-500"> - </span>
          {termRenderer({ label: objLabel, uri: objUri })}
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

function ExtraStatementLine({
  statement,
  termRenderer,
}: {
  statement: FvDisplayStatement;
  termRenderer: FvTermRenderer;
}): JSX.Element {
  const subjLabel = statement.subject?.label?.trim() ?? "";
  const subjUri = statement.subject?.uri ?? null;
  const predLabel = statement.predicate?.label?.trim() ?? "";
  const predUri = statement.predicate?.uri ?? null;
  const objLabel = statement.object?.label?.trim() ?? "";
  const objUri = statement.object?.uri ?? null;
  return (
    <div className="flex items-baseline gap-x-1.5 text-[11px]">
      {subjLabel
        ? termRenderer({ label: subjLabel, uri: subjUri })
        : null}
      {predLabel ? (
        <>
          <span className="text-slate-400 dark:text-slate-500"> - </span>
          <span
            className="text-[10px] text-slate-500 dark:text-slate-200 font-mono"
            title={predUri || undefined}
          >
            {predLabel}
          </span>
        </>
      ) : null}
      {objLabel ? (
        <>
          <span className="text-slate-400 dark:text-slate-500"> - </span>
          {termRenderer({ label: objLabel, uri: objUri })}
        </>
      ) : null}
    </div>
  );
}

/** Local className-merge — packages/ontology stays dep-light. */
function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
