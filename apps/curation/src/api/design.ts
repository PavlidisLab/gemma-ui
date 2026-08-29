import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { useGemmaMode } from "@/lib/gemmaMode";
import type { TaxonBearingRow } from "@/lib/taxon";
import type { PlatformBearingRow } from "@/lib/platform";
import type { Design } from "@/features/experiment/types";
import {
  composeCurationDesign,
  type CurationProposalOverlay,
  type G2Design,
} from "./composeDesign";

const KEY = {
  byExperiment: (experimentId: number | string) => ["design", experimentId] as const,
};

/** Fill in `statement.category` from the parent factor's `category`
 *  whenever it's null on the wire. The server's design endpoint
 *  doesn't persist statement-level categories — they're inherited
 *  from the parent factor at composition time and on commit-side
 *  normalisation — so the round-trip returns null categories even
 *  when the curator's last commit sent them explicitly. Filling
 *  them client-side at every Design boundary (read + commit
 *  response) keeps the validator from flagging "N statements
 *  missing category" on freshly-fetched data and keeps the commit
 *  bar from re-firing immediately after a successful PUT.
 *  Idempotent — already-filled statements pass through unchanged.
 *
 *  Design review 2026-06-10: "commit still doesn't seem to work, at least,
 *  the ui doesn't show that it's been committed". The bar was
 *  showing because of the inherited-category warning, then not
 *  going away after commit because the server response still had
 *  the same nulls. */
export function fillStatementCategoriesFromParent(d: Design): Design {
  return {
    ...d,
    factors: d.factors.map((f) => ({
      ...f,
      factor_values: f.factor_values.map((fv) => ({
        ...fv,
        statements: fv.statements.map((s) => {
          // `composeStatement` ALWAYS hands us a `category` object,
          // possibly with `{ label: "", uri: null }` when the wire
          // payload didn't carry one. The earlier `s.category ? s :
          // ...` check passed those through untouched and the
          // validator kept flagging "N statements missing category"
          // post-commit (design review 2026-06-11 follow-up). Treat
          // missing-OR-empty-label the same — both inherit from the
          // parent factor.
          const hasCategoryLabel = !!s.category?.label?.trim();
          if (hasCategoryLabel) return s;
          if (!f.category?.label) return s;
          return { ...s, category: { ...f.category } };
        }),
      })),
    })),
  };
}

/** Per the agents-side `STATUS_CURATION_TO_GEMMA_2_0.md` §2 reply: compose the
 *  curation `Design` client-side from Gemma 2.0's canonical
 *  `/datasets/{id}/design` + the latest curation-proposal overlay,
 *  rather than expecting a single composite endpoint. Either
 *  endpoint missing → graceful fallback to the other. */
/** Fetch + compose the canonical curation Design for one
 *  experiment. Same composition as ``useDesign``, exposed as a
 *  plain async so non-hook callers (bulk export, etc.) can reuse
 *  it without spinning up a query.
 *
 *  Errors propagate — callers handle retry / skip semantics for
 *  bulk operations. */
export async function fetchDesignSnapshot(
  experimentId: number | string,
): Promise<Design> {
  const [g2, overlay, datasetMeta] = await Promise.all([
    api.get<G2Design>(`/rest/v2/datasets/${experimentId}/design`),
    fetchLatestProposalOverlay(experimentId),
    fetchDatasetMeta(experimentId),
  ]);
  const composed = composeCurationDesign(
    g2,
    experimentId,
    datasetMeta.short_name ?? "",
    overlay,
    datasetMeta.external_database || datasetMeta.accession
      ? {
          database: datasetMeta.external_database ?? "",
          accession: datasetMeta.accession ?? "",
          uri: datasetMeta.external_uri ?? null,
        }
      : null,
    datasetMeta,
  );
  return fillStatementCategoriesFromParent(composed);
}

