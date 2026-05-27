/**
 * Hibernate Search indices panel — per-@Indexed entity, with doc
 * counts and on-disk mtime. Per-row + section-level reindex actions
 * mirror IndexGemmaCLI's surface so admins can rebuild without
 * shelling into the container.
 */

import { useSearchIndices, useReindexSearch } from "../api";
import { SectionCard } from "../components/SectionCard";
import { ConfirmButton } from "../components/ConfirmButton";
import { fmtNumber, fmtRelative } from "../timeseries";

export function IndicesSection() {
  const { data, isError, error } = useSearchIndices(60_000);
  const reindex = useReindexSearch();
  const indices = data?.indices ?? [];
  const inflight = reindex.isPending ? (reindex.variables ?? "(all)") : null;
  return (
    <SectionCard
      title="Search indices"
      summary={
        data
          ? `${indices.length} indices · ${fmtNumber(data.totalDocumentCount ?? 0)} docs${
              data.totalDocumentCountExact === false ? " (approx)" : ""
            }`
          : undefined
      }
      accessory={
        <ConfirmButton
          label="reindex all"
          confirmLabel="reindex every entity"
          tone="danger"
          disabled={reindex.isPending || !data}
          onConfirm={() => reindex.mutate(null)}
          title="POST /admin/search/indices — sequential mass reindex of every @Indexed root. Destructive (rewrites on-disk Lucene); search results may be stale until each entity finishes."
        />
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
                <th className="text-left px-2 py-1 font-medium">entity</th>
                <th className="text-right px-2 py-1 font-medium">documents</th>
                <th className="text-left px-2 py-1 font-medium">last modified</th>
                <th className="text-right px-2 py-1 font-medium">actions</th>
              </tr>
            </thead>
            <tbody>
              {indices.map((idx) => (
                <tr
                  key={idx.indexName}
                  className="border-t border-slate-100 dark:border-slate-700"
                  title={idx.indexPath ?? ""}
                >
                  <td className="px-2 py-1">
                    <span className="font-medium">{idx.entityName}</span>
                    {idx.exists === false ? (
                      <span className="ml-1 text-[10px] text-rose-700 dark:text-rose-300">
                        missing
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {idx.documentCount < 0
                      ? "—"
                      : fmtNumber(idx.documentCount)}
                    {idx.error ? (
                      <span
                        className="ml-1 text-rose-700 dark:text-rose-300"
                        title={idx.error}
                      >
                        ⚠
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-1 text-slate-500 dark:text-slate-400">
                    {fmtRelative(idx.lastModified)}
                  </td>
                  <td className="px-2 py-1 text-right whitespace-nowrap">
                    <ConfirmButton
                      label="reindex"
                      confirmLabel="reindex this entity"
                      tone="danger"
                      disabled={reindex.isPending || inflight === idx.entityName}
                      onConfirm={() => reindex.mutate(idx.entityName)}
                      title={`POST /admin/search/indices?entity=${idx.entityName} — rebuild on-disk Lucene for this entity only.`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data?.indexBase ? (
        <div className="mt-2 text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate">
          {data.indexBase}
        </div>
      ) : null}
    </SectionCard>
  );
}
