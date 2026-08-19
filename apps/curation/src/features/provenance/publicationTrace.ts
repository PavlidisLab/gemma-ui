/**
 * A linked paper's provenance, read off the record that holds it.
 *
 * Every other kind in a provenance run is answered by the store, which
 * joins findings to dispositions. A publication link is not in those
 * tables at all — it is an assertion Gemma itself keeps, one
 * `PUBLICATION_ASSOCIATION` row per (experiment, publication), carrying
 * the source, the evidence, who asserted it and when. That row IS the
 * trace; there is nothing to look up and nothing a second producer
 * could add. So the run converts it here rather than asking a service
 * to hand back what the page already holds.
 *
 * 🛑 When the store learns to answer `kind: "publication"`, its answer
 * wins — see the merge rule in `ProvenanceContext`. It can see rows a
 * browser cannot (an agent's proposal that a curator declined, a link
 * removed last month), and this conversion only ever knows the link
 * that survived.
 *
 * Landed Gemma-side 2026-08-17 and live on gemma2; carried into the
 * local store 2026-08-19 (1,010 entries over 464 experiment×PMID pairs,
 * 855 of them `TAS`). 88 entries stay null because Gemma asserts nothing
 * about those 39 links — GSE99114's second paper is one, where the
 * store's linked paper and GEO's disagree and both are kept on purpose.
 * That is the posture the rest of this feature takes: sparse is the
 * design, empty is not a bug.
 */

import type {
  ProvenanceEvent,
  ProvenanceEventKind,
  ProvenanceTrace,
} from "@/api/provenance";
import type {
  Publication,
  PublicationAssociation,
} from "@/features/experiment/types";

import { publicationRefId } from "./refs";

/**
 * How a link got made, in the vocabulary the disc already speaks.
 *
 * 🛑 `legacy` is absent on purpose. It is Gemma's word for "this link
 * predates the record and nothing about its basis was captured" — the
 * backfill assigned it to every link it could not attribute, with no
 * evidence and the lowest rank. Rendering it as an origin would answer
 * "where did this come from" with a row that exists precisely to say
 * nobody knows.
 */
const KIND_BY_SOURCE: Partial<
  Record<NonNullable<PublicationAssociation["source"]>, ProvenanceEventKind>
> = {
  curator: "curator_added",
  agent: "agent_applied",
  geo_submitter_link: "imported",
  external_import: "imported",
};

const ACTOR_BY_SOURCE: Partial<
  Record<
    NonNullable<PublicationAssociation["source"]>,
    NonNullable<ProvenanceEvent["actor"]>
  >
> = {
  curator: { kind: "curator" },
  agent: { kind: "agent" },
  geo_submitter_link: { kind: "import" },
  external_import: { kind: "import" },
};

/**
 * The trace for one publication, or null when the record says nothing
 * that explains the link.
 *
 * Null in three cases, all of them "we don't know" rather than
 * "nothing happened":
 *
 *  - no association row — the local store, and the Gemma paths that
 *    still set a publication without recording one (experiment
 *    splitting, the CELLxGENE and simple-metadata loaders);
 *  - `source: "legacy"` — see above;
 *  - `status: "rejected"` — a paper ruled OUT is not the provenance of
 *    a paper that is linked. Rejections do not ride on the accepted
 *    list anyway (`?includeRejected=true` is opt-in), so this is a
 *    guard, not a code path anyone hits today. It mirrors the rule
 *    that a declined proposal earns no disc: the trace explains what
 *    IS there.
 */
export function traceFromPublication(
  pub: Publication,
): ProvenanceTrace | null {
  const refId = publicationRefId(pub);
  if (!refId) return null;
  const a = pub.association;
  if (!a) return null;
  if (a.status === "rejected") return null;
  const source = a.source ?? null;
  const kind = source ? KIND_BY_SOURCE[source] : undefined;
  if (!kind) return null;

  const event: ProvenanceEvent = {
    kind,
    at: a.asserted_at ?? null,
    // 🛑 On an IMPORT-sourced row, `assertedAt` is when Gemma wrote the
    // assertion down and not when the paper was linked: GEO's submitter
    // named the PMID at submission, and the store's filled rows were
    // stamped by an August 2026 backfill. A curator or an agent, by
    // contrast, asserts the link as they make it — there the two times
    // are the same event and qualifying the date would be noise. See
    // `at_is_record_time`.
    at_is_record_time: kind === "imported",
    actor: actorFor(a),
    // Gemma's own one-line statement of why this is the right paper.
    // It rides on `reason` — the field that already means "the words
    // whoever decided this gave for it" — rather than `summary`, which
    // carries an agent's rationale and is deliberately not rendered.
    reason: (a.evidence ?? "").trim() || null,
    evidence: a.supporting_evidence ?? null,
    evidence_code: (a.evidence_code ?? "").trim() || null,
    confidence: typeof a.confidence === "number" ? a.confidence : null,
  };

  return {
    ref_id: refId,
    // 🛑 Not a review state. Gemma's `status` says whether the LINK is
    // accepted, which is not the same question as whether a human ever
    // looked — and inventing `accepted` here would put a human's mark
    // on 23,066 rows a machine wrote. Left null; the disc reads origin.
    review_state: null,
    events: [event],
  };
}

/** Who asserted it. The name is only meaningful for a person or a
 *  named agent — on an import it is the loader, which the origin line
 *  already says in words. */
function actorFor(a: PublicationAssociation): ProvenanceEvent["actor"] {
  const source = a.source ?? null;
  const base = source ? ACTOR_BY_SOURCE[source] : undefined;
  if (!base) return null;
  const name = (a.asserted_by ?? "").trim();
  if (!name || typeof base !== "object") return base ?? null;
  return { ...base, name };
}

/**
 * Every publication on the design that can account for itself, keyed by
 * the same handle the disc looks itself up under.
 *
 * Publications with nothing recorded are simply absent — the same way
 * the server omits a ref it could not match, so both halves of a run
 * behave alike downstream.
 */
export function publicationTraces(
  publications: readonly Publication[] | null | undefined,
): Map<string, ProvenanceTrace> {
  const out = new Map<string, ProvenanceTrace>();
  for (const p of publications ?? []) {
    const trace = traceFromPublication(p);
    if (trace) out.set(trace.ref_id, trace);
  }
  return out;
}
