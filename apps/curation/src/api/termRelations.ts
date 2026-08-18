/**
 * What else is known about a term — Gemma's `ANNOTATION_RELATION`.
 *
 * `subject → predicate → object`, plus **how the relation is known**.
 * One queryable home for knowledge Gemma held in four places and could
 * query from none: a curator writes `disease model: left ventricular
 * hypertrophy — induced by → aortic banding` and it lands in a
 * per-experiment characteristic, where "which manipulations induce LVH?"
 * is not a question anyone can ask.
 *
 * 🛑 **Nothing here is an annotation.** No row was written onto any
 * experiment and none will be. These are derived facts about TERMS,
 * carrying their basis, and they must never render where a curator
 * could read them as a claim about the dataset in front of them — see
 * the render rules on `RelationRow` and the note in `CuriePopover`.
 *
 * Contract: `ANNOTATION_RELATION_CONTRACT_2026_08_17`. Every shape here
 * was probed against gemma2 (build `337011bbeb`) rather than read off
 * the prose — see `termRelations.test.ts`, which pins bytes.
 */

import { useQuery } from "@tanstack/react-query";

import { api } from "./client";
import { curieToUrl } from "@/lib/curie";

/**
 * How a relation is known, strongest first.
 *
 * 🛑 **An assertion beats an attestation, and the ladder is not
 * negotiable by support.** `CURATED` is a curator's own statement;
 * `CORPUS` is nobody asserting anything and our own past curation
 * co-occurring. Worse, `CORPUS` is self-consuming: that co-occurrence
 * exists BECAUSE we were overtagging, so it decays as curation
 * improves. Nothing may rest on it alone.
 */
export type RelationBasis = "CURATED" | "ONTOLOGY" | "EXTERNAL" | "CORPUS";

/** Curator-facing words for the basis. "A curator asserted this" and
 *  "this co-occurs in our corpus" are different claims and must never
 *  render alike. */
export const BASIS_COPY: Record<RelationBasis, { label: string; title: string }> = {
  CURATED: {
    label: "curator asserted",
    title:
      "A curator wrote this as a statement on an experiment. Not inferred.",
  },
  ONTOLOGY: {
    label: "ontology asserts",
    title:
      "A loaded ontology asserts this as a restriction on the term itself.",
  },
  EXTERNAL: {
    label: "external source",
    title: "A third-party resource asserts this (MGI, Cellosaurus).",
  },
  CORPUS: {
    label: "co-occurs only",
    title:
      "Nobody asserts this — our own past curation attests it by co-occurrence. " +
      "The weakest basis, and it decays as curation improves.",
  },
};

export interface RelationRow {
  subject: string;
  subject_uri?: string | null;
  subject_category?: string | null;
  subject_category_uri?: string | null;
  predicate: string;
  predicate_uri?: string | null;
  object: string;
  object_uri?: string | null;
  /** Populated on `ONTOLOGY` rows, where the producer knows what it
   *  read. Null by construction on `CURATED`: a curated statement has
   *  ONE category and it belongs to the subject, so inventing one for
   *  the object would be us asserting it. Read `predicate` for the
   *  object's kind instead — never the URI's namespace. */
  object_category?: string | null;
  object_category_uri?: string | null;
  taxon_id?: number | null;
  taxon_name?: string | null;
  basis: RelationBasis;
  /** Which ontology / resource said so, on an asserted basis. */
  source?: string | null;
  source_version?: string | null;
  /** 🛑 Datasets supporting this, **as seen by the caller** — ACL-exact
   *  and counted at read. Anonymous and authenticated see different
   *  numbers for the same relation, so this is never presented as a
   *  property of the relation itself. `0` on an asserted basis means
   *  "not counted", NOT "no evidence". */
  number_of_experiments?: number | null;
  /** Distinct subjects this object relates to, corpus-wide.
   *  `Homozygous negative` 2898, `10 uM` 451, `MPTP` single digits.
   *  🛑 **Not a quality signal** — a dose is a perfectly good curated
   *  statement and a very broad object. It separates a topic from a
   *  structural value, nothing more. */
  object_breadth?: number | null;
  specificity?: number | null;
  /** The dataset a curator can go look at. Null on asserted rows,
   *  which have no experiment behind them. */
  example_dataset_id?: number | null;
  corroborated?: boolean | null;
  /** `TERM_LEVEL` (what the term is, where it came from) or
   *  `EXPERIMENT_LEVEL` (how one experiment was run). Classified per
   *  ROW, not per predicate, because the same predicate does both jobs:
   *  `disease model: Alzheimer → has_genotype → APP/PS1` is knowledge
   *  and `female → has_genotype → XX` is a sample's sex. Both endpoints
   *  return `TERM_LEVEL` only unless asked otherwise, so this arrives
   *  already filtered. */
  topicality?: "TERM_LEVEL" | "EXPERIMENT_LEVEL" | null;
  /** 🛑 Which way the relation may be REASONED along, which is not the
   *  same as which way it can be read. `Alzheimer disease --has_genotype-->
   *  APP/PS1` is true from both ends and inferable from one: APP/PS1
   *  implies an Alzheimer model, and not every Alzheimer model is
   *  APP/PS1. `NEITHER` covers predicates nobody has classified —
   *  including `RO_0001000 derives from`, which carries two meanings on
   *  one URI. */
  inference_direction?:
    | "SUBJECT_IMPLIES_OBJECT"
    | "OBJECT_IMPLIES_SUBJECT"
    | "NEITHER"
    | null;
  /** The derived claim as its own triple — **use this, never invert the
   *  stored one**, or three consumers invert it three ways. Taxon picks
   *  the verb: a mouse carrying APP/PS1 *models* Alzheimer disease, a
   *  human line carrying LRRK2 G2019S *has* Parkinson. All six are null
   *  when nothing is implied, so a claim cannot be rendered where none
   *  exists. */
  implied_subject?: string | null;
  implied_subject_uri?: string | null;
  implied_predicate?: string | null;
  implied_predicate_uri?: string | null;
  implied_object?: string | null;
  implied_object_uri?: string | null;
  /** Groups the side-by-side rows one relation produces across bases.
   *  🛑 It does NOT group two stored relations that derive the same
   *  claim — `BRCA1 has disease breast cancer` and `breast cancer
   *  has_genotype BRCA1` carry different triple keys and one identical
   *  implied triple. Dedupe on what a reader sees. */
  triple_key?: string | null;
}

