/**
 * Gemma annotation sets → the ``AuditReport`` shape the audit and
 * proposal-review panels read.
 *
 * 🛑 **Remote mode reads reviews from Gemma, not the store.** Paul,
 * 2026-09-03: *"we're going to use gemma remote for everything, so we
 * need full capabilities … 'remote' means all remote!"* The store's
 * ``/curation/v1/datasets/{id}/{audits,proposals}`` are LOCAL-STORE
 * paths — Gemma never had them, and the Vite proxy sends
 * ``/curation/v1`` to local_api in BOTH modes, so a hook that names
 * one reads the store whatever the mode says.
 *
 * Gemma's equivalent is one route with a discriminator inside it:
 * ``GET /datasets/{id}/annotation-sets?role=proposal&shape=full``
 * returns rows whose ``kind`` is ``audit`` or ``proposal`` and whose
 * ``payloadJson`` carries the review itself. ``role`` is the storage
 * role (``proposal`` / ``draft`` / ``snapshot`` / ``commit``); it is
 * NOT the audit-vs-proposal split, which lives in ``kind``. Measured
 * against gemma2 2026-09-03: 2,495 sets, 2,494 of them
 * ``role=snapshot``.
 *
 * 🛑 **``payloadJson`` is a JSON STRING, so it escapes the snakeify
 * boundary in ``client.ts``.** The envelope arrives snake_case; the
 * parsed payload arrives however the producer spelled it. Every parse
 * here runs through ``snakeify`` for that reason.
 */
import { api, snakeify } from "./client";
import { resolveGemmaMode } from "@/lib/gemmaMode";
import type {
  AuditFindingDisposition,
  AuditReport,
  CurationReviewKind,
  DispositionStatus,
} from "./auditTypes";

/** One standing ruling as Gemma serves it, post-snakeify. Mirrors
 *  `DispositionResponse`. */
export interface GemmaDisposition {
  target_id?: string | null;
  disposition?: string | null;
  decided_by?: string | null;
  judge_kind?: string | null;
  decided_at?: string | null;
  reason?: string | null;
}

/** Envelope of one annotation set, post-``client.ts`` (snake_case).
 *  Mirrors Gemma's ``AnnotationSetResponse``; only the fields this
 *  adapter reads are declared. */
export interface AnnotationSetRow {
  id: number;
  dataset_id: number;
  role?: string | null;
  source?: string | null;
  kind?: string | null;
  run_id?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  finalized_at?: string | null;
  finalized_by?: string | null;
  finalized_notes?: string | null;
  /** Standing curator rulings, one row per `target_id`, added to
   *  `AnnotationSetResponse` 2026-09-03 (gemma2 `9dc985a`). 🛑 `null`
   *  means the route did not load them; `[]` means loaded and nobody
   *  has ruled. The two are NOT the same — see `dispositionsFor`. */
  dispositions?: GemmaDisposition[] | null;
  agent_version?: string | null;
  model?: string | null;
  agent_name?: string | null;
  ran_at?: string | null;
  payload_json?: string | null;
}

/** Path a review list reads from, per mode. Remote asks Gemma for the
 *  full payload — ``shape=meta`` carries ``payloadSize`` instead of
 *  ``payloadJson`` and would yield rows with nothing in them. */
export function reviewsPath(
  experimentId: number | string,
  remote: boolean,
  storePath: "audits" | "proposals",
): string {
  return remote
    ? `/rest/v2/datasets/${experimentId}/annotation-sets?role=proposal&shape=full`
    : `/curation/v1/datasets/${experimentId}/${storePath}`;
}

/**
 * Annotation-set rows out of either envelope Gemma answers with.
 *
 * 🛑 **The two routes do NOT agree, and `client.ts` unwraps only one
 * of them.** `GET /datasets/{id}/annotation-sets` answers a BARE ARRAY;
 * `GET /annotation-sets` is paginated and answers `{data, groupBy,
 * sort, offset, limit, totalElements}`. `unwrapGemmaEnvelope` lifts
 * `data` only when nothing but envelope metadata sits beside it, so the
 * paginated one arrives whole and an `Array.isArray` test on it is
 * false — the list reads as empty, with no error anywhere. Measured on
 * gemma2 2026-09-03; it is the same defect that blanked the experiment
 * banner on 2026-08-28 and that `asTicketList` guards in `tickets.ts`.
 */
