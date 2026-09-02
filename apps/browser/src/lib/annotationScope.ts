/**
 * Which annotations the browse surfaces show.
 *
 * `GET /datasets/{id}/annotations` returns three kinds of row, told
 * apart by `objectClass`:
 *
 *   ExperimentTag — an annotation on the experiment itself.
 *   FactorValue   — a level of the experimental design.
 *   BioMaterial   — a characteristic recorded on an individual sample.
 *
 * Only the first two are experiment-level statements about the study.
 * A BioMaterial row is a per-sample characteristic projected up into a
 * flat list, which is why the same fact can arrive twice (dataset 27773
 * carries `strain: mixed C57BL/6J x C3H/HeJ` as both an ExperimentTag
 * and a BioMaterial) and why submitter bookkeeping leaks in beside real
 * annotations — that dataset's BioMaterial rows include a `BioSource`
 * category and a `group` category holding `TDP-15`, `ctrl-PBS`,
 * `TDP-10+12`, `TDP-PBS`. Twelve of its twenty-four rows are
 * BioMaterial, none of them grounded to an ontology term.
 *
 * The per-sample characteristics are still reachable where they belong,
 * on the samples themselves; this governs the flat annotation list only.
 *
 * 🛑 This is a DISPLAY scope, not a fetch scope. The request keeps
 * asking for every annotation (`includeFreeText: true`) — an ungrounded
 * experiment tag is marked as free text, never dropped.
 */
import type { DatasetAnnotation } from "./types";

/** `objectClass` values that describe the experiment as a whole. */
export const EXPERIMENT_LEVEL_OBJECT_CLASSES = [
  "ExperimentTag",
  "FactorValue",
] as const;

/** True when the row is an experiment-level annotation rather than a
 *  characteristic belonging to one sample.
 *
 *  An unrecognised or empty `objectClass` is KEPT. The classes are
 *  Gemma's to extend, and silently swallowing a kind we have not seen
 *  before would hide real annotations with no trace — the failure this
 *  filter is least able to detect. */
export function isExperimentLevelAnnotation(a: DatasetAnnotation): boolean {
  return a.objectClass !== "BioMaterial";
}

/** Partition for callers that want to say how many rows they set
 *  aside rather than silently shrink a count. */
export function splitBySampleScope(annotations: DatasetAnnotation[]): {
  experimentLevel: DatasetAnnotation[];
  perSample: DatasetAnnotation[];
} {
  const experimentLevel: DatasetAnnotation[] = [];
  const perSample: DatasetAnnotation[] = [];
  for (const a of annotations) {
    (isExperimentLevelAnnotation(a) ? experimentLevel : perSample).push(a);
  }
  return { experimentLevel, perSample };
}
