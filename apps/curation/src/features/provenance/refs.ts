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
 * 🛑 Scope today is factors and tags. Factor VALUES are deliberately
 * out: they have no stable identity yet (32 of 3,735 gold FVs carry an
 * id; an FV's identity is currently its sample partition within its
 * factor), so a per-FV trace would key on something that moves the
 * moment a sample is reassigned — the same failure that ruled out the
 * label slug. Filed with cab; when FVs get the treatment factors just
 * got, `factorValueRef` slots in here and the dot call sites follow.
 */

import type {
  Design,
  Factor,
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
 * Every annotation on the design worth asking about.
 *
 * Inferred tags are included: "this came up from a sample
 * characteristic" IS provenance, and it is the one class of tag a
 * curator cannot edit, so the trace is the only way to see where it
 * came from.
 */
export function provenanceRefs(design: Design | null | undefined): ProvenanceRef[] {
  if (!design) return [];
  const refs: ProvenanceRef[] = [];
  for (const f of design.factors ?? []) refs.push(factorRef(f));
  for (const t of design.tags ?? []) refs.push(tagRef(t));
  return refs;
}
