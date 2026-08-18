/**
 * The annotations a provenance run asks about, and the handle each
 * one is answered under.
 *
 * `ref_id` is OUR handle, not an identity claim: the dot beside an
 * annotation and the panel that ran the lookup both derive it from
 * the same object, so a trace finds its way back to the thing it
 * describes without either side knowing how the server matched. The
 * identity fields travel beside it and the server matches on the
 * strongest one it recognises — see `api/provenance.ts` for why the
 * `target_id` slug is not that key.
 *
 * 🛑 Scope today is factors, tags and publications. Factor VALUES are
 * deliberately out: they have no stable identity yet (32 of 3,735 gold
 * FVs carry an id; an FV's identity is currently its sample partition
 * within its factor), so a per-FV trace would key on something that
 * moves the moment a sample is reassigned — the same failure that ruled
 * out the label slug. Filed with cab; when FVs get the treatment
 * factors just got, `factorValueRef` slots in here and the dot call
 * sites follow.
 */

import type {
  Design,
  Factor,
  Publication,
  Tag,
} from "@/features/experiment/types";
import type { ProvenanceRef } from "@/api/provenance";
import { factorTarget, tagTarget } from "@/features/audit/targetIds";

/** Handle for a factor. Draft-local id — stable for the life of the
 *  page, which is all a session-scoped run needs. */
export function factorRefId(factorId: number): string {
  return `factor:${factorId}`;
}

export function tagRefId(tagId: number): string {
  return `tag:${tagId}`;
}

/** Handle for a linked publication — its PMID, or its DOI where a row
 *  carries no PMID. Both are stable identifiers of the paper itself, so
 *  unlike the factor handle this one survives a reload; the run is
 *  still session-scoped, which is all any consumer relies on.
 *
 *  Returns "" for a row with neither, which nothing can trace and
 *  nothing should ask about. */
export function publicationRefId(pub: Publication): string {
  const pmid = (pub.pubmed_id ?? "").trim();
  if (pmid) return `publication:pmid:${pmid}`;
  const doi = (pub.doi ?? "").trim();
  if (doi) return `publication:doi:${doi}`;
  return "";
}

export function factorRef(factor: Factor): ProvenanceRef {
  return {
    ref_id: factorRefId(factor.id),
    kind: "factor",
    gemma_factor_id: factor.gemma_factor_id ?? null,
    local_factor_id: factor.local_factor_id ?? null,
    category_uri: factor.category?.uri ?? null,
    category_label: factor.category?.label ?? null,
    label: factor.name || factor.category?.label || "",
    target_id: factorTarget(factor.category?.label || factor.name || ""),
  };
}

export function tagRef(tag: Tag): ProvenanceRef {
  return {
    ref_id: tagRefId(tag.id),
    kind: "tag",
    category_uri: tag.category?.uri ?? null,
    category_label: tag.category?.label ?? null,
    value_uri: tag.value?.uri ?? null,
    label: tag.value?.label ?? "",
    target_id: tagTarget(tag.category?.label ?? "", tag.value?.label ?? ""),
  };
}

/**
 * A linked paper.
 *
 * "Which paper is this experiment's" is an assertion like any other —
 * somebody or something claimed it, on some basis — and until Gemma
 * grew a `PUBLICATION_ASSOCIATION` row it was the one assertion in the
 * model that could not say so. A GEO submitter's `!Series_pubmed_id`
 * naming the wrong one of two papers by the same lab is a real, dated
 * failure (GSE227854), and it stayed wrong for four days because
 * nothing on the record distinguished "GEO said so" from "a human read
 * both papers".
 */
export function publicationRef(pub: Publication): ProvenanceRef {
  return {
    ref_id: publicationRefId(pub),
    kind: "publication",
    pubmed_id: (pub.pubmed_id ?? "").trim() || null,
    doi: (pub.doi ?? "").trim() || null,
    label: pub.title || pub.citation || (pub.pubmed_id ?? ""),
  };
}

/**
 * Every annotation on the design worth asking about.
 *
 * Inferred tags are included: "this came up from a sample
 * characteristic" IS provenance, and it is the one class of tag a
 * curator cannot edit, so the trace is the only way to see where it
 * came from.
 *
 * Publications are included too, and they are the one kind the STORE
 * does not answer yet — the run resolves them from the association on
 * the publication wire instead (`publicationTrace.ts`). They still
 * belong in this list: the tally the panel prints is "how many things
 * we asked about", and a paper whose link nobody can account for is
 * exactly the kind of thing that tally exists to surface.
 */
export function provenanceRefs(design: Design | null | undefined): ProvenanceRef[] {
  if (!design) return [];
  const refs: ProvenanceRef[] = [];
  for (const f of design.factors ?? []) refs.push(factorRef(f));
  for (const t of design.tags ?? []) refs.push(tagRef(t));
  for (const p of design.publications ?? []) {
    // A row with neither a PMID nor a DOI has no handle and no
    // identity — there is nothing to ask and nothing to answer.
    if (publicationRefId(p)) refs.push(publicationRef(p));
  }
  return refs;
}
