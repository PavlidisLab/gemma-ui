/**
 * "Proposer details" popup.
 *
 * Surfaces the run provenance baked into a proposal at build time
 * (agents-side ``build_calibration_batch`` → ``RunProvenance.run_meta``)
 * so a curator reviewing a proposal can see EXACTLY what produced it —
 * which model(s), which switches (boss-critic? actions? debate?
 * subagents? rounds?), the git sha/branch, and the full invocation —
 * without hunting through sidecar files. Per Paul: "that data has to be
 * baked into the proposal json always."
 *
 * Modal shell mirrors ``JsonViewer`` (portal + overlay + Escape close)
 * so it stays visually consistent with the "{ } raw" affordance next to
 * which its trigger sits — and reuses the same ``react-dom`` portal, no
 * new dep. Reads defensively off ``run_meta`` (the full pass-through)
 * with a fallback to the flat provenance fields; every section renders
 * only when it has content, so a sparse provenance block degrades to a
 * short panel instead of a wall of blanks.
 */
import { createPortal } from "react-dom";
import { useEffect } from "react";
import { cn } from "@/lib/cn";
import type { RunProvenance } from "@/api/auditTypes";

export interface ProposerDetailsDialogProps {
  open: boolean;
  onClose: () => void;
  provenance: RunProvenance | null | undefined;
}

/** True when there's anything worth showing. Drives whether the
 *  trigger chip renders at all (callers check this) and guards the
 *  dialog body. */
export function hasProposerDetails(
  provenance: RunProvenance | null | undefined,
): boolean {
  if (!provenance) return false;
  const rm = provenance.run_meta;
  const hasMeta = !!rm && typeof rm === "object" && Object.keys(rm).length > 0;
  const hasFlat = !!(
    provenance.run_id ||
    provenance.run_sha ||
    provenance.model ||
    provenance.batch_id
  );
  return hasMeta || hasFlat;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function asBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  return null;
}

/** on/off switch chip. Renders emerald when on, muted slate when off. */
function SwitchChip({ label, on }: { label: string; on: boolean | null }) {
  if (on === null) return null;
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border",
        on
          ? "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-300"
          : "bg-slate-50 border-slate-200 text-slate-500 dark:bg-slate-800/50 dark:border-slate-700 dark:text-slate-400",
      )}
      title={`${label}: ${on ? "on" : "off"}`}
    >
      <span className="opacity-70">{on ? "✓" : "–"}</span>
      {label}
    </span>
  );
}

/** A labelled value row in a details section. Renders nothing when the
 *  value is blank so a sparse provenance block stays compact. */
function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 w-24 shrink-0">
        {label}
      </span>
      <span className="text-[11px] text-slate-800 dark:text-slate-100 font-mono break-all">
        {value}
      </span>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 pb-0.5">
        {title}
      </div>
      {children}
    </div>
  );
}

