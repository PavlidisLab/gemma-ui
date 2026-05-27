/**
 * Typed hooks + mutations for the Gemma admin/monitoring endpoints
 * documented in
 * `~/Dev/eclipseworkspace/Gemma/handoffs/HANDOFF_SYSTEMS_MONITORING_UI.md`.
 *
 * All `/admin/*` endpoints require GROUP_ADMIN. The page uses
 * `credentials: "include"` so a Spring session cookie set by a
 * legacy Gemma login (or basic-auth) carries through.
 *
 * Endpoints respond with the canonical `{data: T}` envelope; we
 * unwrap at the hook boundary so consumers see plain types.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, ApiError } from "@/api/client";

const BASE = "/rest/v2";

// ─── Build / process identity (anonymous) ─────────────────────────

export interface BuildInfo {
  apiVersion?: string | null;
  version?: string | null;
  gitHash?: string | null;
  buildTimestamp?: string | null;
  jvmName?: string | null;
  jvmVersion?: string | null;
  osName?: string | null;
  osVersion?: string | null;
  osArch?: string | null;
  uptimeMillis?: number | null;
}

export function useBuildInfo() {
  return useQuery({
    queryKey: ["admin", "info"],
    queryFn: async () => {
      try {
        return await unwrap<BuildInfo>(`${BASE}/info`);
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 401)) {
          return null;
        }
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export type HealthStatus = "UP" | "DOWN" | "UNKNOWN";

export interface HealthComponent {
  name: string;
  status: HealthStatus;
  details?: Record<string, unknown> | null;
}

export interface HealthRollup {
  status: HealthStatus;
  components?: HealthComponent[];
}

export function useHealthRollup(refetchMs = 15_000) {
  return useQuery({
    queryKey: ["admin", "health"],
    queryFn: async () => {
      // /health returns 503 when any component is DOWN — surface
      // the body anyway so we can show component breakdown.
      try {
        const r = await fetch(`${BASE}/health`, { credentials: "include" });
        const body = (await r.json().catch(() => null)) as unknown;
        return parseHealthBody(body, r.status);
      } catch {
        return { status: "UNKNOWN" as HealthStatus, components: [] };
      }
    },
    refetchInterval: refetchMs,
    refetchOnWindowFocus: true,
  });
}

function parseHealthBody(body: unknown, httpStatus: number): HealthRollup {
  if (!body || typeof body !== "object") {
    return { status: httpStatus === 200 ? "UP" : "DOWN", components: [] };
  }
  const obj = body as Record<string, unknown>;
  // Spring-Boot Actuator shape: {status: "UP", components: {db: {status: "UP"}, …}}
  // Gemma may emit the same shape via Micrometer; tolerate both.
  const status = (obj.status as HealthStatus) ?? (httpStatus === 200 ? "UP" : "DOWN");
  const componentsObj = (obj.components as Record<string, { status?: HealthStatus; details?: Record<string, unknown> }>) ?? null;
  const components: HealthComponent[] = componentsObj
    ? Object.entries(componentsObj).map(([name, v]) => ({
        name,
        status: (v?.status as HealthStatus) ?? "UNKNOWN",
        details: v?.details ?? null,
      }))
    : [];
  return { status, components };
}

// ─── /admin/system — JVM / OS resources ───────────────────────────

export interface SystemSnapshot {
  heap: { usedBytes: number; committedBytes: number; maxBytes: number };
  nonHeap: { usedBytes: number; committedBytes: number; maxBytes: number };
  threads: { liveCount: number; daemonCount: number; peakCount: number };
  startTimeMillis: number;
  uptimeMillis: number;
  osName?: string;
  osVersion?: string;
  osArch?: string;
  availableProcessors: number;
  /** May be -1.0 on platforms where the JVM can't read it. */
  systemLoadAverage: number;
}

