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

const BASIS_RANK: Record<RelationBasis, number> = {
  CURATED: 100,
  ONTOLOGY: 80,
  EXTERNAL: 60,
  CORPUS: 20,
};

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
  // Keyed on the object's LABEL, not its URI: the split we are folding
  // is precisely grounded-vs-null on the same object, so a URI in the
  // key would keep the copies apart. Two rows whose objects carry
  // DIFFERENT non-null URIs stay separate even under one label — that
  // is two terms that happen to share a name, which is the one case
  // where collapsing would resolve a disagreement the record does not.
  const groups = new Map<string, MergedRelation[]>();
  const key = (r: RelationRow) =>
    [
      r.basis,
      (r.subject_uri ?? r.subject ?? "").toLowerCase(),
      (r.predicate_uri ?? r.predicate ?? "").toLowerCase(),
      (r.object ?? "").trim().toLowerCase(),
    ].join("|");

  for (const r of rows) {
    const bucket = groups.get(key(r)) ?? [];
    const uri = (r.object_uri ?? "").trim();
    const into = bucket.find((m) => {
      const seen = (m.object_uri ?? "").trim();
      return !seen || !uri || seen === uri;
    });
    if (!into) {
      bucket.push({ ...r, copies: 1 });
      groups.set(key(r), bucket);
      continue;
    }
    into.copies += 1;
    into.number_of_experiments = Math.max(
      into.number_of_experiments ?? 0,
      r.number_of_experiments ?? 0,
    );
    // Prefer the variant that carries a grounded object — a URI is
    // navigable and a bare label is not.
    if (!into.object_uri && uri) {
      into.object_uri = r.object_uri;
      into.object_category = r.object_category ?? into.object_category;
    }
    if (!into.example_dataset_id && r.example_dataset_id) {
      into.example_dataset_id = r.example_dataset_id;
    }
  }
  return [...groups.values()].flat();
}

/**
 * Strongest first: basis rank, then support.
 *
 * 🛑 Sorted HERE because the endpoint does not sort. Measured on
 * gemma2: `?subject=<Alzheimer>` serves its support-10 row **tenth**,
 * behind five support-1 rows. The server's own `getScore()` is
 * `basisRank * 1000 + attested`, so this is that ordering applied
 * client-side, not a second opinion about it. Asked the backend to sort
 * at the boundary; when they do, this becomes a stable no-op and should
 * be deleted rather than left to disagree.
 *
 * 🛑 Basis outranks support, always. An `ONTOLOGY` row reports
 * `numberOfExperiments: 0` because asserted rows are not counted — sort
 * on support alone and the strongest rows sink to the bottom. That is
 * live today: CLO's `is disease model for` rows arrive at support 0.
 */
export function rankRelations(rows: readonly MergedRelation[]): MergedRelation[] {
  return [...rows].sort((a, b) => {
    const rank = (BASIS_RANK[b.basis] ?? 0) - (BASIS_RANK[a.basis] ?? 0);
    if (rank !== 0) return rank;
    const support =
      (b.number_of_experiments ?? 0) - (a.number_of_experiments ?? 0);
    if (support !== 0) return support;
    return a.object.localeCompare(b.object);
  });
}

/**
 * 🛑 Drop the rows whose object identifies nothing.
 *
 * `objectBreadth` counts distinct subjects per object. `Homozygous
 * negative` reaches 2898 subjects, `24 h` 448 — perfectly good curated
 * statements, and useless as "what else is known about this term",
 * which is the question this surface asks. The cap is a RELEVANCE
 * filter for one panel, never a quality judgement about the row.
 *
 * 🛑 Breadth `0` is impossible by construction (every row's object is
 * in the table), so it means the lookup missed — treat it as unknown
 * and keep the row rather than reading 0 as maximally specific. A
 * case-collation bug produced exactly that on older builds, and it
 * failed toward keeping the dirtiest values.
 */
export function withinBreadth(
  rows: readonly MergedRelation[],
  max: number,
): MergedRelation[] {
  return rows.filter((r) => {
    const b = r.object_breadth;
    if (b === null || b === undefined || b === 0) return true;
    return b <= max;
  });
}

