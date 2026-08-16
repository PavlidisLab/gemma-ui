/**
 * Walk an experiment and collect every (label, URI) pair a curator can
 * see, for `POST /validate-terms`.
 *
 * Why a collector rather than validating at each render site: URIs are
 * scattered across five shapes — experiment tags, tag statements,
 * factor categories, factor-value statements, and the per-biomaterial
 * `characteristic_uris` map — and the endpoint takes one batch per
 * experiment. Assembling the batch is the whole job; the rest of the
 * feature is lookup.
 *
 * Two rules this file exists to enforce:
 *
 * 1. **Dedup by the (label, URI) PAIR, never by URI alone.** The same
 *    term can be stored under two different labels in two places, and
 *    those are two different verdicts — one may be a legitimate
 *    synonym while the other names a different term entirely. That
 *    distinction is the entire point of the feature (`Hek293F` bound
 *    to EFO_0022515, which is `HEK-293S`), so collapsing on URI would
 *    discard exactly the signal we are looking for.
 *
 * 2. **Skip `inferred` tags.** They are projections of sample
 *    characteristics rather than curated claims, and the underlying
 *    characteristic is already collected from the biomaterial side —
 *    including them would double-report one fact and invite a curator
 *    to "fix" a row that isn't editable here.
 */

import type { Design, OntologyTerm, Statement } from "@/features/experiment/types";

import { factorTarget, tagTarget } from "@/features/audit/targetIds";
import { setFactorFields, setStatement, setTagCategory, setTagValue } from "./mutations";

/**
 * Where a term sits in the design, precisely enough to rewrite its
 * label in place.
 *
 * A locator rather than a closure: the draft this was collected from
 * is stale by the time a curator clicks Fix, so the repair has to be
 * re-applied against whatever the draft is *then*. A captured
 * `(design) => design` would silently write against the old one.
 *
 * `sample_characteristic` has no locator on purpose — biomaterial
 * characteristics come off the Gemma import and are not editable here,
 * so it can be reported but not fixed.
 */
export type TermLocator =
  | { kind: "tag_category"; tagId: number }
  | { kind: "tag_value"; tagId: number }
  | { kind: "factor_category"; factorId: number }
  | {
      kind: "statement";
      factorId: number;
      fvId: number;
      index: number;
      slot: "subject" | "object" | "category";
    };

/** One term to validate. `id` is opaque to the agent and echoed back
 *  verbatim, so it doubles as the key we map verdicts onto chips with. */
export interface TermRef {
  id: string;
  label: string;
  uri: string;
  /** Present when the label can be rewritten in place. */
  locator?: TermLocator;
  /** Audit-style target for jump-to-it navigation, when the shell
   *  knows how to route to this shape. */
  targetId?: string;
  /** Where this pair was found — drives the summary's click-through
   *  and lets the curator tell a tag from a sample characteristic. */
  origin:
    | "tag"
    | "tag_statement"
    | "factor"
    | "factor_value_statement"
    | "sample_characteristic";
  /** Human location, e.g. `cell line` or `GSM123 · BioSource`. */
  where: string;
}

/** Key a term by the PAIR. Also the lookup key the verdict store uses,
 *  so a curator editing a label naturally misses the map and the chip
 *  goes unmarked rather than showing a verdict for the old text. */
export function termKey(
  label: string | null | undefined,
  uri: string | null | undefined,
): string {
  return `${(label ?? "").trim()}|${(uri ?? "").trim()}`;
}

/** A term is collectable only when it has BOTH halves. A label with no
 *  URI is free text — legitimate, and not something the ontology index
 *  can have an opinion about. A URI with no label can't be checked for
 *  a label mismatch. */
function collectable(t: OntologyTerm | null | undefined): t is OntologyTerm {
  return Boolean(t && t.label && t.label.trim() && t.uri && t.uri.trim());
}

function pushTerm(
  out: TermRef[],
  seen: Set<string>,
  term: OntologyTerm | null | undefined,
  origin: TermRef["origin"],
  where: string,
  locator?: TermLocator,
  targetId?: string,
): void {
  if (!collectable(term)) return;
  const label = term.label.trim();
  const uri = (term.uri as string).trim();
  const key = termKey(label, uri);
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ id: key, label, uri, origin, where, locator, targetId });
}

