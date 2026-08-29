/**
 * Typed hooks + mutations for the Gemma admin/monitoring endpoints.
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
import { apiBase as BASE } from "@/api/base";

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

// ─── Corpus / platform counts ─────────────────────────────────────

/**
 * One `filter=` count against a collection endpoint. Every number on
 * the three curation cards below is a `/count` call, never a list that
 * gets measured client-side — the corpus is 25,695 datasets and the
 * count query is the only shape that stays honest as it grows.
 *
 * Measured on gemma2 2026-08-29: each of these answers in 50–80 ms.
 */
async function countWhere(
  collection: "datasets" | "platforms",
  filter?: string,
): Promise<number> {
  const q = filter ? `?filter=${encodeURIComponent(filter)}` : "";
  return await unwrap<number>(`${BASE}/${collection}/count${q}`);
}

/**
 * A count that answers `null` instead of throwing.
 *
 * 🛑 The point is per-NUMBER failure, not per-card. `isPublic` landed
 * on 2026-08-29 and this app is served by whatever Gemma is on the
 * host — an older build answers "the filter is not supported" with a
 * 400, and under a plain `Promise.all` that one rejection takes the
 * four working numbers down with it. A card showing four counts and
 * one dash is a far better answer than a card showing an error.
 *
 * Only the *filter unsupported* and *not permitted* shapes are
 * swallowed. A 500 or a network failure still throws, because that is
 * the card genuinely not working and it should say so.
 */
async function countOrNull(
  collection: "datasets" | "platforms",
  filter?: string,
): Promise<number | null> {
  try {
    return await countWhere(collection, filter);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 400 || e.status === 403)) {
      return null;
    }
    throw e;
  }
}

export interface CorpusCounts {
  total: number;
  /** `null` when this Gemma build has no `isPublic` filter. */
  public: number | null;
  private: number | null;
  troubled: number | null;
  needsAttention: number | null;
}

/**
 * Dataset roll-up for the Corpus card.
 *
 * 🛑 **`isPublic` is ACL-derived and answers differently per caller.**
 * That is not a bug to route around — an anonymous caller sees
 * 23,547 public and 0 private because 0 is the true number of private
 * datasets *it* can see. This page is admin-gated, so the numbers here
 * are the corpus-wide ones. It also only started working for
 * authenticated admins on `f675d0d45b` (2026-08-29); before that it
 * threw `No argument for named parameter ':aclQueryUtils_aoiClassId'`
 * for exactly the caller this page has.
 */
export function useCorpusCounts(refetchMs = 60_000) {
  return useQuery({
    queryKey: ["admin", "corpus-counts"],
    queryFn: async (): Promise<CorpusCounts> => {
      const [total, pub, priv, troubled, needsAttention] = await Promise.all([
        countWhere("datasets"),
        countOrNull("datasets", "isPublic = true"),
        countOrNull("datasets", "isPublic = false"),
        countOrNull("datasets", "curationDetails.troubled = true"),
        countOrNull("datasets", "curationDetails.needsAttention = true"),
      ]);
      return { total, public: pub, private: priv, troubled, needsAttention };
    },
    refetchInterval: refetchMs,
    refetchIntervalInBackground: false,
  });
}

export interface PlatformCounts {
  total: number;
  troubled: number | null;
  needsAttention: number | null;
}

/** Platform roll-up. No `isPublic` here — platforms have no such
 *  filter and asking 400s ("The filter ... is not supported"), which
 *  is the right answer: a platform is not access-controlled the way a
 *  dataset is. */
export function usePlatformCounts(refetchMs = 60_000) {
  return useQuery({
    queryKey: ["admin", "platform-counts"],
    queryFn: async (): Promise<PlatformCounts> => {
      const [total, troubled, needsAttention] = await Promise.all([
        countWhere("platforms"),
        countOrNull("platforms", "curationDetails.troubled = true"),
        countOrNull("platforms", "curationDetails.needsAttention = true"),
      ]);
      return { total, troubled, needsAttention };
    },
    refetchInterval: refetchMs,
    refetchIntervalInBackground: false,
  });
}

// ─── Under curation ───────────────────────────────────────────────

/** Page size for the ticket sweep. `LimitArg.MAXIMUM` is 100 and a
 *  larger value is a 400, not a silent clamp — verified against
 *  gemma2, where `limit=500` answers "The provided limit cannot
 *  exceed 100." */
const TICKET_PAGE = 100;

/** How many pages the sweep will walk before it stops and says so.
 *  10,000 tickets is far past anything the queue holds today (5), and
 *  a card on a monitoring page must not be able to turn into an
 *  unbounded crawl. */
const TICKET_PAGE_CAP = 100;

