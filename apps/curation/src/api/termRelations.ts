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
import { PREDICATES } from "@/generated/predicates";
import { curieToUrl } from "@/lib/curie";

/**
 * The grouping key for a row's predicate — its URI's SANCTIONED LABEL
 * when we can resolve one, its own label otherwise.
 *
 * 🛑 A predicate's label is vocabulary and moves; its URI is identity.
 * Three sanctioned labels were corrected to their source ontologies'
 * own on 2026-08-21 (`derived from cell line` → `derives from cell line
 * cell` CLO_0037210, `toward` → `towards` RO_0002503, `is model of` →
 * `has role in modeling` RO_0003301), and the stored rows were
 * deliberately NOT migrated with them: `ANNOTATION_RELATION` is rebuilt
 * by its producer and picks up the new spelling on re-harvest, while
 * the `CHARACTERISTIC` rows need an UPDATE that is held while Gemma 1.0
 * shares the production database. So one predicate arriving under two
 * spellings is the PLANNED intermediate state, not an anomaly.
 *
 * Keyed on the raw label, that state splits one predicate into two
 * groups — which shows a claim twice in the dedup, and silently stops
 * the crowding guard firing, since each half then sits under the
 * per-predicate ceiling.
 *
 * Resolving through the URI rather than keying on it directly is what
 * keeps a row that carries no `predicate_uri` behaving exactly as
 * before: it keys on its own label, as it always did.
 *
 * ⚠️ It resolves only the predicates the CURATION allow-list carries
 * (23). Gemma sanctions 29, so a derived row can name one we don't —
 * `has role in modeling` (RO_0003301) is the third relabel and is not
 * ours. Those still key on the label and would still split. Left that
 * way rather than widened: RO_0003301 has zero stored rows, and the
 * allow-list is a curation decision, not a rendering one. If a Gemma-
 * only predicate ever splits a card, the fix is a table of Gemma's 29,
 * not a second spelling bolted on here.
 */
function predicateKey(
  label: string | null | undefined,
  uri: string | null | undefined,
): string {
  const u = (uri ?? "").trim();
  if (u) {
    const canonical = curieToUrl(u) ?? u;
    const known = PREDICATES.find((p) => p.uri === canonical);
    if (known) return known.label.trim().toLowerCase();
  }
  return (label ?? "").trim().toLowerCase();
}

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

/** How a `source` token reads inside a sentence.
 *
 *  The wire spells sources as identifiers — `CELLOSAURUS`, `CLO`, `MGI`.
 *  A badge can show that verbatim; a tooltip that reads "inferred from X
 *  via CELLOSAURUS" shouts. Only resources whose name is a WORD are
 *  cased here — an acronym is already written the way it is read, and
 *  title-casing `CLO` would invent a name nobody uses.
 *
 *  Unknown tokens pass through untouched: a source we have never seen is
 *  shown as the producer spelled it, never guessed at. */
const SOURCE_DISPLAY_NAMES: Record<string, string> = {
  CELLOSAURUS: "Cellosaurus",
};

