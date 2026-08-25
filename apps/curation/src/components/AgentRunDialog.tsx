/**
 * Confirmation dialog for the two agent runs a curator can trigger:
 * building a proposal (``/propose``) and running an audit (``/audit``).
 *
 * The dialog picks WHICH run happens and a small set of options; the
 * agent supplies every default it doesn't hear about. Toggles were
 * removed 2026-08-03 for no longer matching the agent's configuration —
 * this is the later pass that reintroduces the ones that do, chosen
 * against the live ``GET /propose/schema`` and ``GET /audit/schema``.
 *
 * **The two runs.** *Audit* judges the curation that is already there.
 * *Blind proposal* strips it first (``fresh_preboarding``) so the
 * proposer works from the sample data alone — which is what you want on
 * an uncurated experiment, and what you want when the question is how
 * good the proposer is. The agent's own design gate hard-drops a
 * proposal over existing curated factors, so a proposal is blind or it
 * is nothing; naming it says out loud what was already happening.
 *
 * Which one leads is decided by whether curated factors exist, matching
 * the gate's own ``preboarding_has_existing_factors`` test rather than a
 * second UI-side idea of "curated". The curator can always override.
 *
 *   - **mode=fresh** — no standing run.
 *   - **mode=redo**  — a standing proposal/audit exists; the submit label
 *                      reads "Re-run …".
 *
 * Submit is disabled when the agent service is unreachable; the dialog
 * explains why so the curator doesn't think the button is broken.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { ServiceStatus } from "@/api/health";
import { useAgentConfig, type AgentConfig } from "@/api/agentConfig";
import type { AuditScopeItem } from "@/api/auditTypes";

export type AgentRunKind = "proposal" | "audit";
export type AgentRunMode = "fresh" | "redo";
export type AgentRunTier = "fast" | "standard" | "strong";

/** What the curator chose. Every option is optional and an omitted one
 *  means "whatever the agent defaults to" — the dialog never restates a
 *  default as if it were a choice, so a change on the agent side reaches
 *  the run without a UI edit. */
export interface AgentRunRequest {
  kind: AgentRunKind;
  mode: AgentRunMode;
  /** Omitted = the agent's configured tier. */
  tier?: AgentRunTier;
  /** Ignore a cached run and re-burn the LLM. */
  refresh_cache?: boolean;
  /** Blind proposal only — run the proposer with no publication at all. */
  withhold_publication?: boolean;
  /** Audit only. Omitted = the full Phase 1 set. NEVER an empty array:
   *  the server 400s on one, so "nothing ticked" has to mean "omit". */
  scope?: AuditScopeItem[];
}

/** The four the audit's ``scope`` accepts, in the order they run.
 *  ``AuditScopeItem`` is the app's existing spelling of this set. */
export const AUDIT_SCOPE_ITEMS: readonly AuditScopeItem[] = [
  "factors",
  "fvs",
  "tags",
  "assignments",
];

/** Which run leads for an experiment.
 *
 *  Keyed on curated FACTORS, not tags — that is what the agent's design
 *  gate tests (``preboarding_has_existing_factors``), and picking a
 *  different signal here would let the dialog recommend a run the gate
 *  then refuses. Exported for test. */
export function defaultRunKind(hasCuratedFactors: boolean): AgentRunKind {
  return hasCuratedFactors ? "audit" : "proposal";
}

/** The two runs, in the order they are offered. Audit leads because it
 *  is the one that reads what a curator already did. */
const RUN_CHOICES: Array<{
  kind: AgentRunKind;
  label: string;
  blurb: string;
}> = [
  {
    kind: "audit",
    label: "Audit",
    blurb: "Judge the curation already here.",
  },
  {
    kind: "proposal",
    label: "Blind proposal",
    blurb: "Propose from the sample data alone, ignoring any curation.",
  },
];

