/**
 * Per-sample sequencing QC — read depth, mapping rate, duplication —
 * as independent evidence when judging an outlier call.
 *
 * The outlier detector has ONE input: median correlation to the other
 * samples. Mapping rate and duplication do not come from expression
 * similarity at all, so "low correlation AND 51% uniquely mapped" is a
 * different call from "low correlation alone", and until this endpoint
 * nothing could tell a curator which one they were looking at
 * (gembro, 2026-09-02).
 *
 * 🛑 **Display only.** Nothing here feeds
 * `identifyOutliersByMedianCorrelation` — Paul banked that deliberately,
 * because it would change what Gemma flags corpus-wide.
 *
 * 🛑 **`values` is sample-level; `runs` is below it and is NOT summed or
 * averaged.** FastQC keys by FASTQ file, which is per run and per mate,
 * so `percent_duplicates` and `percent_gc` are sample-level in only 5 of
 * 80 reports gembro sampled — everywhere else they sit under `runs`.
 * Collapsing a mate pair needs a per-metric rule (a mean for a rate, a
 * sum for a count) that nobody has written down, so this module reads
 * `values` and leaves `runs` alone rather than inventing one.
 *
 * RNA-seq only: the pipeline writes a MultiQC report for nothing else.
 * A dataset with no report still answers 200 with `report_present:
 * false` and read counts from `BioAssay.sequenceReadCount`, because 82%
 * of GENELIST assays have a read count while fewer than half of
 * datasets have a report. 404 means neither.
 */
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "./client";

export interface QcMetricMeta {
  name: string;
  /** MultiQC's own column header, e.g. "% Aligned". Often null. */
  title?: string | null;
  description?: string | null;
  namespace?: string | null;
  suffix?: string | null;
  min?: number | null;
  max?: number | null;
  hidden?: boolean | null;
}

export interface QcSample {
  bio_assay_id: number;
  accession?: string | null;
  name?: string | null;
  outlier?: boolean | null;
  /** Sample-level metric values, by metric name. */
  values: Record<string, number>;
  /** Per-run rows, deliberately unaggregated. */
  runs?: Array<{ key: string; values: Record<string, number> }> | null;
  read_count?: number | null;
  /** `report` or `bioAssay` — which source the read count came from. */
  read_count_source?: string | null;
}

export interface QcMetrics {
  report_present: boolean;
  metrics: QcMetricMeta[];
  samples: QcSample[];
  /** Report rows that resolved to no bioAssay — usually SRA run ids. */
  unmatched_keys?: string[] | null;
}

/**
 * The metrics worth a strip, in the order they should stack.
 *
 * Read depth and mapping rate are sample-level in 79 of 80 reports;
 * duplication is in 5 of 80, so it is listed but will usually be
 * absent, and `qcStripMetrics` drops what this dataset does not have
 * rather than drawing an empty band.
 */
export const QC_STRIP_METRICS = [
  "uniquely_mapped_percent",
  "percent_duplicates",
  "total_reads",
] as const;

export function useQcMetrics(experimentId: number | string) {
  return useQuery({
    queryKey: ["qc-metrics", experimentId],
    queryFn: async () => {
      try {
        return await api.get<QcMetrics>(
          `/rest/v2/datasets/${experimentId}/qc-metrics`,
        );
      } catch (e) {
        // 404 = neither a report nor read counts. An absence, not a
        // fault: microarray datasets will never have either.
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    enabled: Boolean(experimentId),
    staleTime: 30 * 60_000,
    retry: false,
  });
}

/**
 * The subset of `QC_STRIP_METRICS` this dataset actually carries on
 * EVERY sample, with its display metadata.
 *
 * 🛑 Every sample, not any. A strip drawn from a metric that half the
 * samples lack is a gradient with holes in it, and a reader cannot tell
 * a missing measurement from a low one.
 */
export function qcStripMetrics(
  qc: QcMetrics | null | undefined,
): Array<{ name: string; label: string; meta?: QcMetricMeta }> {
  if (!qc || qc.samples.length === 0) return [];
  const meta = new Map(qc.metrics.map((m) => [m.name, m]));
  const out: Array<{ name: string; label: string; meta?: QcMetricMeta }> = [];
  for (const name of QC_STRIP_METRICS) {
    const everywhere = qc.samples.every(
      (s) => typeof s.values?.[name] === "number" && Number.isFinite(s.values[name]),
    );
    if (!everywhere) continue;
    const m = meta.get(name);
    out.push({ name, label: m?.title || FALLBACK_LABELS[name] || name, meta: m });
  }
  return out;
}

/** MultiQC leaves `title` null on plenty of columns, including
 *  `total_reads`. Naming them here beats showing a raw key. */
const FALLBACK_LABELS: Record<string, string> = {
  total_reads: "Reads",
  uniquely_mapped_percent: "% Aligned",
  percent_duplicates: "% Dups",
};


/**
 * Base for the synthetic factor ids these strips use.
 *
 * 🛑 Negative, like the PC-score strip's `-pc`, because the widget keys
 * strip identity and grouping off the factor id and a positive one
 * could collide with a real `ExperimentalFactor`. Offset well past the
 * PC range so a QC strip and "PC3 score" can coexist on one heatmap.
 */
const QC_FACTOR_ID_BASE = -1000;

/** The synthetic factor id for the nth QC strip. */
export function qcFactorId(index: number): number {
  return QC_FACTOR_ID_BASE - index;
}
