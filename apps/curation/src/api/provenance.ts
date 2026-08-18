/**
 * "Where did this annotation come from" — the trace behind a tag or a
 * factor.
 *
 * Curator-triggered and batched, exactly like `POST /validate-terms`:
 * one request covers every annotation on the experiment, because a
 * per-chip fetch on a page with forty of them is forty round trips for
 * an answer that is usually empty.
 *
 * 🛑 **Sparse is the design, not a gap.** Most annotations will have no
 * trace for a long time — nothing recorded them. An empty list is the
 * expected answer and must read as "we don't know", never as an error.
 * The endpoint answers 200 with an empty `events` list for a known-but-
 * untraced annotation; a 404 on the ROUTE means the service isn't
 * deployed yet, which is a different sentence and gets a different one
 * on screen.
 *
 * Contract proposed in
 * `UIB_TO_CAB_2026_08_16_TRACE_WHERE_THIS_ANNOTATION_CAME_FROM.md` and
 * agreed in `CAB_TO_UIB_2026_08_16_PROVENANCE_KEY_ON_IDENTITY_NOT_SLUG.md`,
 * with one correction we adopt here: identity, not the `target_id`
 * slug. The slug is derived from category + label, so it collides
 * (20 of 500 experiments carry two factors sharing category AND name)
 * and — fatally for provenance — it MOVES when a curator relabels,
 * orphaning the history the trace exists to keep.
 */

import { useMutation } from "@tanstack/react-query";

import { api, ApiError } from "./client";
import type { FindingEvidence } from "./justification";

/** Was a human ever involved, in one word.
 *
 *  Server-computed from the event chain rather than derived here:
 *  every consumer would re-implement the derivation and they would
 *  disagree. It is also the thing the dot renders, so it has to mean
 *  the same on every surface. */
export type ProvenanceReviewState =
  | "unreviewed"
  | "accepted"
  | "rejected"
  | "curator_authored"
  | "curator_edited";

export type ProvenanceEventKind =
  | "imported"
  | "agent_proposed"
  | "agent_applied"
  | "curator_added"
  | "curator_edited"
  | "promoted"
  | "removed"
  /** A curator was offered this and said no. Distinct from `removed`
   *  (something WAS there and isn't now) and from silence (nobody has
   *  looked). On an annotation that survived a proposed change, the
   *  declining is the most useful thing in the trace: it is why the
   *  annotation still reads the way it does. Added UI-side against
   *  cab's enum — filed, not invented in a corner. */
  | "curator_rejected";

/** Who did it. "The agent" is a fleet, so `name` carries the subagent
 *  (cell_type / disease / strain / …) — that is the useful answer to
 *  "which agent" — and `head_sha` identifies the build, because
 *  behaviour has measurably differed between shas at one model. */
export interface ProvenanceActor {
  kind?: "agent" | "curator" | "import" | null;
  name?: string | null;
  model?: string | null;
  head_sha?: string | null;
}

export interface ProvenanceEvent {
  kind: ProvenanceEventKind;
  at?: string | null;
  /** Object form preferred; a bare string is tolerated so an early
   *  writer that only knows a name still renders. */
  actor?: ProvenanceActor | string | null;
  run_id?: string | null;
  summary?: string | null;
  confidence?: number | null;
  /** How sure the producer was, as the word it actually used.
   *
   *  Findings carry a bucket, not a number, and coercing `high` to
   *  `0.9` would invent a precision nobody measured — worse, it would
   *  then be compared against real confidences from producers that do
   *  measure one. So the numeric field stays null until something
   *  genuinely emits a number, and this carries the word. Asked for in
   *  `UIB_TO_CAB_2026_08_16_ROUTE_VERIFIED_LIVE_…`; renders whenever
   *  present, absent until then. */
  confidence_bucket?: "high" | "medium" | "low" | null;
  /** The words whoever decided this gave for it — a curator's accept /
   *  dismiss reason, or the asserter's stated basis on a publication
   *  link. Distinct from `summary`, which is an agent's rationale for a
   *  proposal and is deliberately not rendered. */
  reason?: string | null;
  /** GO evidence code (`IC` / `TAS` / `IEA` / `IIA`) — how much anybody
   *  checked. Gemma stamps it on tags and on publication links; carried
   *  here so one code reads the same words wherever it appears. Absent
   *  on everything the store answers today. */
  evidence_code?: string | null;
  /** Verbatim quotes that grounded the pick. Same shape the audit and
   *  proposal surfaces already render, so a trace popover and a
   *  finding never describe one source two ways. */
  evidence?: FindingEvidence[] | null;
  before?: { label?: string | null; uri?: string | null } | null;
  after?: { label?: string | null; uri?: string | null } | null;
}

