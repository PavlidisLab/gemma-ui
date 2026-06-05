/**
 * Cache panel — per-cache hits / misses / hit-% / size table, with
 * filter + per-row [clear] and section-level [clear all].
 *
 * Backed by GET /admin/caches which now reads JCache standard MBeans
 * (statisticsEnabled+managementEnabled at config time via
 * EhcacheConfig.buildConfig). Caches without registered MBeans
 * render as "—" placeholders rather than disappearing, so the table
 * stays a complete inventory.
 *
 * Filter input lets a curator narrow a long list (Gemma carries
 * ~120 caches in production).
 */

import { useMemo, useState } from "react";
import {
  useCacheList,
  useClearAllCaches,
  useClearCache,
  type CacheStatRow,
} from "../api";
import { SectionCard } from "../components/SectionCard";
import { ConfirmButton } from "../components/ConfirmButton";

type SortKey = "name" | "hits" | "misses" | "hitPct" | "puts" | "evictions";

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n === 0) return "0";
  return n.toLocaleString();
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  // CacheHitPercentage starts at 0 when no gets have happened — treat
  // a zero-percentage *with zero gets* as "—" to avoid the misleading
  // "0%" reading on a never-hit cache.
  if (n === 0) return "0%";
  return n.toFixed(1) + "%";
}

function sortKey(row: CacheStatRow, by: SortKey): number | string {
  switch (by) {
    case "name": return row.name;
    case "hits": return row.hits ?? -1;
    case "misses": return row.misses ?? -1;
    case "hitPct": return row.hitPercentage ?? -1;
    case "puts": return row.puts ?? -1;
    case "evictions": return row.evictions ?? -1;
  }
}

