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
  const predLabel = head?.predicate?.label?.trim() ?? "";
  const predUri = head?.predicate?.uri ?? null;
  const objLabel = head?.object?.label?.trim() ?? "";
  const objUri = head?.object?.uri ?? null;
  const n = fv.biomaterial_short_names?.length ?? 0;
  return (
    <div className={cx("text-[12px]", className)}>
      <div className="flex flex-wrap items-baseline gap-x-1.5">
        {leading}
        {indexLabel != null ? (
          <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400 w-20 shrink-0">
            FV {indexLabel}
          </span>
        ) : null}
        {subjLabel ? (
          termRenderer({ label: subjLabel, uri: subjUri })
        ) : (
          <span className="italic text-slate-400">(blank)</span>
        )}
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
        {objLabel
          ? (
            <>
              <span className="text-slate-400 dark:text-slate-500"> - </span>
              {termRenderer({ label: objLabel, uri: objUri })}
            </>
          )
          : null}
        {fv.is_baseline ? (
          <span
            className="text-[9px] uppercase tracking-wide font-semibold text-amber-700 dark:text-amber-400 ml-0.5"
            title="baseline (reference level)"
          >
            ★ baseline
          </span>
        ) : null}
        {n > 0 ? (
          <span className="text-[10px] text-slate-500 dark:text-slate-400 ml-0.5">
            ({n})
          </span>
        ) : null}
        {trailing}
      </div>
      {/* Multi-statement: stack the remaining statements as indented
          sublines, each rendering as Subj - Pred - Obj. */}
      {rest.length > 0 ? (
        <div className="pl-[5.25rem] mt-0.5 space-y-0.5">
          {rest.map((s, i) => (
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
    <div className="flex flex-wrap items-baseline gap-x-1.5 text-[11px]">
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
