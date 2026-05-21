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
  onAddStatement,
  onAddSiblingStatement,
  onAddStatementFromTemplate,
  onAssignRemaining,
  remainingCount,
  onStatementChange,
  onStatementDelete,
  onRevert,
  compact = false,
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
      )}
      className={
        "px-3 py-1.5 border-b border-slate-100 " + borderClass
      }
    >
      <header className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          {/* Removed a non-functional checkbox that lived here — no
              ``checked`` / ``onChange`` was wired in, leaving a stub
              control next to the FV label that looked actionable but
              wasn't. Compaction came as a bonus: each card is now
              ~12px shorter, which adds up over a six-FV factor. */}
          <span className={"font-medium text-sm " + tombstoneText}>
            {isRemoved || compact ? (
              <span>{fv.free_text_label || <em>(blank)</em>}</span>
            ) : (
              <InlineText
                value={fv.free_text_label}
                placeholder="free-text label"
                onCommit={onLabelChange}
              />
            )}
          </span>
          {/* Inline audit indicator on the FV card title. Resolves
              against AuditContext via the (factor-category, FV-label)
              slug pair; renders nothing when no audit is loaded or
              this FV isn't flagged. */}
          <AuditDot
            targetId={fvTarget(
              factorCategory?.label || "",
              fv.free_text_label || "",
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
                <Pill variant="baseline">★ baseline</Pill>
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
            className="text-xs text-slate-400"
            title={`FV id ${fv.id}`}
          >
            {fv.biomaterial_short_names.length} samples
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
              className="inline-flex items-center gap-0.5 text-[11px] font-medium text-amber-700 hover:text-rose-700 underline-offset-2 hover:underline dark:text-amber-400 dark:hover:text-rose-400"
              title={
                change.kind === "added"
                  ? "discard this FV — it didn't exist on the saved baseline"
                  : change.kind === "removed"
                    ? "restore this FV from the saved baseline"
                    : "discard your edits to this FV (label, baseline, statements, sample assignments) and restore from saved"
              }
            >
              <span aria-hidden className="text-[12px] leading-none">↺</span>
              revert
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
                  className="btn ghost text-xs text-indigo-700"
                  onClick={onAssignRemaining}
                  title={`Assign all ${remainingCount} unassigned sample(s) to this FV`}
                >
                  assign remaining {remainingCount}
                </button>
              ) : null}
              <button
                className="btn ghost text-xs text-rose-700"
                onClick={() => {
                  if (hasContent) setConfirming(true);
                  else onDelete();
                }}
              >
                delete FV
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
              ? groupStatementsBySubject(fv.statements).map((group, gi) => (
                  <li key={`cgrp-${gi}`}>
                    {group.statements.length === 1 ? (
                      <CompactStatementRow statement={group.statements[0]} />
                    ) : (
                      <CompactStatementGroup statements={group.statements} />
                    )}
                  </li>
                ))
              : groupStatementsBySubject(fv.statements).map((group, gi) => (
                <li key={`grp-${gi}`}>
                  {group.statements.length === 1 ? (
                    <StatementEditor
                      statement={group.statements[0]}
                      factorCategory={factorCategory}
                      onChange={(next) =>
                        onStatementChange(group.indices[0], next)
                      }
                      onDelete={() => onStatementDelete(group.indices[0])}
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
        confirmLabel="delete FV"
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
 *  read the same way. */
function CompactStatementRow({
  statement,
}: {
  statement: FactorValue["statements"][number];
}) {
  const subj = statement.subject;
  const pred = statement.predicate;
  const obj = statement.object;
  const hasPred = !!pred?.label?.trim();
  const hasObj = !!obj?.label?.trim();
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 text-[12px]">
      <Term
        uri={subj?.uri ?? null}
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
 *  same (category, subject). Mirrors `StatementGroupEditor`'s
 *  layout but read-only — subject chip on the left, each
 *  statement's `predicate - object` pair stacked in a column to
 *  the right. So a Srsf1 FV with two has_genotype statements
 *  collapses to one subject + two stacked P/O rows instead of
 *  repeating the (long) subject twice. Per Paul 2026-05-21. */
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
      <div className="flex flex-col gap-1 min-w-0">
        {statements.map((s, i) => {
          const pred = s.predicate;
          const obj = s.object;
          const hasPred = !!pred?.label?.trim();
          const hasObj = !!obj?.label?.trim();
          return (
            <div
              key={i}
              className="flex flex-wrap items-baseline gap-x-1.5"
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
