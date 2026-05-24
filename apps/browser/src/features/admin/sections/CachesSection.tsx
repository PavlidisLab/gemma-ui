/**
 * Cache panel — alphabetical list with per-cache `[clear]` plus
 * `[clear all]` accessory. Per-cache hit/miss stats are NOT
 * available in the current build (post-EhCache-2; would need a
 * Caffeine recordStats() adapter), so we just show the names.
 *
 * Filter input lets a curator narrow down a long list (Gemma
 * carries ~50 caches in production).
 */

import { useMemo, useState } from "react";
import {
  useCacheList,
  useClearAllCaches,
  useClearCache,
} from "../api";
import { SectionCard } from "../components/SectionCard";
import { ConfirmButton } from "../components/ConfirmButton";

export function CachesSection() {
  const list = useCacheList();
  const clearAll = useClearAllCaches();
  const clearOne = useClearCache();
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!list.data) return [];
    if (!q) return list.data.names;
    return list.data.names.filter((n) => n.toLowerCase().includes(q));
  }, [filter, list.data]);

  return (
    <SectionCard
      title="Caches"
      summary={list.data ? `${list.data.count} cache${list.data.count === 1 ? "" : "s"}` : undefined}
      accessory={
        <ConfirmButton
          label="clear all"
          confirmLabel="clear every cache"
          tone="danger"
          disabled={clearAll.isPending || !list.data}
          onConfirm={() => clearAll.mutate()}
          title="DELETE /admin/caches — clears every named cache. Not a free op; warm-up will hit the DB hard for a while."
        />
      }
    >
      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="filter caches…"
        className="w-full text-xs border border-slate-300 dark:border-slate-600 dark:bg-slate-900 rounded px-2 py-1 mb-2"
      />
      {list.isError ? (
        <div className="text-[11px] text-rose-700 dark:text-rose-300">
          {(list.error as Error).message}
        </div>
      ) : !list.data ? (
        <div className="text-xs text-slate-500 italic">loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-xs text-slate-500 italic">no matches</div>
      ) : (
        <ul className="max-h-72 overflow-auto divide-y divide-slate-100 dark:divide-slate-700 text-xs">
          {filtered.map((name) => (
            <li
              key={name}
              className="flex items-center justify-between py-1"
            >
              <span className="font-mono truncate" title={name}>
                {name}
              </span>
              <ConfirmButton
                label="clear"
                confirmLabel="clear"
                disabled={clearOne.isPending}
                onConfirm={() => clearOne.mutate(name)}
                title={`DELETE /admin/caches/${name}`}
              />
            </li>
          ))}
        </ul>
      )}
      {(clearAll.isError || clearOne.isError) ? (
        <div className="mt-2 text-[11px] text-rose-700 dark:text-rose-300">
          {((clearAll.error || clearOne.error) as Error).message}
        </div>
      ) : null}
    </SectionCard>
  );
}