export function asAnnotationSetRows(raw: unknown): AnnotationSetRow[] {
  if (Array.isArray(raw)) return raw as AnnotationSetRow[];
  const o = asRecord(raw);
  if (o && Array.isArray(o.data)) return o.data as AnnotationSetRow[];
  return [];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/**
 * Parse one set's ``payload_json``. Returns ``null`` when the string
 * is absent or is not JSON — a set whose payload will not parse is
 * dropped rather than rendered as an empty review.
 */
export function parseReviewPayload(
  row: AnnotationSetRow,
): Record<string, unknown> | null {
  const raw = row.payload_json;
  if (typeof raw !== "string" || !raw) return null;
  try {
    return asRecord(snakeify(JSON.parse(raw)));
  } catch {
    return null;
  }
}

/**
 * Does this payload carry a review the finding cards can render?
 *
 * 🛑 **The test is ``findings``, and it is deliberately narrow.** The
 * panels iterate ``report.findings`` and key every disposition, note
 * and apply-action off ``finding.target_id``; a payload without that
 * array has no per-finding surface at all. Agent-proposal payloads
 * (root-level ``tags`` / ``proposed_factors`` / ``experiment_summary``)
 * are a DIFFERENT shape with its own reader —
 * ``parseAgentProposalPayload`` — and manufacturing findings out of
 * them here would invent structure the producer did not send.
 */
export function isReviewPayload(payload: Record<string, unknown>): boolean {
  return Array.isArray(payload.findings);
}

/** Gemma's standing rulings → the shape the cards read.
 *
 *  Field-for-field where there is a counterpart, and silent about the
 *  rest rather than inventing one:
 *
 *  | Gemma | ours |
 *  |---|---|
 *  | `target_id` | `target_id` |
 *  | `disposition` | `status` |
 *  | `decided_by` | `reviewer` |
 *  | `decided_at` | `reviewed_at` |
 *  | `reason` | `notes` — free text on both sides, not a chip |
 *
 *  🛑 **`resolved_at` has no Gemma counterpart, and its absence MEANS
 *  something here.** An `accepted` disposition with a null `resolved_at`
 *  reads in the UI as "curator agrees but hasn't acted" — the parked
 *  half of accepted. Every ruling read from Gemma therefore lands in
 *  that half. Stamping a `resolved_at` we were not given would be worse:
 *  it asserts the curator did the work. Left null, and flagged.
 *
 *  The structured chip reasons (`dismiss_reason` / `accept_reason` /
 *  `not_sure_reason`) and `applied_fix` likewise have no counterpart —
 *  Gemma stores one free-text `reason`. `judge_kind` (agent vs curator)
 *  has nowhere to go on `AuditFindingDisposition` at all. */
export function gemmaDispositionsToOurs(
  rows: GemmaDisposition[],
): AuditFindingDisposition[] {
  const out: AuditFindingDisposition[] = [];
  for (const r of rows) {
    const target = str(r?.target_id);
    const status = str(r?.disposition);
    if (!target || !status) continue;
    out.push({
      target_id: target,
      status: status as DispositionStatus,
      reviewer: str(r.decided_by) ?? "",
      reviewed_at: str(r.decided_at),
      notes: str(r.reason) ?? "",
    });
  }
  return out;
}

/** Which dispositions a report should carry.
 *
 *  🛑 **`[]` from the envelope CLEARS what the payload carried; `null`
 *  keeps it.** `[]` is "loaded, nobody has ruled", so falling through
 *  to the payload there would keep rendering a ruling that was
 *  withdrawn on the server, forever. `null` is "this route did not
 *  load them", where the payload is the only thing we have. Both sets
 *  on dataset 2706 answer `[]` today, so this is live behaviour rather
 *  than a defensive branch. */
export function dispositionsFor(
  row: AnnotationSetRow,
  payload: Record<string, unknown>,
): AuditFindingDisposition[] {
  if (Array.isArray(row.dispositions)) {
    return gemmaDispositionsToOurs(row.dispositions);
  }
  const fromPayload = (payload as { dispositions?: unknown }).dispositions;
  return Array.isArray(fromPayload)
    ? (fromPayload as AuditFindingDisposition[])
    : [];
}

/**
 * One annotation set → one ``AuditReport``.
 *
 * The payload IS the report; the envelope supplies identity and the
 * finalize state. Where both carry a field the ENVELOPE wins for
 * anything Gemma owns (``finalized_at`` / ``finalized_by``, written by
 * ``POST /annotation-sets/{id}/finalize``) and the PAYLOAD wins for
 * anything the producing run owns (``audited_at``, ``model``,
 * ``agent_version``), falling back across when one side is silent.
 */
export function annotationSetToReview(
  row: AnnotationSetRow,
  payload: Record<string, unknown>,
): AuditReport {
  const p = payload as unknown as AuditReport;
  return {
    ...p,
    // 🛑 The id the write routes address is the SET's, not the
    // payload's. `POST /annotation-sets/{id}/finalize` and
    // `/reopen` take this number; a producer-side `audit_id` from
    // the store would address a row on the other service.
    audit_id: String(row.id),
    experiment_id: p.experiment_id ?? row.dataset_id,
    experiment_short_name: p.experiment_short_name ?? "",
    kind: (row.kind as CurationReviewKind | undefined) ?? p.kind ?? "audit",
    audited_at: p.audited_at ?? row.ran_at ?? row.created_at ?? "",
    model: p.model ?? row.model ?? null,
    agent_version: p.agent_version ?? row.agent_version ?? null,
    findings: Array.isArray(p.findings) ? p.findings : [],
    // Standing rulings come from the ENVELOPE when the route loaded
    // them, and only fall back to the payload when it did not.
    dispositions: dispositionsFor(row, payload),
    finalized_at: row.finalized_at ?? p.finalized_at ?? null,
    finalized_by: row.finalized_by ?? p.finalized_by ?? null,
    finalized_notes: row.finalized_notes ?? p.finalized_notes ?? null,
  };
}

/**
 * A dataset's annotation sets → the reviews of one ``kind``.
 *
 * Gemma's per-dataset route filters on ``role``, ``source`` and
 * ``createdBy`` — there is no ``kind`` parameter, so the audit /
 * proposal split is applied here. A row with no ``kind`` reads as
 * ``audit``, matching ``AuditReport.kind``'s own back-compat default.
 */
export function annotationSetsToReviews(
  raw: unknown,
  kind: CurationReviewKind,
): { items: AuditReport[]; total: number } {
  const rows = asAnnotationSetRows(raw);
  const items: AuditReport[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if ((str(row.kind) ?? "audit") !== kind) continue;
    const payload = parseReviewPayload(row);
    if (!payload || !isReviewPayload(payload)) continue;
    items.push(annotationSetToReview(row, payload));
  }
  return { items, total: items.length };
}

/**
 * Every review on a dataset, BOTH kinds, most recent first.
 *
 * The export paths want "what is the latest review of any kind on this
 * experiment", which took two store calls. In remote mode both kinds
 * live behind ONE Gemma route, so this fetches once there and splits
 * on `kind` rather than asking twice for the same rows.
 *
 * 404 is "no reviews here" — the store path 404s against a backend
 * that never had it. 🛑 Never widen that to 403: the annotation-sets
 * route needs `GROUP_CURATOR` / `GROUP_ADMIN` / `GROUP_AGENT` and
 * answers 403 without one, and reading an authorization failure as an
 * empty export is a confident wrong answer.
 */
export async function fetchReviewsForExperiment(
  experimentId: number | string,
): Promise<AuditReport[]> {
  const remote = resolveGemmaMode().mode === "remote";
  const get = async (path: string): Promise<unknown> => {
    try {
      return await api.get<unknown>(path);
    } catch (err) {
      const e = err as { status?: number };
      if (e && typeof e === "object" && e.status === 404) return null;
      throw err;
    }
  };
  const storeItems = (raw: unknown): AuditReport[] => {
    const items = (raw as { items?: AuditReport[] } | null)?.items;
    return Array.isArray(items) ? items : [];
  };

  let all: AuditReport[];
  if (remote) {
    const raw = await get(reviewsPath(experimentId, true, "audits"));
    all = [
      ...annotationSetsToReviews(raw, "audit").items,
      ...annotationSetsToReviews(raw, "proposal").items,
    ];
  } else {
    const [audits, proposals] = await Promise.all([
      get(reviewsPath(experimentId, false, "audits")),
      get(reviewsPath(experimentId, false, "proposals")),
    ]);
    all = [...storeItems(audits), ...storeItems(proposals)];
  }
  // Each list arrives newest-first, but the merge across the two needs
  // its own pass.
  return all.sort((a, b) => {
    const ta = a.audited_at ? Date.parse(a.audited_at) : 0;
    const tb = b.audited_at ? Date.parse(b.audited_at) : 0;
    return tb - ta;
  });
}
