/**
 * Platforms catalogue — replacement for the legacy
 * /arrays/showAllArrayDesigns.html.
 *
 * Layout mirrors the dataset Browser: filter rail on the LEFT,
 * sortable results table on the RIGHT. Legacy had checkboxes at the
 * top-right above the table; moving them to a persistent left rail
 * matches the Browser's mental model and gives filter labels room to
 * breathe.
 *
 * v0 facets: manufacturer (derived from name prefix), technology
 * type (ONECOLOR / TWOCOLOR / SEQUENCING / GENELIST / OTHER), taxon
 * (top organisms by dataset count), and a "show troubled" / "show
 * merged" status toggle pair. All client-side filtering off a single
 * /rest/v2/platforms fetch — the catalogue is small enough that we
 * don't need server-side faceting yet.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { getAllPlatforms, getPlatformElementCount } from "@/api/endpoints";
import type { Platform } from "@/lib/types";
import { isSupportedTaxon } from "@/lib/gemmaConfig";
import { manufacturerOf, manufacturerCounts } from "./manufacturer";
import { platformRouteParam } from "@/lib/platformConstants";

type SortKey =
  | "name"
  | "shortName"
  | "technologyType"
  | "taxon"
  | "experiments"
  | "lastUpdated";

interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

export function PlatformsPage() {
  const platformsQ = useQuery({
    queryKey: ["platforms", "all"],
    queryFn: ({ signal }) => getAllPlatforms({}, signal),
  });
  // Human / mouse / rat only. Gemma curates three taxa; the other 45 in
  // /taxa carry 16 platforms between them and not one has an experiment
  // on it. Filtered here rather than in the row predicate below so the
  // facet counts — which are deliberately computed off the full list —
  // don't offer a Taxon row that can never produce a result.
  const all = useMemo(
    () => (platformsQ.data?.data ?? []).filter((p) => isSupportedTaxon(p.taxon)),
    [platformsQ.data],
  );

  // Filter facet state — independent sets so toggling one doesn't
  // disturb the others. Empty set = no filter on that axis (default).
  const [selManu, setSelManu] = useState<Set<string>>(new Set());
  const [selTech, setSelTech] = useState<Set<string>>(new Set());
  const [selTaxon, setSelTaxon] = useState<Set<string>>(new Set());
  const [hideTroubled, setHideTroubled] = useState(false);
  // Hide platforms with zero experiments by default — they're
  // imported-but-unused legacy entries that bloat the list and
  // rarely answer a curator's question. Curators who explicitly
  // want the long tail can toggle this off.
  const [hideOrphans, setHideOrphans] = useState(true);
  const [hideMerged, setHideMerged] = useState(false);
  const [textFilter, setTextFilter] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "experiments", dir: "desc" });

  // Facet counts computed off the FULL list so toggling a filter
  // doesn't make the facet labels jump around (Browser convention).
  const manuFacets = useMemo(() => manufacturerCounts(all), [all]);
  const techFacets = useMemo(() => countBy(all, (p) => p.technologyType || "—"), [all]);
  const taxonFacets = useMemo(
    () => countBy(all, (p) => p.taxon?.commonName || p.taxon?.scientificName || "—"),
    [all],
  );

  // Apply filters + sort.
  const filtered = useMemo(() => {
    const needle = textFilter.trim().toLowerCase();
    let out = all.filter((p) => {
      if (hideTroubled && p.troubled) return false;
      if (hideOrphans && (p.numberOfExpressionExperiments ?? 0) === 0) return false;
      if (hideMerged && p.isMergee) return false;
      if (selManu.size > 0 && !selManu.has(manufacturerOf(p))) return false;
      if (selTech.size > 0 && !selTech.has(p.technologyType || "—")) return false;
      if (selTaxon.size > 0) {
        const t = p.taxon?.commonName || p.taxon?.scientificName || "—";
        if (!selTaxon.has(t)) return false;
      }
      if (needle) {
        const hay = `${p.name || ""} ${p.shortName || ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    out = [...out].sort((a, b) => cmpBy(a, b, sort.key, sort.dir));
    return out;
  }, [all, selManu, selTech, selTaxon, hideTroubled, hideOrphans, hideMerged, textFilter, sort]);

  const totalCount = all.length;
  const visibleCount = filtered.length;

  return (
    <div className="flex h-full min-h-0">
      {/* Filter rail */}
      <aside className="w-64 shrink-0 border-r border-gemma-grid bg-white overflow-y-auto">
        <div className="p-3 space-y-4 text-sm">
          <div>
            <label className="block text-xs uppercase tracking-wide font-semibold text-gemma-subtle mb-1">
              Search
            </label>
            <input
              type="search"
              value={textFilter}
              onChange={(e) => setTextFilter(e.target.value)}
              placeholder="name or shortName"
              className="w-full px-2 py-1 text-sm rounded border border-gemma-grid focus:outline-none focus:ring-2 focus:ring-gemma-accent/40 focus:border-gemma-accent"
            />
          </div>

          <FacetGroup
            label="Manufacturer"
            facets={manuFacets}
            selected={selManu}
            onToggle={(v) => setSelManu(toggleSet(selManu, v))}
            onClear={() => setSelManu(new Set())}
          />
          <FacetGroup
            label="Technology"
            facets={techFacets}
            selected={selTech}
            onToggle={(v) => setSelTech(toggleSet(selTech, v))}
            onClear={() => setSelTech(new Set())}
          />
          <FacetGroup
            label="Taxon"
            facets={taxonFacets}
            selected={selTaxon}
            onToggle={(v) => setSelTaxon(toggleSet(selTaxon, v))}
            onClear={() => setSelTaxon(new Set())}
          />

          <div>
            <div className="text-xs uppercase tracking-wide font-semibold text-gemma-subtle mb-1">
              Status
            </div>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={hideOrphans}
                  onChange={(e) => setHideOrphans(e.target.checked)}
                />
                <span className="text-gemma-ink">
                  Hide orphans
                  <span className="text-gemma-subtle ml-1" title="platforms with zero experiments">
                    (no experiments)
                  </span>
                </span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={hideTroubled}
                  onChange={(e) => setHideTroubled(e.target.checked)}
                />
                <span className="text-gemma-ink">Hide troubled</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={hideMerged}
                  onChange={(e) => setHideMerged(e.target.checked)}
                />
                <span className="text-gemma-ink">
                  Hide merged-in
                  <span className="text-gemma-subtle ml-1" title="platforms that have been folded into another (mergees)">
                    (subsumed)
                  </span>
                </span>
              </label>
            </div>
          </div>
        </div>
      </aside>

      {/* Results */}
      <section className="flex-1 min-w-0 flex flex-col">
        <div className="px-4 py-2 border-b border-gemma-grid bg-white flex items-baseline gap-3">
          <h1 className="text-base font-semibold text-gemma-ink">Platforms</h1>
          <span className="text-xs text-gemma-subtle">
            {platformsQ.isLoading
              ? "loading…"
              : platformsQ.isError
                ? "error loading platforms"
                : `${visibleCount.toLocaleString()} of ${totalCount.toLocaleString()}`}
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          {platformsQ.isError ? (
            <div className="p-4 text-sm text-rose-700">
              {(platformsQ.error as Error)?.message ?? "Failed to load platforms."}
            </div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead className="bg-gemma-bg sticky top-0 z-10">
                <tr className="text-left text-xs uppercase tracking-wide text-gemma-subtle">
                  <th className="px-1 py-2 w-6"></th>
                  <Th sort={sort} setSort={setSort} k="shortName">Short name</Th>
                  <Th sort={sort} setSort={setSort} k="name">Name</Th>
                  <Th sort={sort} setSort={setSort} k="technologyType">Tech</Th>
                  <Th sort={sort} setSort={setSort} k="taxon">Taxon</Th>
                  <Th sort={sort} setSort={setSort} k="experiments" align="right">Experiments</Th>
                  <Th sort={sort} setSort={setSort} k="lastUpdated">Updated</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <PlatformRow key={p.id} platform={p} />
                ))}
                {!platformsQ.isLoading && filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-sm text-gemma-subtle italic">
                      No platforms match the current filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

function PlatformRow({ platform: p }: { platform: Platform }) {
  const [open, setOpen] = useState(false);
  // Lazy-fetch element count only when the row expands. Cached
  // forever per platform — element counts don't change mid-session.
  const elementsQ = useQuery({
    queryKey: ["platform", p.id, "elementCount"],
    queryFn: ({ signal }) => getPlatformElementCount(p.id, signal),
    enabled: open,
    staleTime: Infinity,
  });
  // Sequencing platforms have no fixed probe set — the API will
  // still return a number but it's an artefact (often 0 or a
  // platform-tag count). Treat ONECOLOR/TWOCOLOR as "real
  // microarray element counts" and label others differently.
  const isMicroarray =
    p.technologyType === "ONECOLOR" || p.technologyType === "TWOCOLOR";
  return (
    <>
      <tr
        className="border-b border-gemma-grid hover:bg-gemma-bg/60 cursor-pointer"
        onClick={() => setOpen((v) => !v)}
      >
        <td className="pl-2 pr-0 py-2 text-gemma-subtle text-xs select-none">
          {open ? "▾" : "▸"}
        </td>
        <td className="px-3 py-2 font-mono text-xs">
          {p.shortName ? (
            <Link
              to="/platforms/$shortName"
              params={{ shortName: platformRouteParam(p) }}
              onClick={(e) => e.stopPropagation()}
              className="text-gemma-accent hover:underline"
            >
              {p.shortName}
            </Link>
          ) : (
            <span className="text-gemma-ink">—</span>
          )}
        </td>
        <td className="px-3 py-2 text-gemma-ink">
          <div className="flex items-center gap-1.5">
            <span className="truncate">{p.name ?? "—"}</span>
            {p.troubled ? (
              <span
                className="text-[9px] uppercase tracking-wide px-1 rounded bg-rose-100 text-rose-800 border border-rose-300"
                title="troubled"
              >
                trbl
              </span>
            ) : null}
            {p.isMerged ? (
              <span
                className="text-[9px] uppercase tracking-wide px-1 rounded bg-violet-100 text-violet-800 border border-violet-300"
                title="merged — has subsumed other platforms"
              >
                merged
              </span>
            ) : null}
            {p.isMergee ? (
              <span
                className="text-[9px] uppercase tracking-wide px-1 rounded bg-slate-100 text-slate-700 border border-slate-300"
                title="this platform has been merged into another"
              >
                mergee
              </span>
            ) : null}
          </div>
        </td>
        <td className="px-3 py-2 text-xs text-gemma-subtle whitespace-nowrap">
          {p.technologyType ?? "—"}
        </td>
        <td className="px-3 py-2 text-xs text-gemma-subtle italic whitespace-nowrap">
          {p.taxon?.commonName ?? p.taxon?.scientificName ?? "—"}
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-gemma-ink">
          {(p.numberOfExpressionExperiments ?? 0).toLocaleString()}
        </td>
        <td className="px-3 py-2 text-xs text-gemma-subtle whitespace-nowrap">
          {formatShortDate(p.lastUpdated)}
        </td>
      </tr>
      {open ? (
        <tr className="border-b border-gemma-grid bg-gemma-bg/30">
          <td></td>
          <td colSpan={6} className="px-3 py-3 space-y-2">
            {/* Metadata strip — small key/value pairs */}
            <div className="flex items-baseline gap-x-5 gap-y-1 flex-wrap text-xs">
              <MetaPair
                label={isMicroarray ? "Probes / elements" : "Probe-set entries"}
                value={
                  elementsQ.isLoading
                    ? "loading…"
                    : elementsQ.isError
                      ? "—"
                      : (elementsQ.data ?? 0).toLocaleString()
                }
                hint={
                  isMicroarray
                    ? undefined
                    : "sequencing platforms report a feature/tag total — meaning depends on the platform"
                }
              />
              <MetaPair
                label="Switched datasets"
                value={(p.numberOfSwitchedExpressionExperiments ?? 0).toLocaleString()}
                hint="datasets switched off this platform to a newer/preferred one"
              />
              {p.color ? (
                <MetaPair label="Channels" value={p.color} />
              ) : null}
              {p.releaseVersion ? (
                <MetaPair label="Version" value={p.releaseVersion} />
              ) : null}
              <MetaPair
                label="ID"
                value={`#${p.id}`}
                hint="Gemma internal id"
              />
            </div>

            {/* Description — full prose, wrapped */}
            {p.description ? (
              <p className="text-xs text-gemma-ink leading-relaxed max-w-4xl">
                {p.description}
              </p>
            ) : (
              <p className="text-xs text-gemma-subtle italic">
                No description recorded.
              </p>
            )}

            {/* External refs + curation note */}
            {(p.externalReferences?.length ?? 0) > 0 ? (
              <div className="text-xs text-gemma-subtle">
                External:{" "}
                {p.externalReferences!.map((ref, i) => (
                  <span key={i} className="font-mono">
                    {i > 0 ? " · " : ""}
                    {ref.externalDatabase?.name ?? "?"}:{ref.accession ?? "—"}
                  </span>
                ))}
              </div>
            ) : null}
            {p.curationNote ? (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 max-w-4xl">
                <span className="font-semibold">Curator note:</span> {p.curationNote}
              </div>
            ) : null}
            {p.releaseUrl ? (
              <div className="text-xs">
                <a
                  href={p.releaseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-gemma-accent hover:underline"
                >
                  Manufacturer release page ↗
                </a>
              </div>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function MetaPair({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5" title={hint}>
      <span className="text-[10px] uppercase tracking-wide text-gemma-subtle">
        {label}
      </span>
      <span className="text-gemma-ink tabular-nums font-medium">{value}</span>
    </span>
  );
}

function FacetGroup({
  label,
  facets,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  facets: Array<{ name: string; count: number }>;
  selected: Set<string>;
  onToggle: (name: string) => void;
  onClear: () => void;
}) {
  if (facets.length === 0) return null;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs uppercase tracking-wide font-semibold text-gemma-subtle">
          {label}
        </span>
        {selected.size > 0 ? (
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] text-gemma-accent hover:underline"
          >
            clear
          </button>
        ) : null}
      </div>
      <ul className="space-y-0.5 max-h-56 overflow-y-auto pr-1">
        {facets.map((f) => (
          <li key={f.name}>
            <label className="flex items-center gap-2 text-sm py-0.5 cursor-pointer hover:bg-gemma-bg rounded px-1">
              <input
                type="checkbox"
                checked={selected.has(f.name)}
                onChange={() => onToggle(f.name)}
              />
              <span className="flex-1 truncate text-gemma-ink">{f.name}</span>
              <span className="text-xs text-gemma-subtle tabular-nums">
                {f.count}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Th({
  k,
  sort,
  setSort,
  children,
  align = "left",
}: {
  k: SortKey;
  sort: SortState;
  setSort: (s: SortState) => void;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  const active = sort.key === k;
  const arrow = !active ? "" : sort.dir === "asc" ? " ▲" : " ▼";
  return (
    <th
      onClick={() =>
        setSort({
          key: k,
          dir: active ? (sort.dir === "asc" ? "desc" : "asc") : "asc",
        })
      }
      className={
        "px-3 py-2 font-medium cursor-pointer select-none hover:bg-gemma-grid/30 " +
        (align === "right" ? "text-right" : "")
      }
    >
      {children}
      {arrow}
    </th>
  );
}

// ---- helpers ----

function countBy<T>(
  arr: T[],
  fn: (x: T) => string,
): Array<{ name: string; count: number }> {
  const m = new Map<string, number>();
  for (const x of arr) {
    const k = fn(x);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function toggleSet(s: Set<string>, v: string): Set<string> {
  const next = new Set(s);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

function cmpBy(
  a: Platform,
  b: Platform,
  k: SortKey,
  dir: "asc" | "desc",
): number {
  const sign = dir === "asc" ? 1 : -1;
  switch (k) {
    case "name":
      return (a.name ?? "").localeCompare(b.name ?? "") * sign;
    case "shortName":
      return (a.shortName ?? "").localeCompare(b.shortName ?? "") * sign;
    case "technologyType":
      return (a.technologyType ?? "").localeCompare(b.technologyType ?? "") * sign;
    case "taxon": {
      const at = a.taxon?.commonName ?? a.taxon?.scientificName ?? "";
      const bt = b.taxon?.commonName ?? b.taxon?.scientificName ?? "";
      return at.localeCompare(bt) * sign;
    }
    case "experiments":
      return (
        ((a.numberOfExpressionExperiments ?? 0) -
          (b.numberOfExpressionExperiments ?? 0)) *
        sign
      );
    case "lastUpdated":
      return (
        ((a.lastUpdated ?? "").localeCompare(b.lastUpdated ?? "")) * sign
      );
  }
}

function formatShortDate(iso: string | undefined | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