export function CachesSection() {
  const list = useCacheList();
  const clearAll = useClearAllCaches();
  const clearOne = useClearCache();
  const [filter, setFilter] = useState("");
  const [hideEmpty, setHideEmpty] = useState(true);
  const [sortBy, setSortBy] = useState<SortKey>("hits");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Fallback synth when the backend pre-dates the stats-bearing response —
  // wrap each name as a row with null stat fields so the table still shows
  // the inventory. "—" cells make the older-backend state visually obvious.
  const allRows = useMemo<CacheStatRow[]>(() => {
    if (list.data?.caches && list.data.caches.length > 0) {
      return list.data.caches;
    }
    return (list.data?.names ?? []).map((n) => ({ name: n }) as CacheStatRow);
  }, [list.data]);

  // A cache row counts as "empty" when nothing has hit it since last
  // clear — no gets (hits + misses both 0) and no puts. ``null`` stat
  // fields (caches without JCache MBean stats — e.g. Hibernate L2
  // region caches and security caches) also count as empty: visually
  // they're "— — — — —" rows, no information to the curator. If the
  // user wants to see them anyway, they un-check the toggle.
  function isEmpty(r: CacheStatRow): boolean {
    const hits = Number(r.hits ?? 0);
    const misses = Number(r.misses ?? 0);
    const puts = Number(r.puts ?? 0);
    return hits === 0 && misses === 0 && puts === 0;
  }

  const emptyCount = useMemo(() => allRows.filter(isEmpty).length, [allRows]);

  const filtered = useMemo<CacheStatRow[]>(() => {
    const q = filter.trim().toLowerCase();
    let rows = allRows.slice();
    if (hideEmpty) rows = rows.filter((r) => !isEmpty(r));
    const matched = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
    matched.sort((a, b) => {
      const av = sortKey(a, sortBy);
      const bv = sortKey(b, sortBy);
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return matched;
  }, [filter, allRows, sortBy, sortDir, hideEmpty]);

  const statsMissing = allRows.length > 0 && allRows.every((r) => r.hits == null && r.misses == null);

  function toggleSort(k: SortKey) {
    if (sortBy === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(k);
      setSortDir(k === "name" ? "asc" : "desc");
    }
  }

  const sortArrow = (k: SortKey) =>
    sortBy === k ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  return (
    <SectionCard
      title="Caches"
      summary={
        list.data
          ? `${list.data.count ?? list.data.caches?.length ?? 0} cache${
              (list.data.count ?? list.data.caches?.length ?? 0) === 1 ? "" : "s"
            }`
          : undefined
      }
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
      <div className="flex items-center gap-2 mb-2">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter caches…"
          className="flex-1 min-w-0 text-xs border border-slate-300 dark:border-slate-600 dark:bg-slate-900 rounded px-2 py-1"
        />
        <label
          className="text-[11px] text-slate-600 dark:text-slate-300 inline-flex items-center gap-1 cursor-pointer select-none whitespace-nowrap"
          title="Hide caches with no hits, misses, or puts since last clear"
        >
          <input
            type="checkbox"
            checked={hideEmpty}
            onChange={(e) => setHideEmpty(e.target.checked)}
            className="h-3 w-3 accent-blue-600"
          />
          <span>hide empty{emptyCount > 0 ? ` (${emptyCount})` : ""}</span>
        </label>
      </div>
      {list.isError ? (
        <div className="text-[11px] text-rose-700 dark:text-rose-300">
          {(list.error as Error).message}
        </div>
      ) : !list.data ? (
        <div className="text-xs text-slate-500 italic">loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-xs text-slate-500 italic">
          {filter ? "no matches" : "no caches reported"}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-[11px] tabular-nums">
            <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 sticky top-0">
              <tr>
                <th
                  className="text-left px-2 py-1 font-medium cursor-pointer select-none"
                  onClick={() => toggleSort("name")}
                  title="sort by name"
                >
                  cache{sortArrow("name")}
                </th>
                <th
                  className="text-right px-2 py-1 font-medium cursor-pointer select-none"
                  onClick={() => toggleSort("hits")}
                  title="sort by hits"
                >
                  hits{sortArrow("hits")}
                </th>
                <th
                  className="text-right px-2 py-1 font-medium cursor-pointer select-none"
                  onClick={() => toggleSort("misses")}
                  title="sort by misses"
                >
                  misses{sortArrow("misses")}
                </th>
                <th
                  className="text-right px-2 py-1 font-medium cursor-pointer select-none"
                  onClick={() => toggleSort("hitPct")}
                  title="sort by hit %"
                >
                  hit %{sortArrow("hitPct")}
                </th>
                <th
                  className="text-right px-2 py-1 font-medium cursor-pointer select-none"
                  onClick={() => toggleSort("puts")}
                  title="sort by puts"
                >
                  puts{sortArrow("puts")}
                </th>
                <th
                  className="text-right px-2 py-1 font-medium cursor-pointer select-none"
                  onClick={() => toggleSort("evictions")}
                  title="sort by evictions"
                >
                  evictions{sortArrow("evictions")}
                </th>
                <th className="text-right px-2 py-1 font-medium" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr
                  key={row.name}
                  className="border-t border-slate-100 dark:border-slate-700"
                >
                  <td className="px-2 py-1 font-mono truncate max-w-[28ch]" title={row.name}>
                    {row.name}
                  </td>
                  <td className="px-2 py-1 text-right">{fmt(row.hits)}</td>
                  <td className="px-2 py-1 text-right">{fmt(row.misses)}</td>
                  <td className="px-2 py-1 text-right">{fmtPct(row.hitPercentage)}</td>
                  <td className="px-2 py-1 text-right">{fmt(row.puts)}</td>
                  <td className="px-2 py-1 text-right">{fmt(row.evictions)}</td>
                  <td className="px-2 py-1 text-right whitespace-nowrap">
                    <ConfirmButton
                      label="clear"
                      confirmLabel="clear"
                      disabled={clearOne.isPending}
                      onConfirm={() => clearOne.mutate(row.name)}
                      title={`DELETE /admin/caches/${row.name}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {statsMissing ? (
        <div className="mt-2 text-[10px] text-amber-700 dark:text-amber-300">
          Per-cache stats unavailable on this server build — names only. Update gemma-rest to a build with JCache MBean stats wired.
        </div>
      ) : null}
      {(clearAll.isError || clearOne.isError) ? (
        <div className="mt-2 text-[11px] text-rose-700 dark:text-rose-300">
          {((clearAll.error || clearOne.error) as Error).message}
        </div>
      ) : null}
    </SectionCard>
  );
}