export function useSystemSnapshot(refetchMs = 5_000) {
  return useQuery({
    queryKey: ["admin", "system"],
    queryFn: () => unwrap<SystemSnapshot>(`${BASE}/admin/system`),
    refetchInterval: refetchMs,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}

// ─── /admin/hibernate/stats ────────────────────────────────────────

export interface HibernateStats {
  statisticsEnabled?: boolean;
  sessionOpenCount?: number;
  sessionCloseCount?: number;
  transactionCount?: number;
  flushCount?: number;
  prepareStatementCount?: number;
  queryExecutionCount?: number;
  queryExecutionMaxTime?: number;
  queryExecutionMaxTimeQueryString?: string | null;
  queryCacheHitCount?: number;
  queryCacheMissCount?: number;
  queryCachePutCount?: number;
  secondLevelCacheHitCount?: number;
  secondLevelCacheMissCount?: number;
  secondLevelCachePutCount?: number;
  // Tolerate additional fields without complaint.
  [k: string]: unknown;
}

export function useHibernateStats(refetchMs = 10_000) {
  return useQuery({
    queryKey: ["admin", "hibernate-stats"],
    queryFn: () => unwrap<HibernateStats>(`${BASE}/admin/hibernate/stats`),
    refetchInterval: refetchMs,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}

export function useResetHibernateStats() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetch(`${BASE}/admin/hibernate/reset`, {
        method: "POST",
        credentials: "include",
      }).then(throwIfNotOk),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "hibernate-stats"] });
    },
  });
}

// ─── /admin/caches ────────────────────────────────────────────────

export interface CacheStatRow {
  name: string;
  hits?: number | null;
  misses?: number | null;
  gets?: number | null;
  puts?: number | null;
  removals?: number | null;
  evictions?: number | null;
  /** 0..100. Null when stats are unavailable (cache without statisticsEnabled). */
  hitPercentage?: number | null;
}

export interface CacheList {
  count?: number;
  /** Names only — preserved for backward compat. */
  names?: string[];
  /** Per-cache stat rows in the same order as `names`. Newer fields used by
   *  the redesigned CachesSection table. */
  caches?: CacheStatRow[];
}

export function useCacheList() {
  return useQuery({
    queryKey: ["admin", "caches"],
    queryFn: () => unwrap<CacheList>(`${BASE}/admin/caches`),
    staleTime: 60_000,
  });
}

export function useClearAllCaches() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetch(`${BASE}/admin/caches`, {
        method: "DELETE",
        credentials: "include",
      }).then(throwIfNotOk),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "caches"] }),
  });
}

export function useClearCache() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cacheName: string) =>
      fetch(`${BASE}/admin/caches/${encodeURIComponent(cacheName)}`, {
        method: "DELETE",
        credentials: "include",
      }).then(throwIfNotOk),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "caches"] }),
  });
}

// ─── /admin/jobs ───────────────────────────────────────────────────

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelling"
  | "unknown";

export interface TaskStatus {
  taskId: string;
  status: JobStatus;
  submittedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  owner?: string | null;
  taskName?: string | null;
  taskClass?: string | null;
  message?: string | null;
  error?: string | null;
}

export interface JobsSnapshot {
  counts?: Partial<Record<JobStatus, number>>;
  tasks?: TaskStatus[];
}

