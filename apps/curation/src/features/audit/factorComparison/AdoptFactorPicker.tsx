/**
 * "Choose what to adopt" — the body of the partial-adoption dialog.
 *
 * Renders one tickable row per part of ``FactorAdoptPlan`` (category,
 * grouping, then per-level label + statements) so the curator can take
 * the parts of an agent's factor that are right and leave the parts
 * that aren't. Before this, the only affordances on a factor finding
 * were whole-factor: adopt everything or keep everything.
 *
 * Not a new modal — it renders inside the shared ``ConfirmModal``
 * (widened to accept a node body). Terms and statements go through the
 * canonical ``Term`` / ``StatementSequence`` primitives, so the chips
 * here match the comparison grid the curator just read; the
 * current-vs-proposed column order (current LEFT, proposed RIGHT) is
 * the one the comparison surfaces already use.
 *
 * All decision logic lives in ``adoptFactorPlan.ts``; this file only
 * displays it and toggles booleans.
 */
import { Term } from "@/components/ui/Term";
import { StatementSequence } from "@/components/ui/StatementSequence";
import type { Statement } from "@/features/experiment/types";
import type { StatementProposal } from "@/api/types";
import {
  adoptCoverage,
  isPickOptional,
  type AdoptFvPair,
  type FactorAdoptPlan,
} from "./adoptFactorPlan";

/** Compact sample-count badge, matching the comparison grid's ``(n)``. */
function Count({ n }: { n: number }) {
  return (
    <span className="tabular-nums text-[10px] text-slate-500 dark:text-slate-400">
      ({n})
    </span>
  );
}