/**
 * One relation as the UI holds it: the wire row, plus the copies of it
 * that the harvest currently emits separately.
 */
export interface MergedRelation extends RelationRow {
  /** How many wire rows were folded into this one. >1 means the
   *  harvest is emitting the same fact more than once. */
  copies: number;
}

/**
 * Fold the duplicate rows the harvest emits for one fact.
 *
 * 🛑 The same relation arrives 2–3 times, split on things a reader
 * cannot see: `subjectCategory` case (`Disease model` vs `disease
 * model`) and a grounded-vs-null `objectUri` for the same object.
 * Measured on gemma2: `Alzheimer has_genotype APP/PS1` is three rows
 * carrying support 10, 3 and 1.
 *
 * 🛑 **Support is the MAX, never the sum.** The variants list different
 * example datasets and we cannot tell from here whether their supporting
 * sets overlap, so adding them would invent evidence. The max
 * understates rather than overstates, which is the safe direction for a
 * number a curator might act on. Filed with the backend; when the
 * harvest normalizes, `copies` drops to 1 everywhere and this becomes a
 * no-op rather than a lie.
 *
 * Merging is WITHIN a basis only. Two bases naming the same pair are
 * two different claims — MONDO's molecular diagnosis and a curator's
 * clinical syndrome are both correct and neither subsumes the other —
 * and collapsing them would resolve a disagreement the record does not.
 */
export function mergeRelations(rows: readonly RelationRow[]): MergedRelation[] {
  // 🛑 Keyed on the IMPLIED triple — what a reader sees — not on
  // `tripleKey`, which identifies the STORED relation. Two different
  // stored relations can derive one identical claim: `BRCA1 has disease
  // breast cancer` and `breast cancer has_genotype BRCA1` carry
  // different triple keys and render as the same sentence, so a card
  // keyed on the stored identity says it twice.
  //
  // Still keyed within a basis: two bases naming one pair are two
  // claims — an ontology's molecular diagnosis and a curator's clinical
  // syndrome are both correct and neither subsumes the other.
  const groups = new Map<string, MergedRelation[]>();
  const claim = (r: RelationRow) =>
    [
      r.basis,
      (r.implied_subject ?? r.subject ?? "").trim().toLowerCase(),
      (r.implied_predicate ?? r.predicate ?? "").trim().toLowerCase(),
      (r.implied_object ?? r.object ?? "").trim().toLowerCase(),
    ].join("|");

  for (const r of rows) {
    const bucket = groups.get(claim(r)) ?? [];
    const uri = (r.implied_object_uri ?? r.object_uri ?? "").trim();
    // The same value grounded and ungrounded stays SEPARATE server-side,
    // deliberately — merging asserts that an ungrounded `APP/PS1`
    // denotes `TGEMO_00174 APP/PS1`, which is a call nobody has made.
    // We fold them only when one of the two carries no URI at all, which
    // is the same row wearing less identity, never two URIs.
    const into = bucket.find((m) => {
      const seen = (m.implied_object_uri ?? m.object_uri ?? "").trim();
      return !seen || !uri || seen === uri;
    });
    if (!into) {
      bucket.push({ ...r, copies: 1 });
      groups.set(claim(r), bucket);
      continue;
    }
    into.copies += 1;
    into.number_of_experiments = Math.max(
      into.number_of_experiments ?? 0,
      r.number_of_experiments ?? 0,
    );
    if (!into.implied_object_uri && r.implied_object_uri) {
      into.implied_object_uri = r.implied_object_uri;
    }
    if (!into.example_dataset_id && r.example_dataset_id) {
      into.example_dataset_id = r.example_dataset_id;
    }
  }
  return [...groups.values()].flat();
}

