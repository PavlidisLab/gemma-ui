/**
 * Sequencing QC as annotation strips.
 *
 * 🛑 The gating that matters is "present on EVERY sample". FastQC keys
 * by FASTQ file — per run and per mate — so `percent_duplicates` and
 * `percent_gc` are sample-level in only 5 of 80 reports gembro sampled;
 * everywhere else they sit under `runs[]` and must not be drawn. A
 * gradient with holes in it cannot be read, because a missing
 * measurement and a low one look identical.
 */
import { describe, expect, it } from "vitest";
import { qcStripMetrics, type QcMetrics } from "@/api/qcMetrics";
import { withQcMetricStrips } from "./heatmapPayload";

const sample = (id: number, values: Record<string, number>) => ({
  bio_assay_id: id,
  accession: `GSM${id}`,
  name: `s${id}`,
  outlier: false,
  values,
  runs: [],
  read_count: values.total_reads ?? null,
  read_count_source: "report",
});

const qc = (samples: ReturnType<typeof sample>[]): QcMetrics => ({
  report_present: true,
  metrics: [
    { name: "uniquely_mapped_percent", title: "% Aligned", namespace: "STAR" },
    { name: "percent_duplicates", title: "% Dups", namespace: "FastQC" },
  ],
  samples,
  unmatched_keys: [],
});

const payload = {
  rows: [],
  columns: [
    { bioAssayId: 1, name: "s1", factorValueIds: {} },
    { bioAssayId: 2, name: "s2", factorValueIds: {} },
  ],
  factors: [],
} as never;

describe("qcStripMetrics", () => {
  it("keeps a metric every sample carries", () => {
    const m = qcStripMetrics(
      qc([
        sample(1, { uniquely_mapped_percent: 51 }),
        sample(2, { uniquely_mapped_percent: 60 }),
      ]),
    );
    expect(m.map((x) => x.name)).toEqual(["uniquely_mapped_percent"]);
    expect(m[0].label).toBe("% Aligned");
  });

  it("drops one only SOME samples carry", () => {
    // The 75-of-80 case: FastQC rows live under `runs`, so duplication
    // reaches `values` for a subset at best.
    const m = qcStripMetrics(
      qc([
        sample(1, { uniquely_mapped_percent: 51, percent_duplicates: 32 }),
        sample(2, { uniquely_mapped_percent: 60 }),
      ]),
    );
    expect(m.map((x) => x.name)).toEqual(["uniquely_mapped_percent"]);
  });

  it("names a metric MultiQC left untitled", () => {
    const withReads: QcMetrics = {
      ...qc([sample(1, { total_reads: 10 }), sample(2, { total_reads: 20 })]),
      metrics: [{ name: "total_reads" }],
    };
    expect(qcStripMetrics(withReads)[0].label).toBe("Reads");
  });
});

describe("withQcMetricStrips", () => {
  it("adds one continuous factor per drawable metric, with negative ids", () => {
    const out = withQcMetricStrips(
      payload,
      qc([
        sample(1, { uniquely_mapped_percent: 51 }),
        sample(2, { uniquely_mapped_percent: 60 }),
      ]),
    );
    expect(out!.factors).toHaveLength(1);
    const f = out!.factors[0] as unknown as {
      id: number;
      type: string;
      continuousMeasurements: Record<number, number>;
    };
    // 🛑 Negative so it cannot collide with a real ExperimentalFactor —
    // the widget keys strip identity and grouping off this id.
    expect(f.id).toBeLessThan(0);
    expect(f.type).toBe("continuous");
    expect(f.continuousMeasurements).toEqual({ 1: 51, 2: 60 });
  });

  it("draws nothing when a column has no measurement", () => {
    // Column 2 is absent from the QC response entirely.
    const out = withQcMetricStrips(
      payload,
      qc([sample(1, { uniquely_mapped_percent: 51 })]),
    );
    expect(out!.factors).toHaveLength(0);
  });

  it("leaves a dataset with no report exactly as it was", () => {
    const noReport = { ...qc([]), report_present: false };
    expect(withQcMetricStrips(payload, noReport)).toBe(payload);
    expect(withQcMetricStrips(payload, null)).toBe(payload);
  });
});