interface Props {
  open: boolean;
  /** Which run is preselected when the dialog opens. The curator can
   *  switch; this only decides where they start. */
  kind: AgentRunKind;
  mode: AgentRunMode;
  experimentShortName: string;
  /** Whether the experiment already carries curated factors. Drives
   *  which run is marked as the recommended one, and warns when the
   *  curator picks the blind proposal over real curation. */
  hasCuratedFactors: boolean;
  /** Liveness of the agent service. Submit disables when "down". */
  agentStatus: ServiceStatus;
  /** True while the request is in flight. */
  busy: boolean;
  onCancel: () => void;
  onSubmit: (req: AgentRunRequest) => void;
}

export function AgentRunDialog({
  open,
  kind,
  mode,
  experimentShortName,
  hasCuratedFactors,
  agentStatus,
  busy,
  onCancel,
  onSubmit,
}: Props) {
  // Which run, and the options for it. Local so switching between the
  // two is free until the curator commits.
  const [runKind, setRunKind] = useState<AgentRunKind>(kind);
  const [tier, setTier] = useState<AgentRunTier | "">("");
  const [refreshCache, setRefreshCache] = useState(false);
  const [withholdPublication, setWithholdPublication] = useState(false);
  const [scope, setScope] = useState<AuditScopeItem[]>([]);

  // Re-arm on each open: the caller's preselect is recomputed per
  // experiment, and options are per-run choices, not preferences. A
  // withheld publication silently persisting into the next experiment's
  // run would be a measurement quietly applied to real work.
  useEffect(() => {
    if (!open) return;
    setRunKind(kind);
    setTier("");
    setRefreshCache(false);
    setWithholdPublication(false);
    setScope([]);
  }, [open, kind]);
  // Esc closes when not busy. Don't yank the dialog out from under the
  // curator mid-submit.
  useEffect(() => {
    if (!open) return;
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  // The run isn't parameterized from the UI — instead the dialog
  // ANNOUNCES the agent's resolved config (models + options) so the
  // curator confirms the right setup before firing. Null until the
  // agent exposes GET /config; the block just omits itself.
  const { data: agentConfig } = useAgentConfig();

  if (!open) return null;

  const agentDown = agentStatus === "down";
  const isAudit = runKind === "audit";
  const submittable = !busy && !agentDown;
  const recommended = defaultRunKind(hasCuratedFactors);

  const title = isAudit
    ? mode === "redo"
      ? "Re-run audit"
      : "Run audit"
    : mode === "redo"
      ? "Re-run proposer"
      : "Propose annotations";

  const submitLabel = busy
    ? "starting…"
    : mode === "redo"
      ? isAudit
        ? "Re-run audit"
        : "Re-run proposer"
      : isAudit
        ? "Run audit"
        : "Propose";

  const subtitle = isAudit
    ? mode === "redo"
      ? "Replaces the open audit on this experiment. Judges the curation already here; progress appears in the sidebar."
      : "Judges the curation already on this experiment. Findings land in the sidebar; the report is also in the inbox."
    : mode === "redo"
      ? "Retires the standing proposal and starts a fresh blind proposer run."
      : "Runs the proposer from the sample data alone \u2014 existing curation is stripped first, so it never sees it. The proposal lands in the Proposal-review sidebar.";

  // Only the keys the curator can actually move from this dialog, and
  // only when moved. Rendered beside the announced default so the block
  // can never contradict the controls above it.
  const optionOverrides: Record<string, string> = {};
  if (tier) optionOverrides.default_tier = tier;
  if (refreshCache) optionOverrides.use_cache = "ignored (refreshing)";
  if (!isAudit && withholdPublication) {
    optionOverrides.find_pub_if_missing = "off (publication withheld)";
  }

  const toggleScope = (item: AuditScopeItem) =>
    setScope((cur) =>
      cur.includes(item) ? cur.filter((x) => x !== item) : [...cur, item],
    );

  const submit = () =>
    onSubmit({
      kind: runKind,
      mode,
      ...(tier ? { tier } : {}),
      ...(refreshCache ? { refresh_cache: true } : {}),
      ...(!isAudit && withholdPublication
        ? { withhold_publication: true }
        : {}),
      // Nothing ticked means the full default set, NOT an empty scope \u2014
      // the server 400s on `[]`.
      ...(isAudit && scope.length > 0 ? { scope } : {}),
    });

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="bg-white rounded-lg shadow-xl border border-slate-300 dark:border-slate-600 w-full max-w-md p-4 space-y-3 dark:bg-slate-800 dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {title}{" "}
            <span className="font-mono text-slate-700 dark:text-slate-300">
              {experimentShortName}
            </span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {subtitle}
          </p>
        </div>

        {agentDown ? (
          <div className="rounded border border-rose-300 bg-rose-50 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100 dark:border-rose-700 p-2 text-xs">
            <strong>Agent service unreachable.</strong>{" "}
            {isAudit
              ? "Audit runs need the proposer/auditor FastAPI to be up."
              : "Proposal runs need the proposer FastAPI to be up."}{" "}
            Bring it up, then re-open this dialog.
          </div>
        ) : null}

        <fieldset className="space-y-1.5">
          <legend className="text-[10px] uppercase tracking-wide font-semibold text-slate-600 dark:text-slate-300">
            Run
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {RUN_CHOICES.map((c) => {
              const selected = runKind === c.kind;
              return (
                <button
                  key={c.kind}
                  type="button"
                  aria-pressed={selected}
                  disabled={busy}
                  onClick={() => setRunKind(c.kind)}
                  className={cn(
                    "text-left rounded border p-2 disabled:opacity-60",
                    selected
                      ? "border-blue-600 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-500"
                      : "border-slate-200 hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700/50",
                  )}
                >
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xs font-medium text-slate-900 dark:text-slate-100">
                      {c.label}
                    </span>
                    {recommended === c.kind ? (
                      <span className="text-[9px] uppercase tracking-wide text-blue-700 dark:text-blue-300">
                        suggested
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {c.blurb}
                  </p>
                </button>
              );
            })}
          </div>
          {/* Say the consequence at the moment it becomes true, rather
              than letting the curator find out from an empty proposal. */}
          {!isAudit && hasCuratedFactors ? (
            <p className="text-[11px] text-amber-800 dark:text-amber-300">
              This experiment already has curated factors. A blind
              proposal strips them first \u2014 the proposer will not see them,
              and the proposal will not reflect them.
            </p>
          ) : null}
          {isAudit && !hasCuratedFactors ? (
            <p className="text-[11px] text-amber-800 dark:text-amber-300">
              No curated factors here yet, so an audit has little to
              judge. A blind proposal is usually the first step.
            </p>
          ) : null}
        </fieldset>

        <fieldset className="space-y-1.5">
          <legend className="text-[10px] uppercase tracking-wide font-semibold text-slate-600 dark:text-slate-300">
            Options
          </legend>

          <label className="flex items-center gap-2 text-xs">
            <span className="text-slate-600 dark:text-slate-300 w-20">
              Model tier
            </span>
            <select
              value={tier}
              disabled={busy}
              onChange={(e) => setTier(e.target.value as AgentRunTier | "")}
              className="rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-1.5 py-0.5 text-xs"
            >
              {/* Empty sends nothing, so the agent's own tier stands. */}
              <option value="">agent default</option>
              <option value="fast">fast</option>
              <option value="standard">standard</option>
              <option value="strong">strong</option>
            </select>
          </label>

          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={refreshCache}
              disabled={busy}
              onChange={(e) => setRefreshCache(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-slate-700 dark:text-slate-200">
              Refresh cache
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                Ignore a cached run and call the model again.
              </span>
            </span>
          </label>

          {!isAudit ? (
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={withholdPublication}
                disabled={busy}
                onChange={(e) => setWithholdPublication(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-slate-700 dark:text-slate-200">
                Withhold publication
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                  Run with no paper at all \u2014 no linked publication, no
                  lookup. For measuring the proposer, not for curating.
                </span>
              </span>
            </label>
          ) : (
            <div className="text-xs">
              <span className="text-slate-600 dark:text-slate-300">Scope</span>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                {AUDIT_SCOPE_ITEMS.map((item) => (
                  <label key={item} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={scope.includes(item)}
                      disabled={busy}
                      onChange={() => toggleScope(item)}
                    />
                    <span className="text-slate-700 dark:text-slate-200">
                      {item}
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {scope.length === 0
                  ? "Nothing ticked \u2014 audits everything."
                  : `Audits only ${scope.join(", ")}.`}
              </p>
            </div>
          )}
        </fieldset>

        <AgentSettingsBlock
          config={agentConfig ?? null}
          overrides={optionOverrides}
        />

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="text-xs px-3 py-1 rounded text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!submittable}
            onClick={submit}
            className={cn(
              "text-xs px-3 py-1 rounded font-medium",
              submittable
                ? "bg-blue-700 text-white hover:bg-blue-800"
                : "bg-slate-200 text-slate-500 cursor-not-allowed dark:bg-slate-700 dark:text-slate-500",
            )}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Format an option value for display: booleans as on/off, arrays as a
 *  comma list, everything else stringified. */
function formatConfigValue(v: unknown): string {
  if (typeof v === "boolean") return v ? "on" : "off";
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  if (v == null) return "—";
  return String(v);
}

/** Read-only "what the agent will run with" block: per-stage models +
 *  default options. Renders whatever the agent's ``GET /config`` reports
 *  (keys become labels), so a new model stage or switch surfaces without
 *  a UI change. Omits itself entirely when no config is available. */
function AgentSettingsBlock({
  config,
  overrides = {},
}: {
  config: AgentConfig | null;
  /** Option key -> what the curator's choice makes it. An overridden
   *  row shows both, because a block announcing `default_tier standard`
   *  under a control set to `strong` is worse than no block at all. */
  overrides?: Record<string, string>;
}): JSX.Element | null {
  if (!config) return null;
  const models = config.models
    ? Object.entries(config.models).filter(([, v]) => !!v)
    : [];
  const options = config.options
    ? Object.entries(config.options).filter(([, v]) => v != null)
    : [];
  if (models.length === 0 && options.length === 0 && !config.agent_version) {
    return null;
  }
  return (
    <div className="rounded border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40 p-2 text-xs space-y-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-600 dark:text-slate-300">
          Agent defaults
        </span>
        {config.agent_version ? (
          <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500 truncate">
            {config.agent_version}
          </span>
        ) : null}
      </div>
      {models.length > 0 ? (
        <div>
          <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-0.5">
            Models
          </div>
          <dl className="grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5">
            {models.map(([stage, model]) => (
              <div key={stage} className="contents">
                <dt className="text-slate-500 dark:text-slate-400">{stage}</dt>
                <dd className="font-mono text-slate-700 dark:text-slate-200 truncate">
                  {model}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {options.length > 0 ? (
        <div>
          <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-0.5">
            Options
          </div>
          <dl className="grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5">
            {options.map(([key, val]) => {
              const override = overrides[key];
              return (
                <div key={key} className="contents">
                  <dt className="text-slate-500 dark:text-slate-400">{key}</dt>
                  <dd className="text-slate-700 dark:text-slate-200">
                    {override ? (
                      <>
                        <span className="line-through text-slate-400 dark:text-slate-500">
                          {formatConfigValue(val)}
                        </span>{" "}
                        <span className="font-medium text-blue-700 dark:text-blue-300">
                          {override}
                        </span>
                      </>
                    ) : (
                      formatConfigValue(val)
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      ) : null}
    </div>
  );
}