/** Fetch a curator's polished Design for an experiment from
 *  ``/rest/v2/datasets/{id}/polished/{curator}``. Returns null on
 *  404 (no polished design stored for that curator).
 *
 *  This is the canonical source for "what the curator's final state
 *  looks like" — strictly preferred over ``fetchDesignSnapshot`` for
 *  any caller that needs the curator's edits (Export Set, comparison
 *  baseline, gold projection). ``fetchDesignSnapshot`` returns the
 *  preboard + agent-proposal overlay, which is the agent's last
 *  proposed design, not the curator's polished one — the 2026-05-29
 *  GSE269647 incident proved that the two diverge in practice (cy's
 *  polished has factor ``age``; the snapshot has factor
 *  ``developmental stage``). */
export async function fetchPolishedSnapshot(
  experimentId: number | string,
  curator: string,
): Promise<Design | null> {
  try {
    return await api.get<Design>(
      `/curation/v1/datasets/${experimentId}/polished/${curator}`,
    );
  } catch (err) {
    const e = err as { status?: number };
    if (e && typeof e === "object" && e.status === 404) return null;
    throw err;
  }
}

export function useDesign(experimentId: number | string) {
  return useQuery({
    queryKey: KEY.byExperiment(experimentId),
    enabled: Boolean(experimentId),
    queryFn: () => fetchDesignSnapshot(experimentId),
  });
}

/** Fetch the immutable preboard Design — the dataset's design as it
 *  was when its calibration package was imported into local_api. Never
 *  reflects curator edits, so this is the canonical "Gemma preboard"
 *  source for the baseline / comparator chip strip
 *  (`docs/CURATION_COMPARISON_VIEW_2026_05_27.md` PR 1).
 *
 *  Throws on 404 — legacy experiments imported before the snapshot
 *  endpoint landed have no captured preboard. Callers in the chip-strip
 *  flow should treat this as "preboard source not available for this
 *  experiment" and grey the chip out. */
export async function fetchPreboardSnapshot(
  experimentId: number | string,
): Promise<Design> {
  return api.get<Design>(`/curation/v1/datasets/${experimentId}/design/snapshot`);
}

export function usePreboardSnapshot(experimentId: number | string) {
  return useQuery({
    queryKey: ["design-snapshot", experimentId] as const,
    enabled: Boolean(experimentId),
    queryFn: () => fetchPreboardSnapshot(experimentId),
    // Frozen on the server — no need to refetch on focus / interval.
    staleTime: Infinity,
  });
}

export interface DatasetMeta extends TaxonBearingRow, PlatformBearingRow {
  id?: number;
  short_name?: string | null;
  name?: string | null;
  /** The experiment's abstract. Distinct from the design payload's
   *  `description`, which on Gemma is the GEO "Overall design" line. */
  description?: string | null;
  /** When Gemma first saw this dataset — the banner's "loaded at".
   *  Display only; see `DatasetMetaSlim.date_created`. */
  date_created?: string | null;
  /** 🛑 Read it with `taxonLabel(meta)`, never directly. Gemma sends
   *  no `taxonCommonName` — measured on gemma2 2026-08-28, absent from
   *  every key of `/datasets/{id}` — and carries a nested `taxon`
   *  object instead, which `TaxonBearingRow` above declares. Reading
   *  this field alone made the composed design's taxon `""` on every
   *  remote dataset, and the pre-publish checklist then reported
   *  "no taxon set" in amber on datasets that have one. */
  taxon_common_name?: string | null;
  /** Source database label — "GEO", "ArrayExpress", "CELLxGENE",
   *  etc. Absent on true direct-upload datasets. */
  external_database?: string | null;
  /** Accession at the source database (e.g. "GSE2018"). */
  accession?: string | null;
  /** Click-through URL at the source database. */
  external_uri?: string | null;
  /** Gemma technology classifier — drives the banner modality chip
   *  and the platform-line stub detection. Common values:
   *  ``ONECOLOR`` / ``TWOCOLOR`` (microarray), ``SEQUENCING`` /
   *  ``GENELIST`` (RNA-seq), ``OTHER``. */
  technology_type?: string | null;
  assay?: string | null;
}

