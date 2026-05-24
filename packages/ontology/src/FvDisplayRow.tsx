/**
 * Shared factor-value display row used across the curation app (audit
 * panel + proposal-review surface) and the browser app (dataset page /
 * design summaries). Pulled out 2026-05-24 so baseline-glyph, dedup,
 * and sample-count conventions live in one place.
 *
 * Layout:
 *   [▂|○] label [inline CURIE if redundant single stmt] (n) [...extras]
 *      ↳ optional per-statement subrow when NOT redundant
 *
 * Dedup rule: when the FV has exactly one statement whose subject
 * has a URI, the subject label matches the free-text label, and the
 * statement has no predicate / object, the per-statement subrow is
 * suppressed — the inline term carries the same info. Multi-statement
 * and has-predicate FVs render the full S · P · O list below.
 *
 * Callers pass surface-specific extras (status glyphs, match chips,
 * assignment confidence) via the `leading` / `trailing` slots. The
 * ontology term itself is rendered via a caller-supplied
 * `termRenderer` so the curation app can use its rich chip Term and
 * the browser app can use a simpler link-only renderer.
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
 *  renderer. Caller is responsible for handling free-text (no URI)
 *  styling — usually italic-stone in curation, plain in browser. */
export type FvTermRenderer = (props: {
  label: string;
  uri: string | null;
  /** True for the predicate slot — caller can use this to apply the
   *  muted predicate styling without inferring it from URI absence. */
  variant?: "default" | "predicate";
}) => JSX.Element;

/** True when this FV's identity is fully carried by its label + a single
 *  ontology-anchored statement subject. Used to collapse the redundant
 *  per-statement subrow below. */
export function isFvSubjectRedundant(fv: FvDisplayLike): boolean {
  const statements = fv.statements ?? [];
  if (statements.length !== 1) return false;
  const s = statements[0];
  const subjUri = s.subject?.uri ?? null;
  if (!subjUri) return false;
  const subjLab = (s.subject?.label || "").trim().toLowerCase();
  const fvLab = (fv.free_text_label || "").trim().toLowerCase();
  if (!fvLab || subjLab !== fvLab) return false;
  if (s.predicate?.label) return false;
  if (s.object?.label) return false;
  return true;
}

/** Short CURIE form for a URI — last path-segment after the final `#`
 *  or `/`. Mirrors the curation app's mini-curie convention. */
function shortCurie(uri: string): string {
  const tail = uri.split(/[#/]/).filter(Boolean).pop();
  return tail ?? uri;
}

export interface FvDisplayRowProps {
  fv: FvDisplayLike;
  /** Caller-supplied ontology-term renderer. See `FvTermRenderer`. */
  termRenderer: FvTermRenderer;
  /** Slot rendered before the level glyph — used by surfaces that
   *  need to thread a pairing status glyph or similar in the lead. */
  leading?: ReactNode;
  /** Slot rendered after the sample count — used by surfaces that
   *  need to surface match chips / confidence chips / proposer
   *  badges at the end of the row. */
  trailing?: ReactNode;
  /** When true, the `○` glyph appears for non-baseline FVs. Default
   *  `true`; pass `false` on surfaces (audit) where only baseline
   *  warrants a glyph. */
  showLevelGlyph?: boolean;
  /** Label font. ``"mono"`` matches a data-view look; ``"text"`` is
   *  the default body-text style. */
  labelFont?: "mono" | "text";
  /** Optional class on the outer wrapper. */
  className?: string;
}

export function FvDisplayRow({
  fv,
  termRenderer,
  leading,
  trailing,
  showLevelGlyph = true,
  labelFont = "text",
  className,
}: FvDisplayRowProps): JSX.Element {
  const redundant = isFvSubjectRedundant(fv);
  const onlyStmt =
    (fv.statements?.length ?? 0) === 1 ? fv.statements?.[0] : null;
  const subjUri = onlyStmt?.subject?.uri ?? null;
  const lab = (fv.free_text_label || "").trim() || "(unlabeled)";
  const n = fv.biomaterial_short_names?.length ?? 0;
  return (
    <div className={cx("text-[11px] space-y-0.5", className)}>
      <div className="flex items-baseline gap-1.5 flex-wrap">
        {/* Level glyph — ▂ for baseline (amber), ○ for a regular
            factor level (sky, less emphatic). */}
        {fv.is_baseline ? (
          <span
            className="w-2.5 inline-block text-center shrink-0 leading-none text-amber-500 dark:text-amber-400"
            title="baseline (reference level)"
            aria-label="baseline"
          >
            ▂
          </span>
        ) : showLevelGlyph ? (
          <span
            className="w-2.5 inline-block text-center shrink-0 leading-none text-sky-500/80 dark:text-sky-400/80"
            title="factor level"
            aria-hidden
          >
            ○
          </span>
        ) : null}
        {leading}
        {/* Label — replaced by an inline term chip when the only
            statement's subject is redundant. */}
        {redundant && subjUri ? (
          termRenderer({ label: lab, uri: subjUri })
        ) : (
          <span
            className={cx(
              "min-w-0 break-words",
              labelFont === "mono"
                ? "font-mono text-slate-900 dark:text-slate-100"
                : "text-slate-700 dark:text-slate-200",
            )}
          >
            {lab}
          </span>
        )}
        {/* When NOT redundant but the only statement subject still
            carries a URI, surface a tiny CURIE next to the label. */}
        {!redundant && onlyStmt?.subject?.uri ? (
          <span
            className="font-mono text-[9px] text-slate-400 dark:text-slate-500"
            title={onlyStmt.subject.uri}
          >
            {shortCurie(onlyStmt.subject.uri)}
          </span>
        ) : null}
        {n > 0 ? (
          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono shrink-0">
            ({n})
          </span>
        ) : null}
        {trailing}
      </div>
      {/* Per-statement subrow — skipped when the FV's identity is
          fully covered by the inline term above. */}
      {!redundant && (fv.statements?.length ?? 0) > 0 ? (
        <ul className="pl-3.5 mt-0.5 space-y-0.5">
          {(fv.statements ?? []).map((s, i) => (
            <StatementSubrow
              key={i}
              statement={s}
              termRenderer={termRenderer}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Per-statement subrow — S · P · O via the caller's termRenderer. */
function StatementSubrow({
  statement,
  termRenderer,
}: {
  statement: FvDisplayStatement;
  termRenderer: FvTermRenderer;
}): JSX.Element {
  const subj = statement.subject;
  const pred = statement.predicate;
  const obj = statement.object;
  const hasSubject = !!(subj?.label || subj?.uri);
  const hasPredicate = !!(pred?.label || pred?.uri);
  const hasObject = !!(obj?.label || obj?.uri);
  return (
    <li className="text-[10.5px]">
      <div className="flex items-baseline gap-1 flex-wrap">
        {hasSubject
          ? termRenderer({ label: subj!.label ?? "", uri: subj!.uri ?? null })
          : null}
        {hasPredicate
          ? termRenderer({
              label: pred!.label ?? "",
              uri: pred!.uri ?? null,
              variant: "predicate",
            })
          : null}
        {hasObject
          ? termRenderer({ label: obj!.label ?? "", uri: obj!.uri ?? null })
          : null}
      </div>
    </li>
  );
}

/** Local cn — packages/ontology stays dep-light; no peer on a class-
 *  merge utility. Falsy values are dropped; the rest joined by space. */
function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