export interface UnderCurationCounts {
  /** Distinct experiments targeted by an OPEN or IN_PROGRESS ticket. */
  inOpenTicket: number;
  /** Datasets not visible to the world. `null` when this Gemma build
   *  has no `isPublic` filter — the card then shows the ticket half
   *  alone rather than a total that silently omits the private pile. */
  notPublic: number | null;
  /** Either of the above, counted once. `null` follows `notPublic`. */
  either: number | null;
  /** Counted in both halves — subtracted once from `either`. Asked for
   *  exactly rather than inferred. */
  overlap: number;
  /** Open tickets carrying at least one experiment target. */
  openTickets: number;
  /** True when the sweep hit `TICKET_PAGE_CAP` — the numbers are then
   *  lower bounds, and the card says so rather than rounding it off. */
  truncated: boolean;
}

/**
 * "Under curation", per Paul: **private, or in a ticket.**
 *
 * The two halves come from different services and neither can answer
 * the other's question, so they are counted separately and the overlap
 * is asked for explicitly rather than assumed:
 *
 * - *In a ticket* — `GET /tickets?openOnly=true&targetType=EXPRESSION_EXPERIMENT`,
 *   then the distinct `targetId`s. `openOnly` is Gemma's own
 *   OPEN+IN_PROGRESS predicate.
 *
 *   🛑 These are DISCRETE query params, not Gemma's `filter=` DSL.
 *   `/tickets` does not take `filter`, so `filter=state = OPEN` is an
 *   unknown param JAX-RS drops on the floor and the response is the
 *   unfiltered list — a confident wrong answer, not an error. Pass
 *   `state` / `openOnly` / `targetType`; a bad enum value 404s.
 *
 * - *Private* — `datasets/count?filter=isPublic = false`.
 *
 * - *Overlap* — `id in (…) and isPublic = false` over just the ticket
 *   ids. Cheap because that list is small, and exact, which a
 *   max()/sum() guess would not be.
 */
/** Ticket rows as the sweep reads them — only the targets matter. */
export interface TicketTargetsRow {
  targets?: Array<{ targetType?: string; targetId?: number }> | null;
}

/**
 * Collect the distinct experiment ids a page of tickets targets.
 *
 * 🛑 `targetType=EXPRESSION_EXPERIMENT` filters TICKETS, not targets:
 * it selects tickets whose target collection *includes* an experiment,
 * and those tickets arrive carrying all their other targets too. A
 * ticket over one experiment and two array designs contributes one id
 * here, not three, so the type has to be re-checked per target row.
 *
 * Pure, and exported so that rule is pinned by a test.
 */
export function collectExperimentTargets(
  rows: readonly TicketTargetsRow[],
  into: Set<number> = new Set(),
): Set<number> {
  for (const t of rows) {
    for (const tg of t?.targets ?? []) {
      if (
        tg?.targetType === "EXPRESSION_EXPERIMENT" &&
        typeof tg.targetId === "number"
      ) {
        into.add(tg.targetId);
      }
    }
  }
  return into;
}

export function useUnderCurationCounts(refetchMs = 60_000) {
  return useQuery({
    queryKey: ["admin", "under-curation"],
    queryFn: async (): Promise<UnderCurationCounts> => {
      const ids = new Set<number>();
      let offset = 0;
      let pages = 0;
      let openTickets = 0;
      let truncated = false;
      for (;;) {
        const page = await apiGet<{
          data?: TicketTargetsRow[];
          totalElements?: number | null;
        }>(
          `${BASE}/tickets?openOnly=true&targetType=EXPRESSION_EXPERIMENT` +
            `&offset=${offset}&limit=${TICKET_PAGE}`,
        );
        const rows = page?.data ?? [];
        openTickets = page?.totalElements ?? openTickets + rows.length;
        collectExperimentTargets(rows, ids);
        offset += rows.length;
        pages += 1;
        if (rows.length < TICKET_PAGE) break;
        if (pages >= TICKET_PAGE_CAP) {
          truncated = true;
          break;
        }
      }
      const notPublic = await countOrNull("datasets", "isPublic = false");
      // An empty `id in ()` is a malformed filter, so skip the call
      // entirely when no ticket targets an experiment.
      const overlap =
        ids.size === 0 || notPublic === null
          ? 0
          : ((await countOrNull(
              "datasets",
              `id in (${[...ids].join(",")}) and isPublic = false`,
            )) ?? 0);
      return {
        inOpenTicket: ids.size,
        notPublic,
        overlap,
        either: notPublic === null ? null : notPublic + ids.size - overlap,
        openTickets,
        truncated,
      };
    },
    refetchInterval: refetchMs,
    refetchIntervalInBackground: false,
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