function pushStatement(
  out: TermRef[],
  seen: Set<string>,
  s: Statement,
  origin: TermRef["origin"],
  where: string,
  stmt?: { factorId: number; fvId: number; index: number; targetId?: string },
): void {
  const loc = (slot: "subject" | "object" | "category"): TermLocator | undefined =>
    stmt
      ? {
          kind: "statement",
          factorId: stmt.factorId,
          fvId: stmt.fvId,
          index: stmt.index,
          slot,
        }
      : undefined;
  // Subject and object each carry their own URI and can be wrong
  // independently — a correct subject with a mis-bound object is the
  // shape that hides best, because the chip reads plausibly.
  //
  // 🛑 The PREDICATE is deliberately not collected. Predicates are
  // relations (`has_genotype` GENO_0000222, the RO_* and TGEMO_*
  // family), and the ontology index carries classes — so every
  // predicate comes back `unknown`, one noise row per statement, on
  // data that is fine. They also don't need this check: predicates are
  // drawn from the fixed allow-list in `generated/predicates.ts`,
  // synced from the agents repo, so membership already constrains them
  // far more tightly than a label/URI comparison would.
  pushTerm(out, seen, s.subject, origin, `${where} · subject`, loc("subject"), stmt?.targetId);
  pushTerm(out, seen, s.object, origin, `${where} · object`, loc("object"), stmt?.targetId);
  pushTerm(out, seen, s.category, origin, `${where} · category`, loc("category"), stmt?.targetId);
}

/**
 * Every distinct (label, URI) pair on the experiment.
 *
 * Sample characteristics are deduped hard on purpose: one characteristic
 * repeated across 200 biomaterials is one pair and one check. `where`
 * names the first biomaterial it was seen on, with a count when it
 * spans more, so the summary can say "12 samples" without carrying 200
 * rows.
 */
export function collectTerms(design: Design | null | undefined): TermRef[] {
  if (!design) return [];
  const out: TermRef[] = [];
  const seen = new Set<string>();

  for (const tag of design.tags ?? []) {
    // Projections of sample characteristics, not curated claims — the
    // underlying characteristic is collected from the biomaterial side.
    if (tag.inferred) continue;
    const where = tag.category?.label || "tag";
    const tgt = tagTarget(tag.category?.label ?? "", tag.value?.label ?? "");
    pushTerm(
      out, seen, tag.category, "tag", `${where} (category)`,
      { kind: "tag_category", tagId: tag.id }, tgt,
    );
    pushTerm(
      out, seen, tag.value, "tag", where,
      { kind: "tag_value", tagId: tag.id }, tgt,
    );
    // A tag's own statements are not addressable by the factor/fv
    // locator, so they are reported without a Fix.
    for (const s of tag.statements ?? []) {
      pushStatement(out, seen, s, "tag_statement", where);
    }
  }

  for (const factor of design.factors ?? []) {
    const where = factor.category?.label || factor.name || "factor";
    const factorTgt = factorTarget(factor.category?.label ?? factor.name ?? "");
    pushTerm(
      out, seen, factor.category, "factor", `${where} (category)`,
      { kind: "factor_category", factorId: factor.id }, factorTgt,
    );
    for (const fv of factor.factor_values ?? []) {
      const fvWhere = `${where} · ${fv.free_text_label || `FV ${fv.id}`}`;
      (fv.statements ?? []).forEach((s, index) => {
        pushStatement(out, seen, s, "factor_value_statement", fvWhere, {
          factorId: factor.id,
          fvId: fv.id,
          index,
          targetId: factorTgt,
        });
      });
    }
  }

  // Count first so `where` can report the sample span rather than an
  // arbitrary first-seen name on a characteristic every sample carries.
  const sampleSpan = new Map<string, { first: string; n: number }>();
  const sampleTerms: Array<{ term: OntologyTerm; key: string; char: string }> =
    [];
  for (const bm of design.biomaterials ?? []) {
    const uris = bm.characteristic_uris;
    if (!uris) continue;
    for (const [charName, pair] of Object.entries(uris)) {
      const valueLabel = bm.characteristics?.[charName];
      // Only the value side is curator-facing here; `category_uri`
      // binds the characteristic NAME the submitter wrote, which is
      // not a term we ask anyone to correct.
      if (!valueLabel || !pair?.value_uri) continue;
      const term: OntologyTerm = { label: valueLabel, uri: pair.value_uri };
      const key = termKey(term.label, term.uri);
      const prev = sampleSpan.get(key);
      if (prev) {
        prev.n += 1;
      } else {
        sampleSpan.set(key, { first: bm.short_name, n: 1 });
        sampleTerms.push({ term, key, char: charName });
      }
    }
  }
  for (const { term, key, char } of sampleTerms) {
    const span = sampleSpan.get(key)!;
    const where =
      span.n > 1
        ? `${char} · ${span.n} samples`
        : `${char} · ${span.first}`;
    pushTerm(out, seen, term, "sample_characteristic", where);
  }

  return out;
}

/**
 * Rewrite a term's label to the canonical one the validator reported,
 * leaving the URI untouched.
 *
 * The URI is the authority and the label is what disagreed with it, so
 * this is a relabel, never a rebind. If the binding itself is wrong —
 * `BRM` pointing at doxycycline — relabelling it to "doxycycline"
 * would make the annotation *look* right while staying wrong, so the
 * curator has to re-pick the term instead. That is why this is offered
 * per row rather than as a fix-everything button.
 *
 * Guarded: applies only when the label still matches what was
 * validated. A draft edited between the run and the click no longer
 * has a claim attached to it, and rewriting on a stale verdict is
 * exactly the silent-corruption shape this whole feature exists to
 * catch. Returns `null` when it cannot safely apply.
 */
