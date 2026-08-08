import { useState } from "react";
import { Pill } from "@/components/ui/Pill";
import { InlineText } from "@/components/ui/InlineText";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Term } from "@/components/ui/Term";
import {
  StatementEditor,
  StatementGroupEditor,
  groupStatementsBySubject,
} from "./StatementEditor";
import {
  templatesFor,
  type StatementTemplate,
} from "./statementTemplates";
import {
  factorRequiresBaseline,
  type FactorValue,
  type OntologyTerm,
} from "@/features/experiment/types";
import type { FvChange } from "./diff";
import { AuditDot } from "@/features/audit/AuditDot";
import { fvTarget } from "@/features/audit/targetIds";

export function FactorValueCard({
  fv,
  factorCategory,
  change,
  onLabelChange,
  onToggleBaseline,
  onDelete,
  onDuplicate,
  onAddStatement,
  onAddSiblingStatement,
  onAddStatementFromTemplate,
  onAssignRemaining,
  remainingCount,
  onStatementChange,
  onStatementDelete,
  onRevert,
  compact = false,
  onExpand,
}: {
  fv: FactorValue;
  factorCategory: OntologyTerm | null;
  /** Compact view — hide per-FV editing chrome and render the
   *  statements as read-only S - P - O rows. Header (title +
   *  sample count + MODIFIED badge + revert) stays visible. */
  compact?: boolean;
  change: FvChange | null;
  onLabelChange: (label: string) => void;
  onToggleBaseline: () => void;
  onDelete: () => void;
  /** Optional clone affordance — when wired, the FV header surfaces a
   *  "Duplicate" button. Clone semantics: copy label + statements,
   *  clear sample assignment + baseline (per
   *  ``duplicateFactorValue`` in mutations.ts). Design review 2026-06-14. */
  onDuplicate?: () => void;
  onAddStatement: () => void;
  /** Append a statement that inherits the seed's category + subject
   *  (predicate / object blank). Used by the "+ sibling" action in
   *  a ``StatementGroupEditor`` where the curator's intent is
   *  "another claim about this same subject". Optional — when
   *  absent, sibling-add falls back to a blank statement via
   *  ``onAddStatement``. */
  onAddSiblingStatement?: (seed: FactorValue["statements"][number]) => void;
  onAddStatementFromTemplate?: (template: StatementTemplate) => void;
  onAssignRemaining?: () => void;
  remainingCount?: number;
  onStatementChange: (index: number, next: FactorValue["statements"][number]) => void;
  onStatementDelete: (index: number) => void;
  /** Atomic per-FV revert. Renders a small "revert" link next to
   *  the change badge when this FV has uncommitted edits. Optional
   *  so older callers (any tombstone-only render path that doesn't
   *  want a revert affordance) can omit it. */
  onRevert?: () => void;
  /** Optional handler invoked when the curator double-clicks the card
   *  in compact mode. Wire to the same toggle that drives ``compact``
   *  so a dbl-click on read-only chrome promotes the card back to the
   *  full editor — otherwise the curator has to find the ≫ chevron in
   *  the header to start editing. No-op when not in compact mode. */
  onExpand?: () => void;
}) {
  const isAdded = change?.kind === "added";
  const isModified = change?.kind === "modified";
  const isRemoved = change?.kind === "removed";
  const [confirming, setConfirming] = useState(false);

  // Skip the modal on truly empty FVs (no label, no statements,
  // no samples) — those are obvious mistakes, click-to-undo is
  // worse than the friction of an extra modal.
  const hasContent =
    !!fv.free_text_label.trim() ||
    fv.statements.some(
      (s) =>
        s.subject?.label?.trim() ||
        s.predicate?.label?.trim() ||
        s.object?.label?.trim(),
    ) ||
    fv.biomaterial_short_names.length > 0;

  const before = change?.before;
  const labelChanged = change?.kind === "modified" && change.fields?.label;
  const baselineChanged = change?.kind === "modified" && change.fields?.baseline;
  const stmtsChanged = change?.kind === "modified" && change.fields?.statements;
  const bmsChanged = change?.kind === "modified" && change.fields?.biomaterials;

  // Visual treatment per change-kind. The card stays in flow; only the
  // border + badge varies.
  const borderClass = isAdded
    ? "border-l-4 border-l-emerald-500"
    : isModified
      ? "border-l-4 border-l-amber-500"
      : isRemoved
        ? "border-l-4 border-l-rose-500 bg-rose-50/50"
        : "";

  // For removed (tombstone) cards, dim everything and disable controls.
  const tombstoneText = isRemoved ? "line-through text-slate-500" : "";

  return (
    <article
      // Audit focus hook — Apply & focus on an FV finding scrolls
      // this card into view + ring-flashes it. target_id slug
      // matches the agent contract (fv:<factor-slug>/<fv-slug>).
      data-audit-target={fvTarget(
        factorCategory?.label || "",
        fv.free_text_label || "",
        fv.id,
      )}
      // In compact mode the FV label + statements render as read-only
      // spans, so double-clicking them does nothing. Promote the card
      // back to the full editor on dbl-click so the curator doesn't
      // have to hunt for the ≫ chevron in the parent header. The same
      // dbl-click won't auto-open the underlying InlineText (the
      // target wasn't rendered yet) but the curator's natural next
      // motion is to dbl-click again on the now-visible field.
      onDoubleClick={
        compact && onExpand && !isRemoved
          ? (e) => {
              e.stopPropagation();
              onExpand();
            }
          : undefined
      }
      className={
        // Self-contained card. The hairline ``border-b`` we used to
        // ride between FVs disappeared into the sky-tinted parent
        // background, so curators couldn't tell where one FV ended
        // and the next began. Now each card has its own opaque
        // background + full border + rounded corners, separated by
        // the parent's ``space-y-2`` gap. ``borderClass`` carries the
        // change-kind tone via a thicker left border (added /
        // modified / removed).
        "px-3 py-2 rounded-md border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-700 " +
        borderClass +
        (compact && onExpand && !isRemoved
          ? " cursor-text"
          : "")
      }
      title={
        compact && onExpand && !isRemoved
          ? "double-click to expand and edit"
          : undefined
      }
    >
      <header className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          {/* Removed a non-functional checkbox that lived here — no
              ``checked`` / ``onChange`` was wired in, leaving a stub
              control next to the FV label that looked actionable but
              wasn't. Compaction came as a bonus: each card is now
              ~12px shorter, which adds up over a six-FV factor.
              The header free-text-label slot now also collapses when
              the FV has exactly one ontology-anchored statement with
              a matching subject label — see comment above. */}
          {(() => {
            // An FV's natural name is its own free-text label, or — when
            // it has none — the subject label of its single statement
            // (an FV with one "reference substance role" statement is
            // named for that term). This header used to suppress itself
            // in the open editor whenever the label matched the subject,
            // which left such FVs looking nameless AND gave the curator
            // nothing to double-click to add or edit a label. Always
            // render a title now: when the FV has no label of its own we
            // surface the subject label as the (editable) placeholder, so
            // the derived name shows through and double-clicking still
            // opens the input for an explicit override. In compact mode
            // the statement row drops its now-redundant subject label
            // (see hideSubjectLabel below) so the term never renders
            // twice; in the open editor the subject stays because it IS
            // the editable term picker.
            const explicit = (fv.free_text_label || "").trim();
            const onlyStmt =
              fv.statements.length === 1 ? fv.statements[0] : null;
            const subjectLabel = (onlyStmt?.subject?.label || "").trim();
            const derivedName = !explicit && !!subjectLabel ? subjectLabel : "";
            return (
              <span className={"font-medium text-sm " + tombstoneText}>
                {isRemoved || compact ? (
                  <span>{explicit || derivedName || <em>(blank)</em>}</span>
                ) : (
                  <InlineText
                    value={fv.free_text_label}
                    placeholder={derivedName || "free-text label"}
                    onCommit={onLabelChange}
                  />
                )}
              </span>
            );
          })()}
          {/* Inline audit indicator on the FV card title. Resolves
              against AuditContext via the (factor-category, FV-label)
              slug pair; renders nothing when no audit is loaded or
              this FV isn't flagged. */}
          <AuditDot
            targetId={fvTarget(
              factorCategory?.label || "",
              fv.free_text_label || "",
              fv.id,
            )}
          />
          {labelChanged && before ? (
            <span
              className="text-xs text-slate-400 line-through"
              title="previous label"
            >
              {before.free_text_label || "(blank)"}
            </span>
          ) : null}

          {isRemoved ? (
            fv.is_baseline ? (
              <span className="text-xs text-slate-400 line-through">
                baseline
              </span>
            ) : null
          ) : factorRequiresBaseline(factorCategory) ? (
            <button
              type="button"
              onClick={onToggleBaseline}
              title={fv.is_baseline ? "Unmark as baseline" : "Mark as baseline"}
              className="cursor-pointer"
            >
              {fv.is_baseline ? (
                <Pill variant="baseline">▂ baseline</Pill>
              ) : (
                <span className="text-xs text-slate-400 hover:text-slate-700 underline">
                  set baseline
                </span>
              )}
            </button>
          ) : null
          /*
            Block / batch factors are nuisance variables — there's
            no natural baseline. Suppress the "set baseline" link
            entirely; the validator + commit gate also skip the
            baseline-required check for these categories.
          */}
          {baselineChanged && before ? (
            <span
              className="text-[11px] text-amber-700"
              title="baseline flag changed"
            >
              (was {before.is_baseline ? "baseline" : "non-baseline"})
            </span>
          ) : null}

          {/*
            Metadata (FV id + sample count) was a separate slate-400
            line that read as visual noise on every FV. Compressed to
            just the sample count — the id stays in a tooltip on the
            title for cases the curator needs it. The "(was N)"
            change marker still surfaces inline because it's an edit
            signal, not metadata.
          */}
          <span
            className={
              fv.biomaterial_short_names.length === 0
                ? "text-xs font-semibold text-rose-700 dark:text-rose-400"
                : "text-xs text-slate-400"
            }
            title={
              fv.biomaterial_short_names.length === 0
                ? `FV id ${fv.id} — no samples assigned. This factor value will not appear in any analysis; assign at least one sample or delete this FV.`
                : `FV id ${fv.id}`
            }
          >
            {fv.biomaterial_short_names.length === 0 ? (
              <span aria-hidden className="mr-0.5">⚠</span>
            ) : null}
            {fv.biomaterial_short_names.length} sample
            {fv.biomaterial_short_names.length === 1 ? "" : "s"}
            {bmsChanged && before ? (
              <span
                className="ml-1 text-amber-700"
                title="sample assignment changed"
              >
                (was {before.biomaterial_short_names.length})
              </span>
            ) : null}
          </span>

          <ChangeBadge change={change} />
          {/* Atomic per-FV revert. Visible whenever the FV has a
              change relative to saved — modified, added, or removed
              (tombstone). Click discards every uncommitted edit on
              this single FV without touching siblings.
              Tooltip wording leans on the change kind so the curator
              knows what gets discarded:
                modified → label / baseline / statements / samples
                added    → the FV itself (it didn't exist on saved)
                removed  → restores the deleted FV from saved */}
          {onRevert && change ? (
            <button
              type="button"
              onClick={onRevert}
              className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:bg-amber-900/30 dark:hover:bg-amber-900/50"
              title={
                change.kind === "added"
                  ? "discard this FV — it didn't exist on the saved baseline"
                  : change.kind === "removed"
                    ? "restore this FV from the saved baseline"
                    : "discard your edits to this FV (label, baseline, statements, sample assignments) and restore from saved"
              }
            >
              <span aria-hidden className="text-[11px] leading-none">↺</span>
              Undo
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {isRemoved ? (
            <span className="text-xs text-rose-700">deleted (uncommitted)</span>
          ) : compact ? null : (
            <>
              {onAssignRemaining && (remainingCount ?? 0) > 0 ? (
                <button
                  type="button"
                  className="text-[10px] px-1.5 py-0.5 rounded border border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 dark:border-indigo-700 dark:text-indigo-200 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50"
                  onClick={onAssignRemaining}
                  title={`Assign all ${remainingCount} unassigned sample(s) to this FV`}
                >
                  Assign remaining {remainingCount}
                </button>
              ) : null}
              {onDuplicate ? (
                <button
                  type="button"
                  className="text-[10px] px-1.5 py-0.5 rounded border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
                  onClick={onDuplicate}
                  title="Duplicate this FV — copies label + statements, clears sample assignment"
                >
                  Duplicate
                </button>
              ) : null}
              <button
                type="button"
                className="text-[10px] px-1.5 py-0.5 rounded border border-rose-300 text-rose-700 bg-white hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:bg-slate-800 dark:hover:bg-rose-900/30"
                onClick={() => {
                  if (hasContent) setConfirming(true);
                  else onDelete();
                }}
                title="Delete this FV"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </header>
      <div className="ml-2">
        {/* ``ml-2`` indent (was ml-6, sized for the now-removed
            checkbox column) keeps a small visual offset so the
            statements still read as nested under the FV label
            without wasting horizontal space. */}
        <ol
          className={
            "space-y-1 " +
            (stmtsChanged
              ? "border-l-2 border-amber-200 pl-2 -ml-2"
              : isRemoved
                ? "opacity-60"
                : "")
          }
        >
          {/*
            Group statements by (category, subject). Singletons —
            the common case, one statement per FV — render inline
            via the original ``StatementEditor`` so we don't bloat
            the editor vertically. Multi-statement groups render
            via ``StatementGroupEditor`` with one shared subject
            and stacked predicate/object rows (matches Gemma's
            "delivered at dose X / delivered for duration Y" layout).
          */}
          {isRemoved
            ? fv.statements.map((s, i) => (
                <li key={i}>
                  <ReadonlyStatement statement={s} />
                </li>
              ))
            : compact
              ? (() => {
                  const grouped = groupStatementsBySubject(fv.statements);
                  return grouped.map((group, gi) => (
                    <li key={`cgrp-${gi}`}>
                      {group.statements.length === 1 ? (
                        <CompactStatementRow statement={group.statements[0]} />
                      ) : (
                        <CompactStatementGroup statements={group.statements} />
                      )}
                    </li>
                  ));
                })()
              : groupStatementsBySubject(fv.statements, {
                // Editable view: keep in-progress bare "+ pred/obj"
                // rows so adding a second predicate to a subject that
                // already has one isn't silently swallowed. Compact
                // view (above) still drops them as noise.
                dropBareWithReal: false,
              }).map((group, gi) => (
                <li key={`grp-${gi}`}>
                  {group.statements.length === 1 ? (
                    <StatementEditor
                      statement={group.statements[0]}
                      factorCategory={factorCategory}
                      onChange={(next) =>
                        onStatementChange(group.indices[0], next)
                      }
                      onDelete={() => onStatementDelete(group.indices[0])}
                      onAddSibling={
                        onAddSiblingStatement
                          ? () =>
                              onAddSiblingStatement(group.statements[0])
                          : undefined
                      }
                    />
                  ) : (
                    <StatementGroupEditor
                      statements={group.statements}
                      factorCategory={factorCategory}
                      onChange={(localIdx, next) =>
                        onStatementChange(group.indices[localIdx], next)
                      }
                      onDelete={(localIdx) =>
                        onStatementDelete(group.indices[localIdx])
                      }
                      onAddSibling={() => {
                        // Sibling = "another claim about the same
                        // subject" — seed the new statement with the
                        // group head's category + subject so the
                        // curator only fills in predicate + object.
                        // Falls back to a blank statement when the
                        // parent didn't wire the sibling handler.
                        if (onAddSiblingStatement) {
                          onAddSiblingStatement(group.statements[0]);
                        } else {
                          onAddStatement();
                        }
                      }}
                    />
                  )}
                </li>
              ))}
          {isRemoved || compact ? null : (
            <li>
              {/*
                Compact add-row. Both buttons render as inline
                text-only links instead of full button chrome —
                they're affordances, not primary actions, so they
                shouldn't claim a button-sized slot of their own.
              */}
              <span className="inline-flex items-center gap-2 text-[11px]">
                <button
                  type="button"
                  className="text-slate-500 hover:text-slate-800 underline underline-offset-2"
                  onClick={onAddStatement}
                  title="Add a new statement under this factor value"
                >
                  + statement
                </button>
                {onAddStatementFromTemplate &&
                templatesFor(factorCategory).length > 0 ? (
                  <select
                    className="text-[11px] border-0 bg-transparent text-slate-400 hover:text-slate-700 cursor-pointer max-w-[7rem] truncate underline underline-offset-2 decoration-dotted"
                    value=""
                    onChange={(e) => {
                      const id = e.target.value;
                      if (!id) return;
                      const tpl = templatesFor(factorCategory).find(
                        (t) => t.id === id,
                      );
                      if (tpl) onAddStatementFromTemplate(tpl);
                      e.target.value = "";
                    }}
                    title="Insert a Confluence-pattern statement"
                  >
                    <option value="">+ tpl…</option>
                    {templatesFor(factorCategory).map((t) => (
                      <option key={t.id} value={t.id} title={t.description}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                ) : null}
              </span>
            </li>
          )}
        </ol>
      </div>

      <ConfirmModal
        open={confirming}
        title={`Delete factor value "${fv.free_text_label || "(unnamed)"}"`}
        body={
          fv.biomaterial_short_names.length > 0
            ? `Removes ${fv.biomaterial_short_names.length} sample assignment${
                fv.biomaterial_short_names.length === 1 ? "" : "s"
              } and ${fv.statements.length} statement${
                fv.statements.length === 1 ? "" : "s"
              }.`
            : `Removes ${fv.statements.length} statement${
                fv.statements.length === 1 ? "" : "s"
              }.`
        }
        confirmLabel="Delete"
        onConfirm={() => {
          onDelete();
          setConfirming(false);
        }}
        onCancel={() => setConfirming(false)}
      />
    </article>
  );
}

function ChangeBadge({ change }: { change: FvChange | null }) {
  if (!change) return null;
  const map = {
    added: { label: "new", cls: "bg-emerald-100 text-emerald-800" },
    modified: { label: "modified", cls: "bg-amber-100 text-amber-800" },
    removed: { label: "deleted", cls: "bg-rose-100 text-rose-800" },
  } as const;
  const m = map[change.kind];
  return (
    <span
      className={
        "text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded " +
        m.cls
      }
    >
      {m.label}
    </span>
  );
}

/** Read-only rendering of a Statement, used for tombstone tiles. */
function ReadonlyStatement({
  statement,
}: {
  statement: FactorValue["statements"][number];
}) {
  const subj = statement.subject?.label || "(blank)";
  const pred = statement.predicate?.label;
  const obj = statement.object?.label;
  return (
    <div className="text-sm text-slate-500 line-through">
      <span>{subj}</span>
      {pred ? <span className="mx-1">{pred}</span> : null}
      {obj ? <span>{obj}</span> : null}
    </div>
  );
}

/** Compact-mode statement render — S - P - O row with Term chips
 *  on subject + object, muted predicate, and " - " separators
 *  collapsing out missing parts. Matches the audit editor's
 *  ComparatorLine convention so the design and audit surfaces
 *  read the same way.
 *
 *  The subject label is ALWAYS rendered. A previous pass dropped it
 *  to a bare CURIE whenever the FV header already carried the same
 *  string, to avoid printing it twice. That traded a small
 *  duplication for two real losses: a free-text subject has no CURIE,
 *  so the row collapsed to just the category chip and an ungrounded
 *  term became indistinguishable from a rendering glitch; and a
 *  grounded subject rendered as an unlabelled ``CL:0002322`` while the
 *  category beside it kept label + CURIE, so the row read as though a
 *  label were missing. It was also inconsistent with
 *  ``CompactStatementGroup``, which always shows the subject — a
 *  one-statement FV lost its subject where a two-statement FV kept it.
 *  Echoing the header is the cheaper cost. */
function CompactStatementRow({
  statement,
}: {
  statement: FactorValue["statements"][number];
}) {
  const cat = statement.category;
  const subj = statement.subject;
  const pred = statement.predicate;
  const obj = statement.object;
  const hasCat = !!cat?.label?.trim();
  const hasPred = !!pred?.label?.trim();
  const hasObj = !!obj?.label?.trim();
  const subjUri = subj?.uri ?? null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 text-[12px]">
      {/* Category chip leads the row so the compact view reads as a
          full statement triple — Design review 2026-06-14: "the full statement
          should be shown, like in the review panel." Hidden when the
          statement carries no category (rare, but the type allows). */}
      {hasCat ? (
        <Term
          uri={cat?.uri ?? null}
          asLink={false}
          className="!whitespace-normal break-words"
        >
          {cat!.label!}
        </Term>
      ) : null}
      <Term
        uri={subjUri}
        asLink={false}
        className="!whitespace-normal break-words"
      >
        {subj?.label || "(blank)"}
      </Term>
      {hasPred ? (
        <>
          <span className="text-slate-400 dark:text-slate-500"> - </span>
          <span
            className="text-[10px] text-slate-500 dark:text-slate-200 font-mono"
            title={pred?.uri || undefined}
          >
            {pred?.label}
          </span>
        </>
      ) : null}
      {hasObj ? (
        <>
          <span className="text-slate-400 dark:text-slate-500"> - </span>
          <Term
            uri={obj?.uri ?? null}
            asLink={false}
            className="!whitespace-normal break-words"
          >
            {obj?.label}
          </Term>
        </>
      ) : null}
    </div>
  );
}

/** Compact-mode rendering for a group of statements that share the
 *  same (category, subject). Mirrors Gemma's multi-PO statement
 *  shape (one subject, many predicate-object pairs) visually —
 *  subject chip on the left, each P/O pair inline next to it on the
 *  SAME row, wrapping only when the row overflows. So a Srsf1 FV
 *  with two has_genotype statements collapses to
 *  ``Srsf1 - has_genotype - WT - has_genotype - KO`` on one line;
 *  long rows wrap naturally via ``flex-wrap``. Per design review:
 *
 *    2026-05-21 — subject shouldn't be repeated when shared.
 *    2026-06-12 — "they can be shown on the same row, at least in
 *                 the compact view". */
function CompactStatementGroup({
  statements,
}: {
  /** Length >= 2; singletons go through ``CompactStatementRow``
   *  directly. */
  statements: FactorValue["statements"];
}) {
  const head = statements[0];
  const subj = head.subject;
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 text-[12px]">
      <Term
        uri={subj?.uri ?? null}
        asLink={false}
        className="!whitespace-normal break-words"
      >
        {subj?.label || "(blank)"}
      </Term>
      {statements.map((s, i) => {
        const pred = s.predicate;
        const obj = s.object;
        const hasPred = !!pred?.label?.trim();
        const hasObj = !!obj?.label?.trim();
        if (!hasPred && !hasObj) return null;
        return (
          <span
            key={i}
            className="inline-flex items-baseline gap-x-1.5 flex-wrap"
          >
            {hasPred ? (
              <>
                <span className="text-slate-400 dark:text-slate-500">
                  {" - "}
                </span>
                <span
                  className="text-[10px] text-slate-500 dark:text-slate-200 font-mono"
                  title={pred?.uri || undefined}
                >
                  {pred?.label}
                </span>
              </>
            ) : null}
            {hasObj ? (
              <>
                <span className="text-slate-400 dark:text-slate-500">
                  {" - "}
                </span>
                <Term
                  uri={obj?.uri ?? null}
                  asLink={false}
                  className="!whitespace-normal break-words"
                >
                  {obj?.label}
                </Term>
              </>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