/** Dig the single dataset row out of whatever `/rest/v2/datasets/{id}`
 *  handed back.
 *
 *  🛑 This endpoint is PAGINATED. Its envelope carries `groupBy`,
 *  `sort`, `offset`, `limit`, `totalElements`, `filter` and
 *  `inferredTerms` alongside `data`, so `unwrapGemmaEnvelope` in
 *  client.ts deliberately leaves it wrapped — pagination fields are
 *  useful to list callers and it cannot know which kind it is looking
 *  at. Its own comment says the caller picks `.data` explicitly. This
 *  one did not.
 *
 *  The cost: `Array.isArray(envelope)` is false, so the whole envelope
 *  was returned AS the metadata, and every field read off it —
 *  `short_name`, `name`, `taxon`, `platforms`, `accession` — came back
 *  undefined. In remote mode that emptied the banner's title, taxon,
 *  platform and GEO link at once, and looked like four separate bugs.
 *
 *  Handles all three shapes: the bare row, the bare array, and the
 *  envelope around either. */
export function firstDatasetRow(raw: unknown): DatasetMeta {
  if (!raw || typeof raw !== "object") return {};
  if (Array.isArray(raw)) return (raw[0] as DatasetMeta) ?? {};
  const obj = raw as Record<string, unknown>;
  if ("data" in obj) return firstDatasetRow(obj.data);
  return obj as DatasetMeta;
}

async function fetchDatasetMeta(experimentId: number | string): Promise<DatasetMeta> {
  try {
    const raw = await api.get<unknown>(`/rest/v2/datasets/${experimentId}`);
    return firstDatasetRow(raw);
  } catch {
    return {};
  }
}

async function fetchLatestProposalOverlay(
  experimentId: number | string,
): Promise<CurationProposalOverlay | null> {
  // Pulls the latest PROPOSAL-kind curation proposal so we can lift
  // its payload overlay (is_baseline / biomaterial_short_names /
  // tags) onto the composed design. Tolerates 404 / shape drift —
  // the design renders fine without overlay (statements + sample
  // assignments still come from /design).
  try {
    const raw = await api.get<unknown>(
      `/curation/v1/datasets/${experimentId}/curation-proposals?kind=proposal&limit=1`,
    );
    return extractOverlayFromProposalsResponse(raw);
  } catch {
    return null;
  }
}

function extractOverlayFromProposalsResponse(
  raw: unknown,
): CurationProposalOverlay | null {
  if (!raw) return null;
  // The endpoint returns either a bare array (new-shape) or a
  // ``{items, total}`` envelope (legacy). Peek the first row's
  // ``payload_json`` either way.
  let first: Record<string, unknown> | null = null;
  if (Array.isArray(raw) && raw.length > 0) {
    first = raw[0] as Record<string, unknown>;
  } else if (
    typeof raw === "object" &&
    raw !== null &&
    "items" in raw &&
    Array.isArray((raw as { items: unknown[] }).items) &&
    (raw as { items: unknown[] }).items.length > 0
  ) {
    first = (raw as { items: Record<string, unknown>[] }).items[0];
  }
  if (!first) return null;
  const rawPayload = first.payload_json ?? first.payload ?? null;
  if (!rawPayload) return null;
  // ``payload_json`` is a JSON STRING on the new-shape endpoint
  // (``agent_proposal`` rows from local_api/Gemma), an object on the
  // legacy envelope. Parse the string form before returning;
  // otherwise downstream consumers see ``{0: '{', 1: '"', ...}`` from
  // the object-spread coercion and silently treat the overlay as
  // empty. Before this fix the new-shape path always returned a
  // useless overlay → composeCurationDesign never lifted proposed
  // factors → sample-details tab showed no factor columns on
  // experiments whose canonical design hadn't been committed yet.
  let payload: unknown = rawPayload;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  if (!payload || typeof payload !== "object") return null;
  // The payload schema is the proposal Pydantic model; only the
  // fields we surface here matter, so cast conservatively.
  return payload as CurationProposalOverlay;
}