function StatementLines({
  statements,
}: {
  statements: readonly (Statement | StatementProposal)[];
}) {
  if (statements.length === 0) {
    return (
      <span className="italic text-slate-400 dark:text-slate-500">
        (no statement)
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-0.5">
      {statements.map((st, i) => (
        <StatementSequence
          key={i}
          subject={st.subject ?? { label: "", uri: null }}
          pairs={[{ predicate: st.predicate, object: st.object }]}
          asLink={false}
          separator="·"
          separatorClassName="mx-1 text-slate-400 dark:text-slate-500"
          predicateClassName="italic text-slate-500 dark:text-slate-400"
        />
      ))}
    </span>
  );
}

/** One tickable part: checkbox, what it says now, what it becomes. */
function PartRow({
  checked,
  onChange,
  disabled,
  label,
  current,
  proposed,
  note,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
  current: React.ReactNode;
  proposed: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <label
      className={`flex gap-2 px-2 py-1.5 rounded ${
        disabled
          ? "opacity-60"
          : "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40"
      }`}
    >
      <input
        type="checkbox"
        className="mt-1 shrink-0"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
          {label}
        </span>
        <span className="mt-0.5 grid grid-cols-[1fr_auto_1fr] items-start gap-1.5 text-[12px]">
          <span className="min-w-0">{current}</span>
          <span className="text-slate-400 dark:text-slate-500">→</span>
          <span className="min-w-0">{proposed}</span>
        </span>
        {note ? (
          <span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">
            {note}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function LevelBlock({
  pair,
  plan,
  onToggle,
}: {
  pair: AdoptFvPair;
  plan: FactorAdoptPlan;
  onToggle: (next: FactorAdoptPlan) => void;
}) {
  const optional = isPickOptional(pair);
  // A level with only one side present is governed entirely by the
  // grouping pick — there is nothing to choose within it, so say what
  // happens to it rather than offering a dead checkbox.
  const agentOnly = pair.currentFvId === null;
  const currentOnly = pair.agentFvIndex === null;

  const setLabelPick = (v: boolean) =>
    onToggle({
      ...plan,
      picks: { ...plan.picks, fvLabel: { ...plan.picks.fvLabel, [pair.key]: v } },
    });
  const setStatementPick = (v: boolean) =>
    onToggle({
      ...plan,
      picks: {
        ...plan.picks,
        fvStatements: { ...plan.picks.fvStatements, [pair.key]: v },
      },
    });

  const heading = (
    <div className="flex flex-wrap items-baseline gap-1.5 px-2 pt-1.5 text-[12px]">
      <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
        Value
      </span>
      {currentOnly ? (
        <>
          <span className="font-mono text-slate-800 dark:text-slate-100">
            {pair.currentLabel || "(unnamed)"}
          </span>
          <Count n={pair.currentSamples.length} />
        </>
      ) : (
        <>
          <span className="font-mono text-slate-800 dark:text-slate-100">
            {pair.agentLabel || "(unnamed)"}
          </span>
          <Count n={pair.agentSamples.length} />
        </>
      )}
    </div>
  );

  if (currentOnly) {
    return (
      <div className="rounded border border-slate-200 dark:border-slate-700">
        {heading}
        <div className="px-2 pb-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          {plan.picks.partition
            ? "Dropped by the proposed grouping — its samples move to the values above."
            : "Kept as-is (the grouping is not being adopted)."}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded border border-slate-200 dark:border-slate-700">
      {heading}
      {agentOnly ? (
        <div className="px-2 pb-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          {plan.picks.partition
            ? "New value — arrives with the proposed grouping, with its label and statements."
            : "Only in the proposal. Adopt the grouping to bring it in."}
        </div>
      ) : (
        <div className="pb-1">
          {pair.labelDiffers ? (
            <PartRow
              label="Label"
              checked={!!plan.picks.fvLabel[pair.key]}
              disabled={!optional}
              onChange={setLabelPick}
              current={
                <span className="font-mono break-words text-slate-700 dark:text-slate-200">
                  {pair.currentLabel || "(unnamed)"}
                </span>
              }
              proposed={
                <span className="font-mono break-words text-slate-700 dark:text-slate-200">
                  {pair.agentLabel || "(unnamed)"}
                </span>
              }
            />
          ) : null}
          {pair.statementsDiffer ? (
            <PartRow
              label="Statement"
              checked={!!plan.picks.fvStatements[pair.key]}
              disabled={!optional}
              onChange={setStatementPick}
              current={<StatementLines statements={pair.currentStatements} />}
              proposed={<StatementLines statements={pair.agentStatements} />}
            />
          ) : null}
          {!pair.labelDiffers && !pair.statementsDiffer ? (
            <div className="px-2 pb-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              Label and statements already agree.
              {pair.samplesDiffer
                ? " Only its samples differ — that is the grouping pick above."
                : ""}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function AdoptFactorPicker({
  plan,
  onChange,
  proposerLabel,
}: {
  plan: FactorAdoptPlan;
  onChange: (next: FactorAdoptPlan) => void;
  /** Who proposed it — "Auditor" / "cyan" / whatever the identity
   *  resolver gave the calling card. Keeps the dialog's wording
   *  identity-first, like the rest of the audit surfaces. */
  proposerLabel: string;
}) {
  const coverage = adoptCoverage(plan);
  const currentLevels = plan.pairs.filter((p) => p.currentFvId !== null).length;
  const proposedLevels = plan.pairs.filter(
    (p) => p.agentFvIndex !== null,
  ).length;

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-slate-600 dark:text-slate-300">
        Tick the parts of {proposerLabel}'s factor to take. Everything
        unticked stays exactly as the design has it now.
      </p>

      <div className="grid grid-cols-[1fr_auto_1fr] gap-1.5 px-2 text-[10px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">
        <span>Currently</span>
        <span />
        <span>{proposerLabel} proposes</span>
      </div>

      {plan.categoryDiffers ? (
        <div className="rounded border border-slate-200 dark:border-slate-700">
          <PartRow
            label="Category"
            checked={plan.picks.category}
            onChange={(v) =>
              onChange({ ...plan, picks: { ...plan.picks, category: v } })
            }
            current={
              <Term uri={plan.categoryFrom.uri ?? null} asLink={false} size="sm">
                {plan.categoryFrom.label || "(none)"}
              </Term>
            }
            proposed={
              <Term uri={plan.categoryTo.uri ?? null} asLink={false} size="sm">
                {plan.categoryTo.label || "(none)"}
              </Term>
            }
            note={
              plan.nameTo && plan.nameTo !== plan.categoryTo.label
                ? `Factor name becomes "${plan.nameTo}".`
                : undefined
            }
          />
        </div>
      ) : null}

      {plan.partitionDiffers ? (
        <div className="rounded border border-slate-200 dark:border-slate-700">
          <PartRow
            label="Grouping (which samples sit in which value)"
            checked={plan.picks.partition}
            onChange={(v) =>
              onChange({ ...plan, picks: { ...plan.picks, partition: v } })
            }
            current={
              <span className="text-slate-700 dark:text-slate-200">
                {currentLevels} value{currentLevels === 1 ? "" : "s"}
              </span>
            }
            proposed={
              <span className="text-slate-700 dark:text-slate-200">
                {proposedLevels} value{proposedLevels === 1 ? "" : "s"}
              </span>
            }
            note={
              <>
                {coverage.moved.length > 0 ? (
                  <span className="block">
                    {coverage.moved.length} sample
                    {coverage.moved.length === 1 ? "" : "s"} change value:{" "}
                    <span className="font-mono">
                      {coverage.moved.slice(0, 8).join(", ")}
                      {coverage.moved.length > 8 ? " …" : ""}
                    </span>
                  </span>
                ) : null}
                {coverage.dropped.length > 0 ? (
                  <span className="block text-amber-700 dark:text-amber-400">
                    ⚠ {coverage.dropped.length} sample
                    {coverage.dropped.length === 1 ? "" : "s"} would be left
                    with no value on this factor:{" "}
                    <span className="font-mono">
                      {coverage.dropped.slice(0, 8).join(", ")}
                      {coverage.dropped.length > 8 ? " …" : ""}
                    </span>
                    . You'd have to place {coverage.dropped.length === 1 ? "it" : "them"}{" "}
                    by hand in the Design tab.
                  </span>
                ) : null}
              </>
            }
          />
        </div>
      ) : null}

      <div className="space-y-1.5">
        {plan.pairs.map((p) => (
          <LevelBlock key={p.key} pair={p} plan={plan} onToggle={onChange} />
        ))}
      </div>
    </div>
  );
}
