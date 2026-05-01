import {
  useDatasets,
  useGemmaSearch,
  useImportFromGemma,
  type DatasetSummary,
  type GemmaDatasetHit,
} from "@/api/datasets";
import { useLogout } from "@/api/session";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { experimentRoute, navigate, type ExperimentTab } from "@/routes";
import { useState } from "react";
import { useStickyState } from "@/lib/useStickyState";

/**
 * Landing page: lists experiments imported into the mock. Click
 * one to navigate to its curation surface.
 *
 * Importing happens out-of-band (``./run_import.sh GSE...``).
 * Future: an inline import form here that calls the agent CLI
 * via a thin endpoint — not yet wired.
 */
export function ExperimentList({
  onSelect,
  reviewer,
}: {
  onSelect: (experimentId: number) => void;
  reviewer: string;
}) {
  const { data, isLoading, error, refetch, isFetching } = useDatasets();
  const logout = useLogout();
  const importer = useImportFromGemma();
  const [filter, setFilter] = useState("");
  const [importRef, setImportRef] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  // Status pill filter: "all", "troubled", "needs_attention", "proposals", "notes".
  const [statusFilter, setStatusFilter] = useStickyState<StatusFilter>(
    "experiments.statusFilter",
    "all",
  );
  // Sort: keyed by column id, ascending or descending. Default is the
  // server's order (newest-first by updated_at).
  const [sort, setSort] = useStickyState<{ key: SortKey; dir: SortDir }>(
    "experiments.sort",
    { key: "updated_at", dir: "desc" },
  );

  // Debounce the search query so we don't hammer Gemma on every key.
  const debounced = useDebouncedValue(importRef, 250);
  // Treat single-token alphanumerics that look like an accession
  // (GSE…, GDS…, E-MTAB-…) as direct submissions, not as search
  // queries. Anything with a space or punctuation triggers search.
  const looksLikeAccession = /^(GSE|GDS|GPL|GSM|E-[A-Z]+-)\d/i.test(
    debounced.trim(),
  );
  const search = useGemmaSearch(debounced, {
    enabled: !looksLikeAccession,
  });
  const hits = search.data ?? [];

  function submitImport(e: React.FormEvent) {
    e.preventDefault();
    const ref = importRef.trim();
    if (!ref) return;
    importer.mutate(ref, {
      onSuccess: (design) => {
        setImportRef("");
        setSearchOpen(false);
        onSelect(design.experiment_id);
      },
    });
  }

  function importHit(hit: GemmaDatasetHit) {
    const ref = hit.accession || hit.short_name || String(hit.experiment_id);
    importer.mutate(ref, {
      onSuccess: (design) => {
        setImportRef("");
        setSearchOpen(false);
        onSelect(design.experiment_id);
      },
    });
  }

  const all = data ?? [];
  const counts = {
    all: all.length,
    troubled: all.filter((r) => r.troubled).length,
    needs_attention: all.filter((r) => r.needs_attention).length,
    proposals: all.filter((r) => (r.n_pending_proposals ?? 0) > 0).length,
    notes: all.filter((r) => r.has_curation_note).length,
  };

  const rows = all
    .filter((r) => {
      if (statusFilter === "troubled" && !r.troubled) return false;
      if (statusFilter === "needs_attention" && !r.needs_attention) return false;
      if (statusFilter === "proposals" && (r.n_pending_proposals ?? 0) === 0)
        return false;
      if (statusFilter === "notes" && !r.has_curation_note) return false;
      const q = filter.trim().toLowerCase();
      if (!q) return true;
      return (
        r.short_name.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.taxon.toLowerCase().includes(q)
      );
    })
    .slice()
    .sort((a, b) => compareRows(a, b, sort.key) * (sort.dir === "asc" ? 1 : -1));

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: defaultDirFor(key) },
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto w-full max-w-[1800px] px-4 py-2 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="font-semibold">Gemma</span>
            <span className="text-xs text-slate-400">/</span>
            <span className="text-sm text-slate-600">Curation</span>
            <span className="text-xs text-slate-400">/</span>
            <button
              type="button"
              onClick={() => navigate("#/inbox")}
              className="text-sm text-slate-600 hover:text-slate-900 underline-offset-2 hover:underline"
              title="Cross-experiment proposal inbox"
            >
              proposals
            </button>
            <span className="text-xs text-slate-400">·</span>
            <button
              type="button"
              onClick={() => navigate("#/audits")}
              className="text-sm text-slate-600 hover:text-slate-900 underline-offset-2 hover:underline"
              title="Cross-experiment audit inbox"
            >
              audits
            </button>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-600">
            <span>
              signed in as <span className="font-medium">{reviewer}</span>
            </span>
            <button
              type="button"
              className="text-slate-500 hover:text-slate-900 underline"
              onClick={() => logout.mutate()}
            >
              sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1800px] px-4 py-6 flex-1">
        <div className="card mb-4 px-3 py-2 relative">
          <form
            onSubmit={submitImport}
            className="flex items-center gap-2 flex-wrap"
          >
            <span className="text-xs font-semibold text-slate-700">
              Import from Gemma:
            </span>
            <input
              type="text"
              value={importRef}
              onChange={(e) => {
                setImportRef(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => {
                // Defer so a click on a hit row registers before
                // the popup unmounts.
                window.setTimeout(() => setSearchOpen(false), 150);
              }}
              placeholder="GSE accession, shortName, numeric id, or free-text search…"
              className="text-sm border border-slate-300 rounded px-2 py-1 flex-1 min-w-[20ch]"
            />
            <button
              type="submit"
              className="btn primary text-xs"
              disabled={!importRef.trim() || importer.isPending}
            >
              {importer.isPending ? "importing…" : "import"}
            </button>
            {importer.isError ? (
              <span
                className="text-xs text-rose-700"
                title={(importer.error as Error).message}
              >
                import failed: {(importer.error as Error).message}
              </span>
            ) : null}
            <span className="text-[11px] text-slate-500 basis-full">
              Submit an exact Gemma reference, or type a query like
              "Alzheimer mouse" to search Gemma's catalog. Pulls real
              data via gemmapy on import.
            </span>
          </form>

          {searchOpen &&
          !looksLikeAccession &&
          debounced.trim().length >= 2 ? (
            <div className="absolute left-3 right-3 top-full mt-1 z-30 bg-white border border-slate-200 rounded shadow-md max-h-96 overflow-auto text-xs">
              {search.isFetching && hits.length === 0 ? (
                <div className="px-3 py-2 text-slate-500">searching…</div>
              ) : hits.length === 0 ? (
                <div className="px-3 py-2 text-slate-500">
                  no Gemma hits for "{debounced}"
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {hits.map((h) => (
                    <li
                      key={h.experiment_id}
                      onMouseDown={() => importHit(h)}
                      className="px-3 py-1.5 cursor-pointer hover:bg-slate-50"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono shrink-0">
                          {h.short_name || h.accession}
                        </span>
                        <span className="text-slate-700 truncate">
                          {h.title || (
                            <span className="italic text-slate-400">(no title)</span>
                          )}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-3 flex-wrap">
                        {h.taxon ? <span>{h.taxon}</span> : null}
                        {h.n_samples ? (
                          <span>{h.n_samples} samples</span>
                        ) : null}
                        {h.external_database ? (
                          <span>source: {h.external_database}</span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>

        <div className="card">
          <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-200 flex-wrap">
            <h1 className="section-h">Experiments staged for curation</h1>
            <div className="flex items-center gap-2">
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="filter by accession, title, taxon…"
                className="text-xs border border-slate-300 rounded px-2 py-1 w-72"
              />
              <button
                type="button"
                className="btn ghost text-xs"
                onClick={() => refetch()}
                disabled={isFetching}
                title="refresh the list"
              >
                {isFetching ? "↻…" : "↻"}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-slate-100 flex-wrap">
            <StatusPill
              active={statusFilter === "all"}
              onClick={() => setStatusFilter("all")}
              label="all"
              count={counts.all}
              tone="slate"
            />
            <StatusPill
              active={statusFilter === "needs_attention"}
              onClick={() => setStatusFilter("needs_attention")}
              label="needs attention"
              count={counts.needs_attention}
              tone="amber"
            />
            <StatusPill
              active={statusFilter === "troubled"}
              onClick={() => setStatusFilter("troubled")}
              label="troubled"
              count={counts.troubled}
              tone="rose"
            />
            <StatusPill
              active={statusFilter === "proposals"}
              onClick={() => setStatusFilter("proposals")}
              label="pending proposals"
              count={counts.proposals}
              tone="indigo"
            />
            <StatusPill
              active={statusFilter === "notes"}
              onClick={() => setStatusFilter("notes")}
              label="has note"
              count={counts.notes}
              tone="sky"
            />
          </div>

          {isLoading ? (
            <div className="px-3 py-6 text-sm text-slate-500">loading…</div>
          ) : error ? (
            <div className="px-3 py-6 text-sm text-rose-700">
              couldn't load: {(error as Error).message}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState filter={filter} statusFilter={statusFilter} />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600 uppercase tracking-wide">
                <tr>
                  <SortableTh sort={sort} sortKey="short_name" onToggle={toggleSort} className="w-32">
                    short name
                  </SortableTh>
                  <SortableTh sort={sort} sortKey="title" onToggle={toggleSort}>
                    title
                  </SortableTh>
                  <SortableTh sort={sort} sortKey="taxon" onToggle={toggleSort} className="w-32">
                    taxon
                  </SortableTh>
                  <SortableTh sort={sort} sortKey="n_biomaterials" onToggle={toggleSort} className="w-24">
                    samples
                  </SortableTh>
                  <SortableTh sort={sort} sortKey="n_factors" onToggle={toggleSort} className="w-24">
                    factors
                  </SortableTh>
                  <SortableTh sort={sort} sortKey="n_tags" onToggle={toggleSort} className="w-24">
                    tags
                  </SortableTh>
                  <SortableTh sort={sort} sortKey="status" onToggle={toggleSort} className="w-44">
                    status
                  </SortableTh>
                  <SortableTh sort={sort} sortKey="updated_at" onToggle={toggleSort} className="w-40">
                    last updated
                  </SortableTh>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <Row key={r.experiment_id} r={r} onSelect={onSelect} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto w-full max-w-[1800px] px-4 py-1.5 text-xs text-slate-500">
          Use the import form above to pull a Gemma experiment in.
          The CLI wrapper{" "}
          <code className="font-mono">./run_import.sh &lt;ACCESSION&gt;</code>
          {" "}does the same thing for batch / scripted imports.
        </div>
      </footer>
    </div>
  );
}

function Row({
  r,
  onSelect,
}: {
  r: DatasetSummary;
  onSelect: (experimentId: number) => void;
}) {
  const updated = formatTimestamp(r.updated_at);
  return (
    <tr
      className="cursor-pointer hover:bg-slate-50"
      onClick={() => onSelect(r.experiment_id)}
    >
      <td className="px-3 py-2 font-mono">{r.short_name}</td>
      <td className="px-3 py-2 text-slate-700">
        {r.title || (
          <span className="italic text-slate-400">(no title)</span>
        )}
      </td>
      <td className="px-3 py-2 text-slate-700">
        {r.taxon || <span className="text-slate-300">—</span>}
      </td>
      <td className="px-3 py-2 text-slate-700 tabular-nums">
        {r.n_biomaterials}
      </td>
      <td className="px-3 py-2 text-slate-700 tabular-nums">
        {r.n_factors} ({r.n_fvs} FVs)
      </td>
      <td className="px-3 py-2 text-slate-700 tabular-nums">{r.n_tags}</td>
      <td className="px-3 py-2">
        <StatusChips r={r} />
      </td>
      <td className="px-3 py-2 text-slate-500 text-xs">{updated}</td>
    </tr>
  );
}

type StatusFilter = "all" | "troubled" | "needs_attention" | "proposals" | "notes";

type SortKey =
  | "short_name"
  | "title"
  | "taxon"
  | "n_biomaterials"
  | "n_factors"
  | "n_tags"
  | "status"
  | "updated_at";

type SortDir = "asc" | "desc";

function defaultDirFor(key: SortKey): SortDir {
  // Numeric / status / date columns default to descending — curators
  // care most about the largest counts and most recent activity.
  if (
    key === "n_biomaterials" ||
    key === "n_factors" ||
    key === "n_tags" ||
    key === "status" ||
    key === "updated_at"
  ) {
    return "desc";
  }
  return "asc";
}

function statusPriority(r: DatasetSummary): number {
  // Bigger = "more attention-worthy". Used by the status sort.
  let s = 0;
  if (r.troubled) s += 1000;
  if (r.needs_attention) s += 500;
  s += (r.n_pending_proposals ?? 0) * 10;
  if (r.has_curation_note) s += 1;
  return s;
}

function compareRows(a: DatasetSummary, b: DatasetSummary, key: SortKey): number {
  switch (key) {
    case "short_name":
      return a.short_name.localeCompare(b.short_name);
    case "title":
      return (a.title || "").localeCompare(b.title || "");
    case "taxon":
      return (a.taxon || "").localeCompare(b.taxon || "");
    case "n_biomaterials":
      return a.n_biomaterials - b.n_biomaterials;
    case "n_factors":
      return a.n_factors - b.n_factors;
    case "n_tags":
      return a.n_tags - b.n_tags;
    case "status":
      return statusPriority(a) - statusPriority(b);
    case "updated_at":
      return (a.updated_at || "").localeCompare(b.updated_at || "");
  }
}

function SortableTh({
  children,
  sort,
  sortKey,
  onToggle,
  className = "",
}: {
  children: React.ReactNode;
  sort: { key: SortKey; dir: SortDir };
  sortKey: SortKey;
  onToggle: (k: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  const arrow = active ? (sort.dir === "asc" ? "↑" : "↓") : "";
  return (
    <th className={`text-left px-3 py-1.5 ${className}`}>
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-slate-900 ${active ? "text-slate-900" : ""}`}
      >
        <span>{children}</span>
        <span className="opacity-60 text-[10px] w-2 inline-block">{arrow}</span>
      </button>
    </th>
  );
}

function StatusPill({
  active,
  onClick,
  label,
  count,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  tone: "slate" | "amber" | "rose" | "indigo" | "sky";
}) {
  // Use static class strings (Tailwind purge needs them literal).
  const palette: Record<typeof tone, { active: string; idle: string }> = {
    slate: {
      active: "bg-slate-800 text-white border-slate-800",
      idle: "border-slate-200 text-slate-700 hover:bg-slate-50",
    },
    amber: {
      active: "bg-amber-600 text-white border-amber-600",
      idle: "border-amber-200 text-amber-800 hover:bg-amber-50",
    },
    rose: {
      active: "bg-rose-700 text-white border-rose-700",
      idle: "border-rose-200 text-rose-800 hover:bg-rose-50",
    },
    indigo: {
      active: "bg-indigo-700 text-white border-indigo-700",
      idle: "border-indigo-200 text-indigo-800 hover:bg-indigo-50",
    },
    sky: {
      active: "bg-sky-700 text-white border-sky-700",
      idle: "border-sky-200 text-sky-800 hover:bg-sky-50",
    },
  };
  const cls = active ? palette[tone].active : palette[tone].idle;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] px-2 py-0.5 border rounded-full inline-flex items-center gap-1 ${cls}`}
    >
      <span>{label}</span>
      <span className="tabular-nums opacity-80">{count}</span>
    </button>
  );
}

function StatusChips({ r }: { r: DatasetSummary }) {
  const chips: {
    label: string;
    cls: string;
    title?: string;
    tab: ExperimentTab;
  }[] = [];
  if (r.troubled) {
    chips.push({
      label: "troubled",
      cls: "bg-rose-50 border-rose-200 text-rose-800 hover:bg-rose-100",
      title: "Marked troubled in CurationDetails — click to open notes",
      tab: "notes",
    });
  }
  if (r.needs_attention) {
    chips.push({
      label: "needs attention",
      cls: "bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100",
      title: "Marked needs-attention in CurationDetails — click to open notes",
      tab: "notes",
    });
  }
  const pending = r.n_pending_proposals ?? 0;
  if (pending > 0) {
    chips.push({
      label: `${pending} proposal${pending === 1 ? "" : "s"}`,
      cls: "bg-indigo-50 border-indigo-200 text-indigo-800 hover:bg-indigo-100",
      title: "Open agent proposals — click to review",
      tab: "proposals",
    });
  }
  if (r.has_curation_note) {
    chips.push({
      label: "note",
      cls: "bg-sky-50 border-sky-200 text-sky-800 hover:bg-sky-100",
      title: "Curation note set — click to open",
      tab: "notes",
    });
  }
  if (chips.length === 0) {
    return <span className="text-slate-300 text-xs">—</span>;
  }
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {chips.map((c) => (
        <button
          key={c.label}
          type="button"
          title={c.title}
          onClick={(e) => {
            e.stopPropagation();
            navigate(experimentRoute(r.experiment_id, c.tab));
          }}
          className={`text-[11px] px-1.5 py-0.5 border rounded ${c.cls}`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

function EmptyState({
  filter,
  statusFilter,
}: {
  filter: string;
  statusFilter: StatusFilter;
}) {
  if (statusFilter !== "all") {
    const label = {
      troubled: "troubled",
      needs_attention: "needs-attention",
      proposals: "with pending proposals",
      notes: "with curation notes",
      all: "",
    }[statusFilter];
    return (
      <div className="px-3 py-6 text-sm text-slate-500">
        No experiments {label}
        {filter ? ` match "${filter}"` : ""}.
      </div>
    );
  }
  if (filter) {
    return (
      <div className="px-3 py-6 text-sm text-slate-500">
        No experiments match "{filter}".
      </div>
    );
  }
  return (
    <div className="px-3 py-6 text-sm text-slate-500">
      No experiments staged yet.{" "}
      <code className="font-mono">./run_import.sh GSE277245</code> in the agents
      repo, then click ↻.
    </div>
  );
}

function formatTimestamp(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