/**
 * Whole-design replace. The mock accepts a PUT with the full Design body.
 *
 * Non-optimistic by design: the editor uses an explicit-commit model
 * with a separate local draft buffer (see DesignEditor + CommitBar),
 * so the cached "saved" copy needs to stay anchored to the server
 * state until the PUT actually lands. That way the diff between
 * draft and saved stays visible — including while a commit is in
 * flight or after a failure.
 *
 * ``reviewer`` is appended to the URL as a query param so the
 * server can stamp it into the history log. Mock auth — the real
 * Gemma side will pull from the bearer/session.
 */
/** Defensive tag-shape normaliser. local_api validates that every
 *  tag has ``{id, category: {label, uri}, value: {label, uri}}`` —
 *  the canonical Tag shape. Some upstream paths (AgentProposalTag
 *  pass-through, audit-side proposal-card flows that haven't been
 *  fully canonicalised yet) can drop a flat-shape entry into
 *  ``design.tags`` where ``category`` and ``value`` are plain strings
 *  and the URI sits in a separate ``value_uri`` field. The save then
 *  422s on PUT. Cy hit this 2026-06-06 on GSE319237 with a
 *  ``disease model: ischemic stroke`` tag.
 *
 *  Rather than chasing every producer (there are several), wrap every
 *  save in a normaliser that coerces flat-shape tags to canonical
 *  form. Idempotent — already-canonical tags pass through unchanged.
 *
 *  Exported for tests only: it is the last thing to touch a design
 *  before the PUT, so its coercions are worth pinning directly rather
 *  than inferring them from an end-to-end save.
 */
export function normaliseDesignForSave(design: Design): Design {
  // 🛑 `baseline` is the store's request-time answer to "is this dataset
  // current", not part of the design. It is computed per request and
  // never stored precisely so a landing that moves the baseline mid-session
  // cannot make a freshly-landed row look stale — and writing our copy of
  // it back would store exactly that stale answer.
  //
  // Stripping is safe HERE and only here: this field is server-computed,
  // so its absence from a whole-design replace loses nothing. The two
  // version stamps beside it are stored fields and are deliberately NOT
  // stripped — on a whole-design replace, omitting one may unstamp the
  // row (see `design.gaps.test.ts`), which is a different bug from
  // echoing a value we did not author.
  const { baseline: _serverComputed, ...rest } =
    design as Design & { baseline?: unknown };
  design = rest as Design;
  const existingIds = new Set<number>();
  for (const t of design.tags ?? []) {
    const tId = (t as { id?: unknown }).id;
    if (typeof tId === "number") existingIds.add(tId);
  }
  let nextSyntheticId = 1;
  while (existingIds.has(nextSyntheticId)) nextSyntheticId++;
  const out: Design = {
    ...design,
    tags: (design.tags ?? []).map((raw) => {
      // ``Tag`` has no index signature, so TS rejects a direct cast to
      // ``Record<string, unknown>``; route through ``unknown`` — the
      // producers feeding this normaliser are deliberately loosely
      // typed (flat-shape tags from several call sites).
      const t = raw as unknown as Record<string, unknown>;
      const cat = t.category;
      const val = t.value;
      let normalizedCategory: { label: string; uri: string | null };
      if (typeof cat === "string") {
        normalizedCategory = {
          label: cat,
          uri:
            typeof t.category_uri === "string" ? t.category_uri : null,
        };
      } else if (cat && typeof cat === "object") {
        const c = cat as Record<string, unknown>;
        normalizedCategory = {
          label: typeof c.label === "string" ? c.label : "",
          uri: typeof c.uri === "string" ? c.uri : null,
        };
      } else {
        normalizedCategory = { label: "", uri: null };
      }
      let normalizedValue: { label: string; uri: string | null };
      if (typeof val === "string") {
        normalizedValue = {
          label: val,
          uri:
            typeof t.value_uri === "string" ? t.value_uri : null,
        };
      } else if (val && typeof val === "object") {
        const v = val as Record<string, unknown>;
        normalizedValue = {
          label: typeof v.label === "string" ? v.label : "",
          uri: typeof v.uri === "string" ? v.uri : null,
        };
      } else {
        normalizedValue = { label: "", uri: null };
      }
      const rawId = (t as { id?: unknown }).id;
      let id: number;
      if (typeof rawId === "number") {
        id = rawId;
      } else {
        while (existingIds.has(nextSyntheticId)) nextSyntheticId++;
        id = nextSyntheticId++;
        existingIds.add(id);
      }
      // ``statements`` is optional and round-trips through the wire
      // as the (predicate, object) + (secondPredicate, secondObject)
      // pairs on AnnotationTagInput; canonical UI shape is an array of
      // ``Statement`` rows with the subject mirroring ``value``. Pass
      // it through verbatim if the source already produced canonical
      // rows; otherwise drop to undefined and let the read side rehydrate.
      const rawStmts = (t as { statements?: unknown }).statements;
      const normalizedStatements =
        Array.isArray(rawStmts) && rawStmts.length > 0
          ? (rawStmts as Design["tags"][number]["statements"])
          : undefined;
      return {
        id,
        category: normalizedCategory,
        value: normalizedValue,
        statements: normalizedStatements,
        inferred: Boolean(
          (t as { inferred?: unknown }).inferred,
        ),
        inferred_source:
          typeof t.inferred_source === "string"
            ? t.inferred_source
            : "",
        evidence_code:
          typeof t.evidence_code === "string"
            ? t.evidence_code
            : "IC",
      } as Design["tags"][number];
    }),
  };
  return out;
}