export function ProposerDetailsDialog({
  open,
  onClose,
  provenance,
}: ProposerDetailsDialogProps) {
  // Escape close — mirrors JsonViewer.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // ``run_meta`` is the full pass-through; fall back to flat fields when
  // it's absent (older rows carried only the chip subset).
  const rm: Record<string, unknown> =
    provenance?.run_meta && typeof provenance.run_meta === "object"
      ? provenance.run_meta
      : {};
  const git =
    rm.git_provenance && typeof rm.git_provenance === "object"
      ? (rm.git_provenance as Record<string, unknown>)
      : {};
  const abl =
    rm.ablations && typeof rm.ablations === "object"
      ? (rm.ablations as Record<string, unknown>)
      : {};

  const proposerModel = str(rm.model) || str(provenance?.model);
  const designModel = str(rm.design_model);
  const bossModel = str(rm.debate_arbiter_model);

  const runId = str(rm.run_id) || str(provenance?.run_id);
  const createdAt = str(rm.created_at) || str(provenance?.ran_at);
  const shortSha =
    str(git.head_sha_short) || str(provenance?.run_sha);
  const branch = str(git.branch);
  const dirty = asBool(git.dirty) ?? provenance?.git_dirty ?? null;
  const invocation = str(rm.invocation);

  const roundsVal =
    typeof rm.rounds === "number" ? (rm.rounds as number) : null;

  const nothing = !hasProposerDetails(provenance);

  function copyInvocation() {
    try {
      navigator.clipboard?.writeText(invocation);
    } catch {
      // best effort
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 p-4 sm:p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md shadow-2xl flex flex-col max-w-2xl w-full max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700">
          <span className="font-semibold text-slate-800 dark:text-slate-100 text-sm">
            Proposer details
          </span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
            what produced this proposal
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-lg leading-none px-1"
            aria-label="close"
            title="close (Esc)"
          >
            &times;
          </button>
        </div>

        <div className="flex-1 overflow-auto p-3 space-y-4">
          {nothing ? (
            <div className="text-[12px] text-slate-500 dark:text-slate-400 italic">
              Provenance details are unavailable for this proposal — it
              predates run-provenance capture.
            </div>
          ) : (
            <>
              {/* Models */}
              {proposerModel || designModel || bossModel ? (
                <Section title="Models">
                  <Row label="proposer" value={proposerModel} />
                  <Row label="design" value={designModel} />
                  <Row label="boss / arbiter" value={bossModel} />
                </Section>
              ) : null}

              {/* Switches — on/off chips. Only render chips whose
                  underlying value is a real boolean; ints (rounds)
                  render as a labelled pill. */}
              <Section title="Switches">
                <div className="flex flex-wrap gap-1.5">
                  <SwitchChip label="boss-critic" on={asBool(rm.boss_critic)} />
                  <SwitchChip label="boss-actions" on={asBool(rm.boss_actions)} />
                  <SwitchChip label="debate" on={asBool(rm.debate)} />
                  <SwitchChip
                    label="debate-design"
                    on={asBool(rm.debate_design)}
                  />
                  <SwitchChip label="subagents" on={asBool(rm.subagents)} />
                  <SwitchChip label="with-design" on={asBool(rm.with_design)} />
                  <SwitchChip label="paper" on={asBool(abl.paper)} />
                  <SwitchChip label="priors" on={asBool(abl.priors)} />
                  <SwitchChip label="embedding" on={asBool(abl.embedding)} />
                  <SwitchChip label="tier2" on={asBool(abl.tier2)} />
                  <SwitchChip
                    label="standards-bag"
                    on={asBool(abl.inject_standards_bag)}
                  />
                  {roundsVal !== null ? (
                    <span
                      className="inline-flex items-baseline gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border bg-sky-50 border-sky-200 text-sky-700 dark:bg-sky-900/30 dark:border-sky-700 dark:text-sky-300"
                      title={`rounds: ${roundsVal}`}
                    >
                      rounds={roundsVal}
                    </span>
                  ) : null}
                </div>
              </Section>

              {/* Git */}
              {shortSha || branch ? (
                <Section title="Git">
                  <Row label="sha" value={shortSha} />
                  <Row label="branch" value={branch} />
                  {dirty !== null ? (
                    <Row
                      label="tree"
                      value={dirty ? "dirty (uncommitted)" : "clean"}
                    />
                  ) : null}
                </Section>
              ) : null}

              {/* Run */}
              {runId || createdAt || str(provenance?.batch_id) ? (
                <Section title="Run">
                  <Row label="run id" value={runId} />
                  <Row label="created" value={createdAt} />
                  <Row label="batch" value={str(provenance?.batch_id)} />
                  <Row
                    label="mode"
                    value={[str(rm.mode), str(rm.orchestrator_version)]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                  <Row
                    label="n GSEs"
                    value={
                      typeof rm.n_gses === "number" ? String(rm.n_gses) : ""
                    }
                  />
                </Section>
              ) : null}

              {/* Invocation */}
              {invocation ? (
                <Section title="Invocation">
                  <div className="relative">
                    <pre className="text-[10px] font-mono whitespace-pre-wrap break-all bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded p-2 pr-14 text-slate-800 dark:text-slate-100">
                      {invocation}
                    </pre>
                    <button
                      type="button"
                      onClick={copyInvocation}
                      className="absolute top-1.5 right-1.5 text-[10px] px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700"
                      title="copy the invocation to clipboard"
                    >
                      copy
                    </button>
                  </div>
                </Section>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