export function applyLabelFix(
  design: Design,
  ref: TermRef,
  canonicalLabel: string,
): Design | null {
  const next = canonicalLabel.trim();
  if (!next) return null;
  return applyTermPatch(design, ref, { label: next });
}

/**
 * Re-point a term at the successor the ONTOLOGY declares for it, label
 * and URI together.
 *
 * The one rebind this file permits, and only because the authority for
 * it is the same authority `applyLabelFix` defers to. An `obsolete`
 * verdict carries `replaced_by` straight from the source — the
 * ontology saying "this term became that one" — so following it is
 * obeying the binding, not overruling it. `disease` / `EFO_0000408`
 * (deprecated) → `MONDO_0000001`.
 *
 * Still never a guess: a deprecated term with no declared successor
 * gets no button, because picking a replacement is a curation
 * judgement and the panel doesn't get to make it.
 *
 * Same staleness guard as a relabel — applies only while the slot
 * still holds the pair that was validated.
 */
export function applyTermRebind(
  design: Design,
  ref: TermRef,
  replacement: { label: string; uri: string },
): Design | null {
  const label = replacement.label.trim();
  const uri = replacement.uri.trim();
  if (!label || !uri) return null;
  return applyTermPatch(design, ref, { label, uri });
}

/** Shared locator walk for both repairs. Kept private so every write
 *  goes through one staleness check — two copies of this switch is how
 *  one of them ends up writing on a stale verdict. */
function applyTermPatch(
  design: Design,
  ref: TermRef,
  patch: { label: string; uri?: string },
): Design | null {
  const loc = ref.locator;
  const next = patch.label;
  const rebind = patch.uri ? { uri: patch.uri } : {};
  if (!loc || !next) return null;

  switch (loc.kind) {
    case "tag_category": {
      const tag = design.tags?.find((t) => t.id === loc.tagId);
      if (!tag || termKey(tag.category?.label, tag.category?.uri) !== ref.id) {
        return null;
      }
      return setTagCategory(design, loc.tagId, {
        ...tag.category,
        label: next,
        ...rebind,
      });
    }
    case "tag_value": {
      const tag = design.tags?.find((t) => t.id === loc.tagId);
      if (!tag || termKey(tag.value?.label, tag.value?.uri) !== ref.id) {
        return null;
      }
      return setTagValue(design, loc.tagId, {
        ...tag.value,
        label: next,
        ...rebind,
      });
    }
    case "factor_category": {
      const factor = design.factors?.find((f) => f.id === loc.factorId);
      if (
        !factor ||
        termKey(factor.category?.label, factor.category?.uri) !== ref.id
      ) {
        return null;
      }
      return setFactorFields(design, loc.factorId, {
        category: { ...factor.category, label: next, ...rebind },
      });
    }
    case "statement": {
      const factor = design.factors?.find((f) => f.id === loc.factorId);
      const fv = factor?.factor_values?.find((v) => v.id === loc.fvId);
      const stmt = fv?.statements?.[loc.index];
      const slotTerm = stmt?.[loc.slot];
      if (!stmt || !slotTerm || termKey(slotTerm.label, slotTerm.uri) !== ref.id) {
        return null;
      }
      return setStatement(design, loc.factorId, loc.fvId, loc.index, {
        ...stmt,
        [loc.slot]: { ...slotTerm, label: next, ...rebind },
      });
    }
    default:
      return null;
  }
}

/**
 * Whether a term label is a bare catalogue accession rather than a name
 * a person would use — `RCB4455 cell`, `CVCL_0132`, `ACC 305 cell`.
 *
 * Cell-line registries (RIKEN RCB, JCRB, Coriell GM/AG, DSMZ ACC,
 * Cellosaurus CVCL) often hold the accession as the CLO primary label
 * while the name everyone actually says — `PC-9`, `KGN` — is a
 * synonym. Telling a curator their label is wrong and the real term is
 * `RCB4455 cell` is technically true and unusable: they cannot check
 * it, and it reads as a bug rather than as advice.
 *
 * Used to decide when to show the human synonyms alongside. Kept
 * deliberately narrow — a false positive here only adds a helpful
 * "(also: …)", but a false negative on a real name would clutter every
 * row.
 */
export function isBareAccessionLabel(label: string | null | undefined): boolean {
  const s = (label ?? "").trim();
  if (!s) return false;
  // Registry prefix + digits, optionally followed by " cell".
  if (/^(RCB|JCRB|IFO|ACC|CVCL|GM|AG|HTB|CRL|CCL)[\s_-]?\d+/i.test(s)) return true;
  // A label that is nothing but punctuation, digits and a trailing
  // "cell" carries no name at all.
  if (/^[\d\s_.-]+(cell)?$/i.test(s)) return true;
  return false;
}
