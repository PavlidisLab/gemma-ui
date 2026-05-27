/**
 * Loaded ontologies panel. One row per OntologyService bean; status
 * is loaded / initializing / disabled. `termCount` is off by default
 * (walking the model on every request); curator can flip a toggle
 * to include it.
 */

import { useState } from "react";
import { useOntologies, useRefreshOntology, useRebuildOntologySlim } from "../api";
import { SectionCard } from "../components/SectionCard";
import { HealthDot } from "../components/HealthDot";
import { ConfirmButton } from "../components/ConfirmButton";
import { fmtNumber } from "../timeseries";

export function OntologiesSection() {
  const [includeTerms, setIncludeTerms] = useState(false);
  const { data, isError, error, isFetching } = useOntologies({
    includeTermCount: includeTerms,
    refetchMs: 30_000,
  });
  const refresh = useRefreshOntology();
  const rebuildSlim = useRebuildOntologySlim();
  const ontologies = data?.ontologies ?? [];

  // Track which row's action is in flight so we can disable just that button
  // while the mutation runs (the hook itself is a singleton; isPending toggles
  // for the whole list otherwise).
  const inflight =
    refresh.isPending || rebuildSlim.isPending
      ? (refresh.variables ?? rebuildSlim.variables ?? null)
      : null;

  return (
    <SectionCard
      title="Ontologies"
      summary={
        data
          ? `${data.loadedCount ?? 0} loaded · ${data.initializingCount ?? 0} initializing · ${Math.max(0, (data.count ?? 0) - (data.enabledCount ?? 0))} disabled`
          : undefined
      }
      accessory={
        <label
          className="inline-flex items-center gap-1.5 text-[11px] cursor-pointer text-slate-600 dark:text-slate-300"
          title="walks each ontology's in-memory model on every request — only enable for spot checks"
        >
          <input
            type="checkbox"
            className="rounded border-slate-300"
            checked={includeTerms}
            onChange={(e) => setIncludeTerms(e.target.checked)}
          />
          term counts {isFetching && includeTerms ? "(loading…)" : ""}
        </label>
      }
    >
      {isError ? (
        <div className="text-[11px] text-rose-700 dark:text-rose-300">
          {(error as Error).message}
        </div>
      ) : !data ? (
        <div className="text-xs text-slate-500 italic">loading…</div>
      ) : (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-[11px]">
            <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 sticky top-0">
              <tr>
                <th className="text-left px-2 py-1 font-medium">ontology</th>
                <th className="text-left px-2 py-1 font-medium">state</th>
                <th className="text-left px-2 py-1 font-medium">inference</th>
                <th className="text-left px-2 py-1 font-medium">search</th>
                {includeTerms ? (
                  <th className="text-right px-2 py-1 font-medium">terms</th>
                ) : null}
                <th className="text-right px-2 py-1 font-medium">actions</th>
              </tr>
            </thead>
            <tbody>
              {ontologies.map((o) => {
                const state = !o.enabled
                  ? "disabled"
                  : o.error
                    ? "error"
                    : o.loaded
                      ? "loaded"
                      : o.initializing
                        ? "initializing"
                        : "not loaded";
                const tone =
                  state === "loaded"
                    ? "UP"
                    : state === "initializing"
                      ? "WARN"
                      : state === "error"
                        ? "DOWN"
                        : "UNKNOWN";
                return (
                  <tr
                    key={o.className}
                    className="border-t border-slate-100 dark:border-slate-700"
                    title={o.description ?? o.className}
                  >
                    <td className="px-2 py-1">
                      <span className="font-medium">{o.name ?? o.className}</span>
                    </td>
                    <td className="px-2 py-1">
                      <HealthDot status={tone as "UP" | "WARN" | "DOWN" | "UNKNOWN"} withLabel label={state} />
                    </td>
                    <td className="px-2 py-1 text-slate-500 dark:text-slate-400 font-mono">
                      {o.inferenceMode ?? "—"}
                    </td>
                    <td className="px-2 py-1">
                      {o.searchEnabled ? "✓" : "—"}
                    </td>
                    {includeTerms ? (
                      <td className="px-2 py-1 text-right tabular-nums">
                        {o.termCount != null ? fmtNumber(o.termCount) : "—"}
                      </td>
                    ) : null}
                    <td className="px-2 py-1 text-right whitespace-nowrap">
                      <span className="inline-flex gap-1 justify-end">
                        <ConfirmButton
                          label="refresh"
                          confirmLabel="hot-refresh"
                          tone="default"
                          disabled={!o.enabled || inflight === o.className}
                          onConfirm={() => refresh.mutate(o.className)}
                          title="POST /admin/ontologies/{name}/refresh — re-fetch source + re-init in place. Cheap for -base / slim caches; multi-minute for full sources."
                        />
                        {o.slimmable ? (
                          <ConfirmButton
                            label="rebuild slim"
                            confirmLabel="rebuild slim cache"
                            tone="danger"
                            disabled={!o.loaded || inflight === o.className}
                            onConfirm={() => rebuildSlim.mutate(o.className)}
                            title="POST /admin/ontologies/{name}/rebuild-slim — STAR-extract a corpus-tailored slim from the cached source. Background; OWL-API holds the full source in heap during extraction (memory pressure on the container)."
                          />
                        ) : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