export function sourceDisplayName(source: string | null | undefined): string {
  const raw = (source ?? "").trim();
  return SOURCE_DISPLAY_NAMES[raw.toUpperCase()] ?? raw;
}

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
  /** What the source itself said, verbatim, where the row is a reading
   *  of a record rather than the record itself. Cellosaurus files
   *  `A-549 derives from patient having disease lung adenocarcinoma`
   *  with `NCIT:C3512 Lung adenocarcinoma` here — the attribution a
   *  curator wants before taking a third party's word, and origin
   *  rather than judgement, which is the only thing this surface
   *  shows. Null on `ONTOLOGY` rows: a restriction is its own evidence.
   *  🛑 Where it merely REPEATS the object, the producer has not
   *  resolved that object's label — see the note on `object`. */
  evidence?: string | null;
  /** 🛑 `ASSERTED` or `REFUTED`, and `REFUTED` is **not a withdrawn
   *  claim** — nobody took anything back. It is a source publishing the
   *  NEGATIVE: MGI's not-disease report, the only producer writing them
   *  today, says a genotype was found not to model the disease it
   *  names. A denial is a finding, not an erratum.
   *
   *  `Pax3<Sp-2H>` is the proof and it carries both at once — asserted
   *  for Waardenburg syndrome type **1**, refuted for type **3**, same
   *  predicate, same four citations, because those papers are what
   *  established which it is. Nothing here is a correction of anything.
   *
   *  What that costs a reader: the row still carries an assertive
   *  implied triple (`is model of`), so rendering it as written states
   *  the negative as a claim. {@link topicRelations} drops them.
   *  What it is worth: a term that looks empty may be one something
   *  negative is known about — Waardenburg type 3 returns zero rows
   *  by default and four denials with `includeRefuted=true`. */
  status?: "ASSERTED" | "REFUTED" | (string & {}) | null;
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
  /** Distinct objects this SUBJECT relates to, corpus-wide — the mirror
   *  of `object_breadth`, added 2026-08-18 at our ask. Typed because it
   *  is on the wire and a consumer will want it; the card does NOT key
   *  on it, and that is worth stating: `imatinib` and a generic iPSC
   *  class both relate to ~a dozen objects, so the number does not
   *  separate "a compound with many roles" from "a class listing its
   *  members". What separates them is the OBJECT's breadth — see
   *  {@link topicRelations}. */
  subject_breadth?: number | null;
  /** Identifies the DERIVED CLAIM, null where a row licenses none.
   *  Folds `BRCA1 --has disease--> breast cancer` together with
   *  `breast cancer --has_genotype--> BRCA1`, which `triple_key`
   *  cannot, and correctly keeps `is model of` and `has disease` apart
   *  because those are two claims rather than one rendered twice. */
  implied_triple_key?: string | null;
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
    // `implied_triple_key` when the server mints one — it identifies the
    // DERIVED CLAIM, which is what a reader sees. The label fallback is
    // for rows that license nothing (no key) and for any backend that
    // predates the field.
    r.implied_triple_key?.trim()
      ? `${r.basis}|${r.implied_triple_key.trim()}`
      : [
          r.basis,
          (r.implied_subject ?? r.subject ?? "").trim().toLowerCase(),
          predicateKey(
            r.implied_predicate ?? r.predicate,
            r.implied_predicate_uri ?? r.predicate_uri,
          ),
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
 *
 * There was a second one, for a day: a tie-break inside runs the server
 * left equal. Every asserted row carries support 0, so `imatinib`'s ten
 * CHEBI roles arrived tied and the tie fell to alphabetical —
 * `antihypertensive agent` (487 chemicals bear it) first and `tyrosine
 * kinase inhibitor` (44, the one that identifies the compound) tenth,
 * behind a "+5 more". We sorted those runs by `object_breadth` and
 * asked for it at the API boundary instead, because every consumer of
 * `?limit=` wants it and a gate wants the specific end first for the
 * same reason a card does. Shipped server-side 2026-08-18 and measured
 * on build `a18e488faf`: imatinib arrives 44, 138, 139, 245, 327, 344,
 * 411, 487, 636, 5326, and Alzheimer's support-1 run 1, 1, 1, 1, 3, 4,
 * 13, 15, 37, 2898 — ascending inside each tie, never across one. So
 * the client sort is deleted rather than left as a redundant copy: it
 * ran AFTER the merge, on post-merge support, and could therefore
 * re-order rows the server had placed deliberately.
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
 * How many objects one predicate may name before the card is enumerating.
 *
 * A generic CLASS relates to everything filed under it, and a compound
 * carries every role anyone has reported for it. Both arrive as one
 * predicate with a dozen objects, and neither is a dozen facts.
 */
const MAX_OBJECTS_PER_PREDICATE = 3;

/**
 * In a crowded predicate group, which objects are PROPERTIES rather than
 * instances.
 *
 * 🛑 The signal is the object's breadth, not the subject's. Measured:
 * `imatinib` relates to 11 objects and the generic `induced pluripotent
 * stem cell line cell` to ~15, so `subjectBreadth` — which we asked for
 * and which is now on the wire — does not separate them. What does:
 *
 *  - a **member** appears nowhere else. `201B7`, `585A1`, `Detroit 551
 *    cell` each have `objectBreadth: 1`: the only thing they relate to
 *    is the class listing them. An instance, not a fact about the term.
 *  - a **property** is shared. Every CHEBI role on imatinib is borne by
 *    44 to 5,326 other chemicals, and `iPSC line derived from cell →
 *    fibroblast` (12) is a real statement about iPSC lines.
 *
 * So in a group too big to be facts, keep what is shared and drop what
 * is singular. On the iPSC class that deletes the line names and leaves
 * `derived from cell → fibroblast · embryonic fibroblast · neural stem
 * cell`, which is the useful half of the same rows.
 */
function isSharedObject(r: RelationRow): boolean {
  const b = r.object_breadth;
  // 🛑 Unknown breadth keeps the row. `0` is impossible by construction,
  // so it means the lookup missed, and an omitted field is an older
  // backend — neither is evidence of a singleton.
  if (b === null || b === undefined || b === 0) return true;
  return b > 1;
}

export function topicRelations(
  rows: readonly RelationRow[],
  activeUri: string,
): RelationRow[] {
  if (isDiseaseTerm(rows, activeUri)) return [];
  // 🛑 A refutation is not a quiet row — it is a row that says the
  // opposite. MGI reports genotypes that do NOT model a disease, and
  // those arrive as `status: "REFUTED"` carrying the same assertive
  // implied triple as any other row (`X is model of Y`). Rendered under
  // a header that says these are known facts about the term, that
  // states MGI's finding backwards. The wire hands us no negated
  // reading to render instead, so the card stays silent rather than
  // confident and wrong; asked the backend how a refutation should
  // read. Unknown/absent status is treated as asserted — an older
  // deployment omits the field, and dropping every row on a missing
  // one would delete the whole surface.
  const stated = rows.filter((r) => (r.status ?? "ASSERTED") !== "REFUTED");
  const mine = stated.filter((r) => impliesFrom(r, activeUri));
  const groups = new Map<string, RelationRow[]>();
  for (const r of mine) {
    const k = predicateKey(
      r.implied_predicate ?? r.predicate,
      r.implied_predicate_uri ?? r.predicate_uri,
    );
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: RelationRow[] = [];
  for (const rows_ of groups.values()) {
    if (rows_.length <= MAX_OBJECTS_PER_PREDICATE) {
      out.push(...rows_);
      continue;
    }
    // Too many to be facts: keep the shared objects, then the most
    // specific of those. Dropping the whole group was the earlier rule
    // and it was wrong on `imatinib`, where the one role that
    // identifies the compound would have gone with the nine that do not.
    out.push(
      ...rows_
        .filter(isSharedObject)
        .sort((a, b) => (a.object_breadth ?? 0) - (b.object_breadth ?? 0))
        .slice(0, MAX_OBJECTS_PER_PREDICATE),
    );
  }
  // Preserve the order the rows arrived in — the server's — with the
  // group members re-inserted where they were.
  const keep = new Set(out);
  return mine.filter((r) => keep.has(r));
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


/** How many rows an experiment's inferred-concepts row will ever show.
 *  Well above what the fan-out bar leaves (32% retention corpus-wide,
 *  7 rows on the richest dataset measured), so it is a guard rather
 *  than a display cap. */
const INFERRED_LIMIT = 100;

/**
 * What Gemma can infer about an EXPERIMENT from its own annotations.
 *
 * 🛑 **`seedDirection=SUBJECT_TO_OBJECT` is sent explicitly and must
 * stay.** The server default is `OBJECT_TO_SUBJECT`, which returns
 * nothing for 22 of 29 datasets sampled — measured on GSE28044, the
 * default gives 1 row where this gives 7. An earlier handoff said to
 * leave the default alone; that advice predates the cut-off rules and
 * is wrong. Omitting this reads as "nothing to infer" on most
 * experiments.
 *
 * 🛑 **The result is APPROXIMATE and the UI must say so.** The server
 * applies a fan-out bar (`maxSubjectBreadth`, default 3 on the dataset
 * walk) that drops any subject relating to more than three objects under
 * one predicate. It is a heuristic aimed at ChEBI role closures — on
 * GSE28044 it drops 19 of 26 rows, mostly `has role` — and it will drop
 * true relations whose subject happens to be broad.
 *
 * ⚠️ Empty is the COMMON case, not a failure: whole datasets legitimately
 * infer nothing once the vehicle-control role noise is barred (GSE315959
 * went 195 rows → 0, which is the right answer for it).
 *
 * Routed to the ontology host by the existing `/rest/v2/annotations/*`
 * proxy exception, so this needs no relay.
 */
export function useDatasetInferredConcepts(
  experimentId: number | string | null | undefined,
  enabled: boolean = true,
) {
  return useQuery<RelationRow[]>({
    queryKey: ["dataset-inferred-concepts", String(experimentId ?? "")],
    enabled: enabled && experimentId != null && experimentId !== "",
    queryFn: async () => {
      const params = new URLSearchParams({
        dataset: String(experimentId),
        seedDirection: "SUBJECT_TO_OBJECT",
        limit: String(INFERRED_LIMIT),
      });
      const res = await api.get<RelationRow[] | { data?: RelationRow[] }>(
        `/rest/v2/annotations/relations?${params.toString()}`,
      );
      const rows = Array.isArray(res) ? res : (res?.data ?? []);
      return Array.isArray(rows) ? rows : [];
    },
    // Moves when the maintenance job runs, not while a curator reads.
    staleTime: 30 * 60_000,
    retry: false,
  });
}