export interface ProvenanceTrace {
  /** Echoed verbatim from the request — our handle for the annotation. */
  ref_id: string;
  review_state?: ProvenanceReviewState | null;
  events: ProvenanceEvent[];
}

/**
 * One annotation to look up.
 *
 * Carries every identity we hold and lets the server match on the
 * strongest it recognises. Deliberate: `gemmaFactorId` is on the
 * design wire only for experiments Gemma knows, `localFactorId` isn't
 * on that wire at all yet, and factor VALUES have no stable id (32 of
 * 3,735 gold FVs carry one). Sending all of them means the client
 * doesn't have to track which half of the identity rollout has landed.
 */
export interface ProvenanceRef {
  /** Our handle, echoed back as `ProvenanceTrace.ref_id`. Stable
   *  within one page render; never sent as an identity claim. */
  ref_id: string;
  kind: "factor" | "factor_value" | "tag" | "publication";
  /** Gemma's own `ExperimentalFactor` id, when Gemma knows it. */
  gemma_factor_id?: number | null;
  /** Content-derived factor id, stable across rebuilds. */
  local_factor_id?: string | null;
  /** Category + value URIs — a tag's identity is this pair. */
  category_uri?: string | null;
  value_uri?: string | null;
  category_label?: string | null;
  label?: string | null;
  /** A publication's identity: the PMID, or the DOI where there is no
   *  PMID. Gemma keys its association row on (experiment, publication),
   *  so either one resolves it. */
  pubmed_id?: string | null;
  doi?: string | null;
  /** Display convenience and last-resort match. NOT the key. */
  target_id?: string | null;
}

/**
 * The kinds the store's lookup route accepts today.
 *
 * 🛑 A filter, not a formality. `ProvenanceRefIn.kind` is a Pydantic
 * `Literal["factor", "factor_value", "tag"]`, so one ref of an unknown
 * kind 422s the WHOLE request — every factor and tag on the experiment
 * loses its trace to buy nothing. Measured against the live store on
 * 2026-08-17, not inferred from the model: a lone `publication` ref
 * came back 422 where the same body with a `factor` ref came back 200.
 * Publications are answered client-side
 * from the association the publication wire already carries (see
 * `features/provenance/publicationTrace.ts`); add `publication` here
 * the day the store learns to match one, and the server's answer takes
 * over with no other change.
 */
export const SERVER_MATCHED_KINDS: ReadonlySet<ProvenanceRef["kind"]> = new Set(
  ["factor", "factor_value", "tag"] as const,
);

export interface ProvenanceLookupResponse {
  by_ref_id: Record<string, ProvenanceTrace>;
}

/** Thrown when the route itself is missing — the service isn't
 *  deployed. Distinct from "nothing recorded", which is a 200. */
export class ProvenanceUnavailable extends Error {
  constructor() {
    super("provenance service not available");
    this.name = "ProvenanceUnavailable";
  }
}

/**
 * 🛑 Served by the CURATION STORE, not the agent service.
 *
 * `/rest/v2/datasets/{id}/…` is the local store's own shape and the
 * `/rest` proxy already points there (`:8095` in local mode), so this
 * works on a local-store experiment — which is the mode curators
 * actually work in — rather than only where a remote Gemma is
 * configured. It is also the honest home for the data: the human half
 * of a trace is already in the store's `curation_review_disposition`
 * rows, and the agent writes its events there too.
 *
 * Against a backend that doesn't serve it (a remote Gemma, or a store
 * predating the endpoint) this 404s, which surfaces as
 * {@link ProvenanceUnavailable} — "not deployed", not "nothing
 * recorded". The two must never render as the same sentence.
 */
export function provenanceLookupPath(experimentId: number | string): string {
  return `/rest/v2/datasets/${experimentId}/provenance/lookup`;
}

export async function lookupProvenance(
  experimentId: number | string,
  refs: ProvenanceRef[],
): Promise<ProvenanceLookupResponse> {
  const asked = refs.filter((r) => SERVER_MATCHED_KINDS.has(r.kind));
  if (asked.length === 0) return { by_ref_id: {} };
  try {
    return await api.post<ProvenanceLookupResponse>(
      provenanceLookupPath(experimentId),
      { refs: asked },
    );
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 501)) {
      throw new ProvenanceUnavailable();
    }
    throw e;
  }
}

/** Curator-triggered, never on render — same rule as term validation.
 *  Nothing here is needed to read the design, and a trace nobody asked
 *  for is a request per page load for an answer that is usually
 *  empty. */
export function useProvenanceLookup() {
  return useMutation({
    mutationFn: ({
      experimentId,
      refs,
    }: {
      experimentId: number | string;
      refs: ProvenanceRef[];
    }) => lookupProvenance(experimentId, refs),
  });
}