/**
 * 🛑 **There is no client-side ranking, and that is deliberate.**
 *
 * There was one, for a day: `?subject=<Alzheimer>` served its
 * support-10 row tenth, behind five support-1 rows, because
 * `getScore()` returned a constant for every self-sufficient basis and
 * the sort fell through to alphabetical. Fixed server-side 2026-08-18,
 * and verified here before this was removed — Alzheimer now arrives
 * `[10, 7, 5, 4, 3]` and Parkinson `[8, 2, 1, 1, 1]`, both strictly
 * descending, with support bounded so it can never cross a basis-rank
 * gap.
 *
 * Re-implementing it here would be a second definition of "strongest",
 * and the two would drift the first time `ONTOLOGY` and `CORPUS` rows
 * arrive together. Server order is the order. The one thing that
 * perturbs it is {@link mergeRelations} taking the max support of two
 * folded copies, which can lift a row past the one above it — a
 * deliberate trade for saying a claim once.
 */

/**
 * Categories whose card must stay silent.
 *
 * A disease is the DESTINATION of everything this surface shows —
 * `gene → has disease → disease`, `cell line → is disease model for →
 * disease` — so its own card has nothing to add, and what it would list
 * instead is every model anyone ever curated against it. `breast
 * cancer` was showing thirteen of those (Paul, 2026-08-18: *"disease
 * terms needn't list anything either — they would be the object of
 * relations we want to show"*).
 */
const SILENT_SUBJECT_KINDS = new Set(["disease", "disease model"]);

/** Predicates whose OBJECT is a disease by definition. Used only to
 *  recognise that the term on screen is a disease when no row happens
 *  to carry it on the subject side. */
const DISEASE_OBJECT_PREDICATES = new Set([
  "http://purl.obolibrary.org/obo/RO_0016002", // has disease
  "http://purl.obolibrary.org/obo/CLO_0000179", // is disease model for
  "http://purl.obolibrary.org/obo/CLO_0000015", // derives from patient having disease
]);

const same = (a: string | null | undefined, b: string) =>
  !!a && a.trim().toLowerCase() === b;

/**
 * Is the term on screen a disease?
 *
 * Read off the rows rather than off the URI's namespace: EFO carries
 * diseases and much else besides, and a namespace test would be a guess
 * where the data states it. A term is a disease if a row names it as a
 * subject categorised that way, or as the object of a predicate whose
 * object is a disease by definition.
 */
export function isDiseaseTerm(
  rows: readonly RelationRow[],
  activeUri: string,
): boolean {
  const active = (activeUri ?? "").trim().toLowerCase();
  if (!active) return false;
  return rows.some((r) => {
    if (same(r.subject_uri, active)) {
      return SILENT_SUBJECT_KINDS.has(
        (r.subject_category ?? "").trim().toLowerCase(),
      );
    }
    if (same(r.object_uri, active)) {
      return DISEASE_OBJECT_PREDICATES.has((r.predicate_uri ?? "").trim());
    }
    return false;
  });
}

/**
 * Does this row make a claim ABOUT the term on screen?
 *
 * 🛑 Decided from the stored ends plus the server's licence, never from
 * `impliedSubjectUri`: that field is null wherever the underlying
 * annotation was ungrounded, and keying on it silently drops the
 * ungrounded half of the evidence. The term is the implied subject when
 * it sits on the licensed end — and `NEITHER` licenses nothing, which
 * is the entire point of the field.
 */
export function impliesFrom(r: RelationRow, activeUri: string): boolean {
  const active = (activeUri ?? "").trim().toLowerCase();
  if (!active) return false;
  if (r.inference_direction === "SUBJECT_IMPLIES_OBJECT") {
    return same(r.subject_uri, active);
  }
  if (r.inference_direction === "OBJECT_IMPLIES_SUBJECT") {
    return same(r.object_uri, active);
  }
  return false;
}