/** Thrown instead of PUTting a whole design at a real Gemma. Its
 *  message is what the curator reads, so it says what to do. */
export const REMOTE_DESIGN_SAVE_REFUSED =
  "Design commit is disabled in remote mode. This save is the older " +
  "whole-design PUT, which would write straight to Gemma; the " +
  "preflight -> commit -> sign chain that replaces it cannot map this " +
  "draft's ids yet. Switch to local mode to commit.";

export function useUpdateDesign(experimentId: number | string, reviewer = "") {
  const qc = useQueryClient();
  // 🛑 The hook, not the bare resolver. `resolveGemmaMode()` reads
  // build-time env only; `useGemmaMode()` returns what the provider
  // resolved, runtime config included. Reading the other one here would
  // let the button and the mutation disagree — CommitBar enabled while
  // the write refuses is a dead end, and the reverse is a silent write.
  const { mode } = useGemmaMode();
  return useMutation({
    mutationFn: async (design: Design) => {
      // 🛑 REFUSE in remote mode. Not a preference — a safety gate.
      //
      // `/rest` is a catch-all whose meaning changes with mode: this
      // same relative path reaches the curation store locally and a
      // real Gemma remotely. `require_gemma_write_base` guards the
      // AGENT's writes and cannot guard this one, because it never
      // reaches the agent.
      //
      // The chain built to replace this endpoint — preflight, commit,
      // sign — cannot take over yet: every commit item names its target
      // by `gemmaId` or `clientRef`, and the store's design carries
      // neither (`gemma_factor_id` is null on every experiment checked,
      // and its ids are small locals against Gemma's five-digit ones).
      // Mapping the draft today would send everything as a `clientRef`
      // and Gemma would CREATE it all, duplicating a dataset's design
      // instead of updating it. So until that identity mapping exists,
      // the correct remote behaviour is to do nothing at all.
      //
      // Gated here rather than only at the callsite so a second caller
      // cannot be added without meeting it. CommitBar reads the same
      // mode and blocks the button, so the curator sees this before the
      // click rather than as a failure after it.
      if (mode === "remote") {
        throw new Error(REMOTE_DESIGN_SAVE_REFUSED);
      }
      const params = reviewer
        ? `?reviewer=${encodeURIComponent(reviewer)}`
        : "";
      // Belt-and-suspenders: the URL id is the route; re-stamp the body
      // so ``experiment_id`` can never diverge from the path. Without
      // this a mis-seeded buffer (cross-experiment leak) would PUT
      // body.experiment_id=38401 to /datasets/91654/design and bounce
      // on the backend path≠body guard. The route wins here regardless
      // of how the draft was built. Idempotent when they already agree.
      const routeEid =
        typeof experimentId === "number"
          ? experimentId
          : Number.parseInt(String(experimentId), 10);
      const body = normaliseDesignForSave(design);
      const stamped = Number.isFinite(routeEid)
        ? { ...body, experiment_id: routeEid }
        : body;
      const server = await api.put<Design>(
        `/rest/v2/datasets/${experimentId}/design${params}`,
        stamped,
      );
      // Server doesn't persist statement.category — fill it from the
      // parent factor on the way back so the cache + DesignDraftContext
      // see the same normalised shape that just went out, instead of
      // round-tripped nulls. Mirrors the read-side normalisation in
      // fetchDesignSnapshot.
      return fillStatementCategoriesFromParent(server);
    },
    onSuccess: (server) => {
      qc.setQueryData(KEY.byExperiment(experimentId), server);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: KEY.byExperiment(experimentId) });
      qc.invalidateQueries({ queryKey: ["audit-events", experimentId] });
      // Audit + proposal lists also need to refetch — their findings'
      // rationale text references the design we just changed (e.g.
      // "X factor needs a baseline" warning persists in audit cards
      // even after the curator commits the baseline fix). Without
      // invalidating these, per-card warnings stay stale until a hard
      // refresh. Design review 2026-06-11.
      //
      // Broad invalidation (prefix-only) mirrors the precedent in
      // `api/datasets.ts:181` — the alternative is enumerating every
      // (experiment, status) tuple in the proposals KEY shape, which
      // is fragile. The refetch is cheap; staleTime keeps the rest of
      // the app from re-fetching unrelated experiments.
      qc.invalidateQueries({ queryKey: ["audits"] });
      qc.invalidateQueries({ queryKey: ["proposals"] });
      // The unified /curations row backs the chip-strip baseline view
      // (Live Gemma / preboard / consensus). After a commit to
      // /design, the chip-strip rendering of "consensus" or
      // "curator_polish_<x>" stayed at the pre-commit snapshot until
      // the next mount. Per the 2026-06-13 continuity sweep —
      // memory'd in the code comment at the time but never
      // invalidated.
      qc.invalidateQueries({ queryKey: ["curations", experimentId] });
    },
  });
}

