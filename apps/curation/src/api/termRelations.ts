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
 * The relations worth putting on a term card.
 *
 * Three conditions, and each one came from a curator looking at a card
 * that had too much on it.
 *
 * **1. The predicate has to say what a term IS or WHERE IT CAME FROM.**
 * The harvest is predicate-agnostic and most of it, by volume, is
 * experimental bookkeeping: over ten datasets' relations, `delivered
 * for duration` 375 rows, `has developmental stage` 297, `located in`
 * 115, `derives from` (RO_0001000, `amplified total RNA → total RNA`)
 * 64, against `is disease model for` 61, `has disease` 31, `induced by`
 * 14. All good curated statements; how long a drug was delivered is a
 * fact about an experiment, not about the drug.
 *
 * **2. The term on screen has to be the SUBJECT.** A relation reads in
 * one direction and the inbound view of it is a corpus listing, not
 * knowledge: `breast cancer` was showing `← has disease LM1`,
 * `← has disease LM9`, `← has disease FVB-Tg(C3-1-TAg)cJeg/JegJ` and
 * twelve more — every model anyone has ever curated against it. That is
 * a search result wearing a term card's clothes.
 *
 * **3. The subject has to be an ENTITY whose origin is knowledge** — a
 * cell line, a genotype, a strain. Diseases and disease models are the
 * DESTINATION of everything here (`gene → has disease → disease`,
 * `cell line → is disease model for → disease`), so a disease term's
 * own card has nothing to add and renders none (Paul, 2026-08-18:
 * *"disease terms needn't list anything either — they would be the
 * object of relations we want to show"*). It also drops the class of
 * row that started this: `female → has_genotype → XX` is a sample's sex
 * read back at you, and `BRCA1 → has_genotype → Knockdown` says nothing
 * about BRCA1.
 *
 * What survives is the question a curator actually has. On `BRCA1`:
 * `has disease → breast cancer`. On a cell line: `derived from cell →
 * astrocyte`, `is disease model for → glioblastoma`. One or two lines,
 * measured against live data, and nothing on the terms that should be
 * quiet.
 *
 * 🛑 The cost is real and deliberate: `MPTP` loses `← induced by ←
 * Parkinson disease`, which is interesting on a treatment card. Inbound
 * comes back the day there is a reason to distinguish "one useful
 * inbound relation" from "seventeen models of this disease", and the
 * backend's row classification is where that would come from — asked in
 * `UIB_TO_GEMMA_BACKEND_2026_08_18_THE_HARVEST_IS_BROADER_THAN_ANY_READER`.
 */
const TOPIC_PREDICATES: Record<string, string> = {
  // What a thing turned out to be / to model
  "http://purl.obolibrary.org/obo/RO_0016002": "has disease",
  "http://gemma.msl.ubc.ca/ont/TGEMO_00171": "induced by",
  "http://purl.obolibrary.org/obo/CLO_0000179": "is disease model for",
  "http://purl.obolibrary.org/obo/CLO_0000015": "derives from patient having disease",
  // Where a line came from
  "http://purl.obolibrary.org/obo/ENVO_01003004": "derives from part of",
  "http://purl.obolibrary.org/obo/CLO_0037210": "derived from cell line",
  "http://purl.obolibrary.org/obo/CLO_0037209": "derived from cell",
};

/** Subject kinds whose origins and associations are knowledge about the
 *  term itself. 🛑 `disease` and `disease model` are deliberately absent
 *  — see condition 3. Compared lowercased: the corpus carries both
 *  `Disease model` and `disease model`. */
const TOPIC_SUBJECT_KINDS = new Set(["cell line", "genotype", "strain"]);

/**
 * Is this a relation worth showing on the card for `activeUri`?
 *
 * `activeUri` is required rather than optional on purpose: the same row
 * is knowledge on one term's card and a listing on another's, so a
 * caller that does not say which card it is filtering for cannot be
 * given a correct answer.
 */
export function isTopicRelation(r: RelationRow, activeUri: string): boolean {
  const active = (activeUri ?? "").trim().toLowerCase();
  if (!active) return false;
  if ((r.subject_uri ?? "").trim().toLowerCase() !== active) return false;
  const kind = (r.subject_category ?? "").trim().toLowerCase();
  if (!TOPIC_SUBJECT_KINDS.has(kind)) return false;
  const uri = (r.predicate_uri ?? "").trim();
  const label = (r.predicate ?? "").trim().toLowerCase();
  return uri in TOPIC_PREDICATES || Object.values(TOPIC_PREDICATES).includes(label);
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