/**
 * The relations worth putting on a term card, by predicate.
 *
 * 🛑 **The harvest is predicate-agnostic and most of it is
 * bookkeeping.** Measured over ten datasets' relations: `delivered for
 * duration` 375 rows, `has developmental stage` 297, `located in` 115,
 * `derives from` (RO_0001000, `amplified total RNA → total RNA`) 64 —
 * against `is disease model for` 61, `has disease` 31, `induced by` 14,
 * `has_genotype` 10. All of them are perfectly good curated statements
 * and most of them answer a question nobody asked of a TERM: how long a
 * drug was delivered is a fact about an experiment, not about the drug.
 *
 * Unfiltered, the card for `female` offered `has_genotype XX`,
 * `has developmental stage 10 month`, `has characteristic estrus` and
 * `derives from BR24` — six rows taller than the definition, none of
 * them something a curator would act on.
 *
 * So this is an allow-list, not a deny-list: a predicate earns its way
 * on by saying what a term IS or WHERE IT CAME FROM. Keyed on the
 * predicate URI, which is stable, with the label as the fallback for
 * rows that carry no URI.
 *
 * Also asked of the backend — a table this broad is arguably too broad
 * at the source, and every consumer will otherwise write its own
 * version of this list.
 */
const TOPIC_PREDICATES: Record<string, string> = {
  // disease ↔ genotype / model
  "http://purl.obolibrary.org/obo/RO_0016002": "has disease",
  "http://gemma.msl.ubc.ca/ont/TGEMO_00171": "induced by",
  "http://purl.obolibrary.org/obo/CLO_0000179": "is disease model for",
  "http://purl.obolibrary.org/obo/CLO_0000015": "derives from patient having disease",
  // cell-line provenance — what a line came FROM
  "http://purl.obolibrary.org/obo/ENVO_01003004": "derives from part of",
  "http://purl.obolibrary.org/obo/CLO_0037210": "derived from cell line",
  "http://purl.obolibrary.org/obo/CLO_0037209": "derived from cell",
};

/**
 * `has_genotype` — the one predicate that is knowledge on some terms and
 * noise on others.
 *
 * `disease model: Alzheimer disease → has_genotype → APP/PS1` is exactly
 * what this surface is for. `female → has_genotype → XX` is the same
 * predicate reading off a sample's sex, and says nothing about `female`.
 * The difference is not in the predicate but in what the subject IS, so
 * it rides on the category gate below rather than on this list.
 */
const GENOTYPE_PREDICATE = "http://purl.obolibrary.org/obo/GENO_0000222";

/** Subject kinds whose relations are about the ENTITY rather than about
 *  an experimental parameter. A disease model's genotype is knowledge; a
 *  sex's, a timepoint's or a dose's is an artefact of where the
 *  statement was written. Compared lowercased — the corpus carries both
 *  `Disease model` and `disease model`. */
const TOPIC_SUBJECT_KINDS = new Set([
  "disease",
  "disease model",
  "cell line",
  "genotype",
  "strain",
]);

/**
 * Is this a relation worth showing beside a term?
 *
 * Two tiers, because one of the predicates is ambiguous and the rest
 * are not. A `is disease model for` row is knowledge whatever it hangs
 * off; a `has_genotype` row is knowledge only when its subject is the
 * kind of thing that HAS a genotype in the sense a curator means.
 */
export function isTopicRelation(r: RelationRow): boolean {
  const uri = (r.predicate_uri ?? "").trim();
  const label = (r.predicate ?? "").trim().toLowerCase();
  const named =
    (uri && uri in TOPIC_PREDICATES) ||
    Object.values(TOPIC_PREDICATES).includes(label);
  if (named) return true;
  const isGenotype =
    uri === GENOTYPE_PREDICATE || label === "has_genotype" || label === "has genotype";
  if (!isGenotype) return false;
  const kind = (r.subject_category ?? "").trim().toLowerCase();
  // No category to judge by ⇒ don't guess. A `has_genotype` row we
  // cannot place is exactly the `female` case, and showing it costs the
  // curator more than hiding it costs us.
  return kind ? TOPIC_SUBJECT_KINDS.has(kind) : false;
}

/** Matches Gemma's own search-widening default. Below it, dose and
 *  duration values drop out and topics stay. */
export const DEFAULT_MAX_OBJECT_BREADTH = 25;

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
