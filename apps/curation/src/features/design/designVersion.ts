/**
 * Version facts read defensively off a design payload.
 *
 * None of these are declared on the UI's `Design` type, and that is
 * deliberate: nothing here is authored by the UI, nothing renders as an
 * editable field, and a design that predates any of them is normal
 * rather than broken. They are read where they are needed and nowhere
 * else.
 *
 * 🛑 Two DIFFERENT primitives, and conflating them is the defect this
 * module exists to keep separated:
 *
 *   - **the set name** (`gold_data_version`, `pg500-ceed814d51df`) —
 *     names the BUILD of the curated set a row came from. It moves when
 *     ANY member changes, so it answers "which build produced this" and
 *     can never answer "is this page current". Measured 2026-08-17:
 *     editing one dataset moved it for all 500.
 *   - **the annotation version** (`annotation_version`, `76a6c5b55d9c`)
 *     — names THIS DATASET's curation content. Unprefixed, because a
 *     corpus size is a fact about a corpus and the same dataset in the
 *     400, the 500 or a merged corpus has the same annotation version.
 *
 * A dataset has an annotation version; a set is a manifest of
 * `(dataset → annotation version)` pairs. Staleness is a comparison
 * between two annotation versions and nothing else, ever.
 */

import type { Design } from "@/features/experiment/types";

/** What the baseline holds for THIS dataset — computed by the store at
 *  request time, never stored, so it can never report a freshly-landed
 *  row as stale. */
export interface DesignBaseline {
  /** This dataset's version according to the baseline. `null` = the
   *  baseline is configured but does not contain this dataset (the
   *  store holds 534 base rows against a 500-member set). */
  annotation_version?: string | null;
  /** Why the version is what it is: `sidecar` · `pinned` ·
   *  `unconfigured` · `missing` · `ambiguous` · `unreadable`. Publishes
   *  the REASON, so an absent version is diagnosable rather than
   *  mysterious — a silently dark banner and a correctly quiet one look
   *  identical otherwise. */
  source?: string | null;
  /** The set this baseline IS, for provenance display only. 🛑 Never
   *  compared to anything. It sits inside `baseline` so that stays
   *  structural rather than a convention someone has to remember. */
  set_name?: string | null;
}

function field<T>(design: Design | null | undefined, key: string): T | undefined {
  return (design as unknown as Record<string, T> | null | undefined)?.[key];
}

/**
 * The set-build stamp a design carries, where it carries one.
 *
 * 🛑 Never compare this across designs to decide staleness — see the
 * module note. It identifies the base a row was built from, which is
 * what the commit edit log needs as base identity and what the header
 * chip states.
 */
export function goldDataVersionOf(design: Design | null | undefined): string | null {
  const v = field<unknown>(design, "gold_data_version");
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** This dataset's own curation version, where the row is stamped. Absent
 *  on every stored row until a landing stamps it — and an absent version
 *  is not a stale one. */
export function annotationVersionOf(design: Design | null | undefined): string | null {
  const v = field<unknown>(design, "annotation_version");
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function baselineOf(design: Design | null | undefined): DesignBaseline | null {
  const v = field<unknown>(design, "baseline");
  return v && typeof v === "object" ? (v as DesignBaseline) : null;
}

/**
 * What this page can honestly say about whether it is current.
 *
 *  - `stale` — both annotation versions are present and differ. **The
 *    one real warning**, and the only state that earns a colour.
 *  - `current` — both present and equal.
 *  - `not-in-set` — a baseline is configured and does not hold this
 *    dataset. Not a warning: nothing claims this dataset should match.
 *  - `unknown` — no baseline configured (production), the baseline is
 *    broken, or this row carries no stamp yet. Three different reasons,
 *    one behaviour: say nothing.
 */
export type DesignCurrency = "stale" | "current" | "not-in-set" | "unknown";

export function currencyOf(design: Design | null | undefined): DesignCurrency {
  const baseline = baselineOf(design);
  if (!baseline) return "unknown";
  const source = (baseline.source ?? "").trim();
  if (!source || source === "unconfigured") return "unknown";
  const theirs = (baseline.annotation_version ?? "").trim();
  const ours = annotationVersionOf(design);
  // A configured baseline that does not hold this dataset. Distinct from
  // "we do not know" on purpose — it is an answer, it just is not a
  // warning. Anything other than `sidecar`/`pinned` here means the
  // baseline is broken rather than absent, which is also not a fact
  // about this dataset.
  if (!theirs) {
    return source === "sidecar" || source === "pinned" ? "not-in-set" : "unknown";
  }
  // 🛑 The row's own stamp is the only thing compared against it. An
  // unstamped row is unknown, never stale — that rule is why the store's
  // 34 unstamped base rows render nothing.
  if (!ours) return "unknown";
  return ours === theirs ? "current" : "stale";
}
