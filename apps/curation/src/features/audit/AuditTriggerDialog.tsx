import { useState } from "react";
import { cn } from "@/lib/cn";
import type { AuditRequest, AuditScopeItem } from "@/api/auditTypes";

/**
 * Modal that gathers `AuditRequest` parameters before kicking off a
 * `POST /audit/{accession}/stream` run.
 *
 * Defaults match the agent-side defaults documented in
 * `AUDIT_FEATURE.md` §POST /audit/{accession}: every scope on,
 * tier `standard`, comparison proposer on, cache on, refresh-cache
 * off. Curator can opt out of any of these.
 *
 * Emit-on-submit shape: a fully-built `AuditRequest`. The caller
 * (sidebar) owns the actual stream-start; this component just
 * collects parameters and triggers the callback.
 */
export function AuditTriggerDialog({
  experimentShortName,
  open,
  busy,
  onCancel,
  onSubmit,
}: {
  experimentShortName: string;
  open: boolean;
  /** True while the trigger POST is in flight. Disables Submit. */
  busy: boolean;
  onCancel: () => void;
  onSubmit: (req: AuditRequest) => void;
}) {
  const [scope, setScope] = useState<Set<AuditScopeItem>>(
    () => new Set(["factors", "fvs", "tags", "assignments"]),
  );
  const [tier, setTier] = useState<"fast" | "standard" | "strong">(
    "standard",
  );
  const [withComparison, setWithComparison] = useState(true);
  const [refreshCache, setRefreshCache] = useState(false);

  if (!open) return null;

  const scopeArray = Array.from(scope);
  const submittable = scopeArray.length > 0 && !busy;

  function toggle(item: AuditScopeItem) {
    setScope((prev) => {
      const next = new Set(prev);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return next;
    });
  }

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded shadow-lg w-full max-w-md p-4 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Audit{" "}
            <span className="font-mono">{experimentShortName}</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Runs the audit judges against the existing curation.
            Findings land in the per-experiment sidebar; the report
            is also linkable from the audits inbox.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Scope
          </label>
          <div className="flex flex-wrap gap-2">
            <ScopeCheckbox
              label="factors"
              checked={scope.has("factors")}
              onChange={() => toggle("factors")}
            />
            <ScopeCheckbox
              label="FVs"
              checked={scope.has("fvs")}
              onChange={() => toggle("fvs")}
            />
            <ScopeCheckbox
              label="tags"
              checked={scope.has("tags")}
              onChange={() => toggle("tags")}
            />
            <ScopeCheckbox
              label="assignments"
              checked={scope.has("assignments")}
              onChange={() => toggle("assignments")}
            />
          </div>
          {scope.size === 0 ? (
            <p className="text-[11px] text-rose-700 mt-1">
              Pick at least one scope item — the server rejects an
              empty scope (400).
            </p>
          ) : null}
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Model tier
          </label>
          <div className="flex gap-1">
            <TierButton
              value="fast"
              current={tier}
              onChange={setTier}
              hint="Haiku — cheap, sometimes terse"
            />
            <TierButton
              value="standard"
              current={tier}
              onChange={setTier}
              hint="Sonnet — default; good balance"
            />
            <TierButton
              value="strong"
              current={tier}
              onChange={setTier}
              hint="Opus — slow, most thorough"
            />
          </div>
        </div>

        <div className="space-y-1.5 pt-1 border-t border-slate-100">
          <label
            className="flex items-center gap-2 text-xs cursor-pointer"
            title="Run the silent comparison proposer alongside the judges so `proposer_suggestion` populates on findings. Off = deterministic checks only (cheaper, less informative)."
          >
            <input
              type="checkbox"
              className="rounded border-slate-300"
              checked={withComparison}
              onChange={(e) => setWithComparison(e.target.checked)}
            />
            <span>
              Run comparison proposer{" "}
              <span className="text-slate-400">(populates suggestions)</span>
            </span>
          </label>
          <label
            className="flex items-center gap-2 text-xs cursor-pointer"
            title="When on, ignore any cached audit and force a fresh judge pass. Off (default) = use cached result if available."
          >
            <input
              type="checkbox"
              className="rounded border-slate-300"
              checked={refreshCache}
              onChange={(e) => setRefreshCache(e.target.checked)}
            />
            <span>
              Refresh cache{" "}
              <span className="text-slate-400">(force fresh LLM pass)</span>
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs px-3 py-1 rounded text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!submittable}
            onClick={() => {
              onSubmit({
                tier,
                scope: scopeArray,
                with_comparison: withComparison,
                use_cache: true,
                refresh_cache: refreshCache,
              });
            }}
            className={cn(
              "text-xs px-3 py-1 rounded font-medium",
              submittable
                ? "bg-blue-700 text-white hover:bg-blue-800"
                : "bg-slate-200 text-slate-500 cursor-not-allowed",
            )}
          >
            {busy ? "starting…" : "Run audit"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ScopeCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={cn(
        "inline-flex items-center gap-1 text-xs px-2 py-1 rounded border cursor-pointer",
        checked
          ? "bg-blue-50 border-blue-300 text-blue-900"
          : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50",
      )}
    >
      <input
        type="checkbox"
        className="rounded border-slate-300"
        checked={checked}
        onChange={onChange}
      />
      <span>{label}</span>
    </label>
  );
}

function TierButton({
  value,
  current,
  onChange,
  hint,
}: {
  value: "fast" | "standard" | "strong";
  current: "fast" | "standard" | "strong";
  onChange: (v: "fast" | "standard" | "strong") => void;
  hint: string;
}) {
  const active = value === current;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      title={hint}
      className={cn(
        "text-xs px-2 py-1 rounded border",
        active
          ? "bg-slate-800 text-white border-slate-800"
          : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50",
      )}
    >
      {value}
    </button>
  );
}