/**
 * The relations worth putting on the card for `activeUri`.
 *
 * 🛑 **No predicate allow-list.** There was one — seven URIs chosen off
 * a tally of what the harvest holds — and it is gone: the server now
 * classifies every row `TERM_LEVEL` / `EXPERIMENT_LEVEL` per ROW (the
 * subject's category decides, which a predicate list cannot express)
 * and returns term-level only by default. Stacking a client list on top
 * subtracts twice and silently, and `has phenotype` is already excluded
 * server-side on the evidence we sent them.
 *
 * 🛑 **No breadth cap either, and that one was doing harm.** The single
 * relation on the `BRCA1` card is `has disease → breast cancer`, and
 * `breast cancer` as an object carries breadth 31 — over the 25 that
 * search widening uses, so the cap was deleting the one row the card
 * exists for. Breadth separates a topic from a dose, which is the job
 * `topicality` now does properly and per row; a small bar belongs to
 * the suppression gate, not to a card that shows five things.
 *
 * What is left is the orientation, which is ours: show the claims this
 * term makes, not the ones made about it.
 */
/**
 * How many objects one predicate may name before the card is listing
 * members rather than stating a property.
 *
 * 🛑 A generic CLASS relates to everything filed under it. Live:
 * `induced pluripotent stem cell line cell` (CLO_0037307) implies
 * seventeen rows — `derived from cell line → 201B7`, `→ 585A1`,
 * `→ Detroit 551 cell`, `→ WT33` — which is the corpus's iPSC lines,
 * not a fact about the term. The same complaint as the disease card,
 * one level up: `breast cancer` listed its models, this lists its
 * members.
 *
 * A specific entity has one or two origins. `U-87 MG` has one
 * (`derived from cell → astrocyte`); `BRCA1` has one (`has disease →
 * breast cancer`). Three is generous for a fact and far below any
 * listing we have seen, so a predicate that names more than three is
 * enumerating rather than describing, and the whole group goes.
 *
 * 🛑 Per predicate, not per card: a term with one origin and one
 * disease should keep both, and only the enumerating group should
 * disappear. Client-side because the wire has no measure of it —
 * `objectBreadth` counts subjects per object, and this is the mirror,
 * objects per subject. Asked for as `subjectBreadth`, which would let
 * the server answer it once for every consumer instead of each of us
 * inferring it from a page of results.
 */
const MAX_OBJECTS_PER_PREDICATE = 3;

export function topicRelations(
  rows: readonly RelationRow[],
  activeUri: string,
): RelationRow[] {
  if (isDiseaseTerm(rows, activeUri)) return [];
  const mine = rows.filter((r) => impliesFrom(r, activeUri));
  const perPredicate = new Map<string, number>();
  for (const r of mine) {
    const k = (r.implied_predicate ?? r.predicate ?? "").trim().toLowerCase();
    perPredicate.set(k, (perPredicate.get(k) ?? 0) + 1);
  }
  return mine.filter((r) => {
    const k = (r.implied_predicate ?? r.predicate ?? "").trim().toLowerCase();
    return (perPredicate.get(k) ?? 0) <= MAX_OBJECTS_PER_PREDICATE;
  });
}

/**
 * Everything related to one term, both directions in one request.
 *
 * `/implies` searches both ends, which is what a term popover wants: a
 * gene sits on the subject side of `SNCA → has disease → Parkinson` and
 * on the object side of `disease model: autism → has_genotype → Mef2c`,
 * and a curator opening either term expects to see the relation.
 * Fetching `?subject=` and `?object=` separately would be two requests
 * for one question.
 *
 * Curator-triggered by construction — it fires when a popover opens,
 * one term at a time, never per row of a list. That is the whole reason
 * this surface is affordable: the contract's own warning is that one
 * call per row of a 50-row browse page is 50 queries.
 */
export function useTermRelations(uri: string | null | undefined, enabled: boolean) {
  return useQuery<RelationRow[]>({
    queryKey: ["term-relations", uri ?? ""],
    enabled: enabled && !!uri,
    queryFn: async () => {
      if (!uri) return [];
      const iri = curieToUrl(uri) ?? uri;
      const params = new URLSearchParams({ from: iri, limit: "200" });
      const res = await api.get<RelationRow[] | { data?: RelationRow[] }>(
        `/rest/v2/annotations/relations/implies?${params.toString()}`,
      );
      // `api.get` unwraps Gemma's `{data: …}` envelope; tolerate both
      // shapes rather than depend on which unwrapping fired.
      const rows = Array.isArray(res) ? res : (res?.data ?? []);
      return Array.isArray(rows) ? rows : [];
    },
    // A term's relations move when the maintenance job runs, not while
    // a curator reads. Long cache, no refetch on focus.
    staleTime: 30 * 60_000,
    retry: false,
  });
}