export function useJobs(refetchMs = 10_000) {
  return useQuery({
    queryKey: ["admin", "jobs"],
    queryFn: () => unwrap<JobsSnapshot>(`${BASE}/admin/jobs`),
    refetchInterval: refetchMs,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}

// ─── /admin/sessions ───────────────────────────────────────────────

export interface SessionsPrincipal {
  username: string;
  sessionCount: number;
  lastRequest?: string | null;
  /** Alphabetical GROUP_* etc. Null for basic-auth principals. */
  authorities?: string[] | null;
}

export interface SessionsSnapshot {
  authenticatedUserCount?: number;
  activeSessionCount?: number;
  /** Optional in practice — older / partial builds omit the list
   *  when empty. Render-side defaults to `[]`. */
  principals?: SessionsPrincipal[];
}

export function useSessions(refetchMs = 30_000) {
  return useQuery({
    queryKey: ["admin", "sessions"],
    queryFn: () => unwrap<SessionsSnapshot>(`${BASE}/admin/sessions`),
    refetchInterval: refetchMs,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}

// ─── /admin/search/indices ────────────────────────────────────────

export interface SearchIndex {
  entityName: string;
  className: string;
  indexName: string;
  indexPath?: string | null;
  exists?: boolean;
  lastModified?: string | null;
  documentCount: number;
  error?: string | null;
}

export interface SearchIndices {
  indexBase?: string | null;
  totalDocumentCount?: number;
  totalDocumentCountExact?: boolean;
  indices?: SearchIndex[];
}

export function useSearchIndices(refetchMs = 60_000) {
  return useQuery({
    queryKey: ["admin", "search-indices"],
    queryFn: () => unwrap<SearchIndices>(`${BASE}/admin/search/indices`),
    refetchInterval: refetchMs,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}

// ─── /admin/ontologies ─────────────────────────────────────────────

export type OntologyInference = "NONE" | "TRANSITIVE" | "MICRO" | "MINI" | "FULL";
export type OntologyLanguageLevel = "FULL" | "DL" | "LITE";

export interface OntologyRow {
  className: string;
  name?: string | null;
  description?: string | null;
  enabled: boolean;
  loaded: boolean;
  initializing: boolean;
  initializationCancelled: boolean;
  inferenceMode?: OntologyInference;
  languageLevel?: OntologyLanguageLevel;
  searchEnabled?: boolean;
  processImports?: boolean;
  termCount?: number | null;
  /** True if the bean implements SlimmableOntologyService (CHEBI, MONDO so far). */
  slimmable?: boolean | null;
  error?: string | null;
}

export interface OntologiesSnapshot {
  count?: number;
  enabledCount?: number;
  loadedCount?: number;
  initializingCount?: number;
  ontologies?: OntologyRow[];
}

export function useOntologies(
  opts: { includeTermCount?: boolean; refetchMs?: number } = {},
) {
  const q = opts.includeTermCount ? "?includeTermCount=true" : "";
  return useQuery({
    queryKey: ["admin", "ontologies", opts.includeTermCount ?? false],
    queryFn: () => unwrap<OntologiesSnapshot>(`${BASE}/admin/ontologies${q}`),
    refetchInterval: opts.refetchMs ?? 30_000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}

// ─── /admin/ontologies/{name}/refresh + /rebuild-slim ─────────────

/**
 * Hot-refresh a single ontology in place (re-fetch source + re-init, atomic
 * model swap). POST /admin/ontologies/{name}/refresh.
 */
export function useRefreshOntology() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      fetch(`${BASE}/admin/ontologies/${encodeURIComponent(name)}/refresh`, {
        method: "POST",
        credentials: "include",
      }).then(throwIfNotOk),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "ontologies"] }),
  });
}

/**
 * Rebuild the corpus-tailored slim cache for a SlimmableOntologyService
 * (CHEBI, MONDO so far). POST /admin/ontologies/{name}/rebuild-slim.
 * Expensive (OWL-API STAR extraction over the full source); 202 + async.
 */
export function useRebuildOntologySlim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      fetch(`${BASE}/admin/ontologies/${encodeURIComponent(name)}/rebuild-slim`, {
        method: "POST",
        credentials: "include",
      }).then(throwIfNotOk),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "ontologies"] }),
  });
}

// ─── /admin/search/indices POST (reindex) ─────────────────────────

export interface ReindexResponse {
  queued?: string[];
  message?: string;
}

/**
 * Trigger a Hibernate Search 7 mass-reindex. Pass an entity name (e.g.
 * "datasets", "platforms", "genes") or null/undefined for all roots.
 * POST /admin/search/indices?entity=NAME. Returns 202; the runtime
 * actually rebuilds the on-disk Lucene index in the background.
 */
export function useReindexSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entity: string | null | undefined) => {
      const q = entity ? `?entity=${encodeURIComponent(entity)}` : "";
      const r = await fetch(`${BASE}/admin/search/indices${q}`, {
        method: "POST",
        credentials: "include",
      });
      await throwIfNotOk(r);
      const body = (await r.json().catch(() => ({}))) as { data?: ReindexResponse } | ReindexResponse;
      return ("data" in (body as object) ? (body as { data: ReindexResponse }).data : body) as ReindexResponse;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "search-indices"] }),
  });
}

// ─── /tickets/summary ─────────────────────────────────────────────

export interface OpenTicketSummary {
  totalOpen: number;
  byType: Record<string, number>;
}

export function useTicketsSummary(refetchMs = 30_000) {
  return useQuery({
    queryKey: ["admin", "tickets-summary"],
    queryFn: () => unwrap<OpenTicketSummary>(`${BASE}/tickets/summary`),
    refetchInterval: refetchMs,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}

// ─── Internals ─────────────────────────────────────────────────────

async function unwrap<T>(path: string): Promise<T> {
  const body = await apiGet<{ data?: T } | T>(path);
  if (body && typeof body === "object" && "data" in (body as Record<string, unknown>)) {
    return (body as { data: T }).data;
  }
  return body as T;
}

async function throwIfNotOk(r: Response): Promise<void> {
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new ApiError(`${r.url} → ${r.status}`, r.status, r.statusText, detail);
  }
}
