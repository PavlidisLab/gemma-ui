import type { Biomaterial } from "@/features/experiment/types";

/**
 * Dataset-level summary surfaced above the proposal-review panel
 * (sample count, individual count, batch presence). Computed from the
 * biomaterials Gemma already has on the experiment — these are cohort
 * facts, not curator edits, so the saved Design is the canonical
 * source. Originally lived inside ProposalCardV2; extracted here so
 * the per-element ProposalSidebarPanel can render the same strip.
 */
export interface DatasetSummary {
  nSamples: number;
  /** Null = couldn't infer (no canonical individual/subject/donor key
   *  present on per-sample characteristics). */
  nIndividuals: number | null;
  hasBatch: boolean;
  /** Characteristic key that signalled batch presence (lowercased).
   *  Empty when `hasBatch` is false. */
  batchKey: string;
}

const INDIVIDUAL_KEYS = [
  "individual",
  "subject",
  "subject id",
  "subject_id",
  "donor",
  "donor id",
  "donor_id",
  "patient",
  "patient id",
  "patient_id",
];

const BATCH_KEYS = ["batch", "block", "processing batch", "run", "library batch"];

/**
 * Infer dataset-level metadata from per-sample characteristics. Looks
 * for common canonical keys for individual / subject / donor (counts
 * distinct values) and batch (presence only). Permissive about which
 * key counts — checks a fixed list of patterns Gemma uses.
 */
export function summariseDataset(biomaterials: Biomaterial[]): DatasetSummary {
  const out: DatasetSummary = {
    nSamples: biomaterials.length,
    nIndividuals: null,
    hasBatch: false,
    batchKey: "",
  };

  const sampleKeys = new Set<string>();
  for (const b of biomaterials) {
    for (const k of Object.keys(b.characteristics || {})) {
      sampleKeys.add(k.toLowerCase());
    }
  }

  const matchedIndividualKey = INDIVIDUAL_KEYS.find((k) => sampleKeys.has(k));
  if (matchedIndividualKey) {
    const values = new Set<string>();
    for (const b of biomaterials) {
      for (const [k, v] of Object.entries(b.characteristics || {})) {
        if (k.toLowerCase() === matchedIndividualKey && v) {
          values.add(String(v));
        }
      }
    }
    out.nIndividuals = values.size > 0 ? values.size : null;
  }

  const matchedBatchKey = BATCH_KEYS.find((k) => sampleKeys.has(k));
  if (matchedBatchKey) {
    out.hasBatch = true;
    out.batchKey = matchedBatchKey;
  }

  return out;
}

export function MetadataBadge({ summary }: { summary: DatasetSummary }) {
  const parts: { label: string; title: string }[] = [];
  parts.push({
    label: `${summary.nSamples} samples`,
    title: `${summary.nSamples} biomaterials in this experiment`,
  });
  if (summary.nIndividuals !== null) {
    parts.push({
      label: `${summary.nIndividuals} individuals`,
      title: `${summary.nIndividuals} distinct subjects across ${summary.nSamples} biomaterials`,
    });
  }
  if (summary.hasBatch) {
    parts.push({
      label: "has batch info",
      title: `batch annotation present on per-sample characteristic '${summary.batchKey}' — see the design tab`,
    });
  }
  return (
    <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {parts.map((p, i) => (
        <span key={i} title={p.title}>
          {p.label}
          {i < parts.length - 1 ? " ·" : ""}
        </span>
      ))}
    </div>
  );
}
