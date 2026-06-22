/**
 * Identity helpers for ontology terms.
 *
 * Curation surfaces routinely need to ask "is this the same term?" or
 * "is this the same factor / tag / FV?". The right answer when both
 * sides carry a `uri` is URI equality — labels collide
 * (`"genotype"` shows up in any number of unrelated factors), and
 * case + whitespace drift across producers (`"genotype"` vs
 * `"Genotype"` vs `" genotype "`). Comparing by label without
 * a URI-first check is a low-grade identity bug that misfires on
 * multi-factor-same-category designs (GSE93824 has two `genotype`
 * factors with distinct URIs).
 *
 * Usage convention:
 *   - `sameOntologyTerm(a, b)` for raw `OntologyTerm`-shaped values.
 *   - `sameCategorisedEntity(a, b)` for `{category, value?}` pairs
 *     (tags carry both; factors carry just a category).
 *   - `categorisedKey(x)` when you need a `Set<string>` / `Map` key
 *     for dedup. Always prefer the URI form; fall back to the
 *     normalised label only when the URI is missing.
 *
 * All comparisons trim + lowercase before fallback label match. URI
 * comparison is exact (case-sensitive) — URIs are protocol-stable
 * identifiers and matching them case-insensitively risks false
 * positives across distinct resources that differ only in case.
 */

/** Minimal shape — both `OntologyTerm` (from api/types) and the
 *  design-side term carrier conform. Accepting a structural type
 *  keeps the helper usable from either side without an import
 *  cycle. */
export interface TermLike {
  label?: string | null;
  uri?: string | null;
}

function normLabel(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/** True when both terms refer to the same ontology concept. URI is
 *  the identity field when both sides carry one; otherwise we fall
 *  back to a normalised label comparison. Two terms both missing a
 *  URI and both with empty labels return false (no identity to
 *  compare). */
export function sameOntologyTerm(
  a: TermLike | null | undefined,
  b: TermLike | null | undefined,
): boolean {
  if (!a || !b) return false;
  const au = (a.uri ?? "").trim();
  const bu = (b.uri ?? "").trim();
  if (au && bu) return au === bu;
  // Either or both URIs missing — fall back to label. Both labels
  // must be non-empty for the comparison to be meaningful.
  const al = normLabel(a.label);
  const bl = normLabel(b.label);
  if (!al || !bl) return false;
  return al === bl;
}

/** Stable lookup key for a single ontology term. Returns the URI
 *  (raw) when present, else `lbl:<normalised label>`. Empty string
 *  when the term carries neither — callers should treat empty as
 *  "no usable identity" and skip rather than collide on `""`. */
export function termKey(t: TermLike | null | undefined): string {
  if (!t) return "";
  const u = (t.uri ?? "").trim();
  if (u) return u;
  const l = normLabel(t.label);
  return l ? `lbl:${l}` : "";
}

/** Same identity test for `{category, value}` pairs (tags). Both
 *  sides must agree on category AND value. When only category is
 *  present (factor-shaped), pass `value: null` on both sides. */
export function sameCategorisedEntity(
  a: { category?: TermLike | null; value?: TermLike | null } | null | undefined,
  b: { category?: TermLike | null; value?: TermLike | null } | null | undefined,
): boolean {
  if (!a || !b) return false;
  if (!sameOntologyTerm(a.category ?? null, b.category ?? null)) return false;
  // value of `undefined` on both sides = factor-shaped pair, only
  // category matters. `null` on one but term on the other = mismatch.
  if (a.value === undefined && b.value === undefined) return true;
  return sameOntologyTerm(a.value ?? null, b.value ?? null);
}

/** Stable lookup key for a categorised entity. Joins category +
 *  value keys with `|` so prefixes can't collide
 *  (`cat="a"`/`val="b"` vs `cat="ab"`/`val=""`). */
export function categorisedKey(x: {
  category?: TermLike | null;
  value?: TermLike | null;
}): string {
  const c = termKey(x.category ?? null);
  const v = termKey(x.value ?? null);
  return `${c}|${v}`;
}

/** Display-only sentence-casing for a category label. Ontology
 *  category labels arrive lowercase by convention (`"disease model"`,
 *  `"biological sex"`, `"cell type"`); Paul 2026-06-21 wants them to
 *  read with a leading capital wherever they're shown to the curator
 *  (`"Disease model"`). This is a RENDER transform only — never mutate
 *  the stored label, and never run it through identity / slug / lookup
 *  paths (those stay lowercase via `normLabel`).
 *
 *  Only the first character is uppercased; the rest of the string is
 *  left untouched so multi-word terms and embedded acronyms survive
 *  (`"disease model"` → `"Disease model"`, not `"Disease Model"`;
 *  `"mRNA expression"` keeps its `mRNA`). Empty / null input returns
 *  `""` so callers can keep their own `|| fallback` clause:
 *  `capitalizeCategory(f.category?.label) || "factor name"`. */
export function capitalizeCategory(
  label: string | null | undefined,
): string {
  const s = label ?? "";
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