/** Persist the curator's committed Design to the DURABLE per-curator
 *  polished store (``/polished/{curator}``). The mutable ``/design``
 *  row is REFRESHED from the package on a calibration-batch reload; the
 *  backend now preserves an edited ``/design`` across a soft re-import
 *  (2026-07-18 fix), but a full delete+reimport still rebuilds it. The
 *  ``polished_designs`` table is the one design store a reload does NOT
 *  wipe, so Commit writes here too — this is what lets the curator's
 *  finalized Design survive a reload. Read back via
 *  ``fetchPolishedSnapshot``. Callers guard on a non-empty ``curator``
 *  (the polished store is keyed by curator; there's nothing to key on
 *  without one). */
export function useUpdatePolished(
  experimentId: number | string,
  curator = "",
) {
  return useMutation({
    mutationFn: async (design: Design) => {
      const routeEid =
        typeof experimentId === "number"
          ? experimentId
          : Number.parseInt(String(experimentId), 10);
      const body = normaliseDesignForSave(design);
      const stamped = Number.isFinite(routeEid)
        ? { ...body, experiment_id: routeEid }
        : body;
      return api.put<Design>(
        `/curation/v1/datasets/${experimentId}/polished/${encodeURIComponent(
          curator,
        )}`,
        stamped,
      );
    },
  });
}
