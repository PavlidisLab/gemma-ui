/**
 * The Diagnostics tab's preprocessing footer.
 *
 * Renders the real component with `@/api/workflow` and
 * `@/api/quantitation` mocked, following `HealthChip.test.tsx` — the
 * component's own logic (which QT it describes, which flags it shows)
 * then runs for real against controlled wire shapes.
 *
 * NOT tested here: anything positional. Nothing in this suite renders
 * pixels, so spacing, column widths and dark-mode contrast are not
 * verified by a green run.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/api/workflow", () => ({ usePipelineStatus: vi.fn() }));
vi.mock("@/api/quantitation", () => ({ useQuantitationTypes: vi.fn() }));
vi.mock("@/api/datasetMetadata", () => ({
  useDatasetMetadataFiles: vi.fn(),
  metadataFilePath: (id: number | string, t: string) =>
    `/rest/v2/datasets/${id}/metadata/${t}`,
}));

import { usePipelineStatus } from "@/api/workflow";
import { useQuantitationTypes } from "@/api/quantitation";
import { useDatasetMetadataFiles } from "@/api/datasetMetadata";
import { PreprocessingMetadataFooter } from "./DiagnosticsPanel";

const qt = (over: Record<string, unknown>) => ({
  id: 1,
  name: "rma value - Processed data",
  description: "",
  general_type: "QUANTITATIVE",
  type: "AMOUNT",
  representation: "DOUBLE",
  scale: "LOG2",
  is_background: false,
  is_background_subtracted: false,
  is_batch_corrected: false,
  is_normalized: false,
  is_ratio: false,
  is_recomputed_from_raw_data: false,
  is_preferred: false,
  is_masked_preferred: false,
  vector_type: "ubic.gemma.model.expression.bioAssayData.ProcessedExpressionDataVector",
  ...over,
});

/** Both QTs Gemma marks preferred on a normal dataset — one raw, one
 *  processed. Shape copied from gemma2's answer for eid 1658. */
const RAW_PREF = qt({
  id: 508842,
  name: "rma value",
  is_preferred: true,
  is_masked_preferred: false,
  is_normalized: true,
  vector_type: "ubic.gemma.model.expression.bioAssayData.RawExpressionDataVector",
});
const PROCESSED_PREF = qt({
  id: 508843,
  name: "rma value - Processed data",
  is_preferred: true,
  is_masked_preferred: true,
  is_normalized: true,
  is_background_subtracted: true,
  is_recomputed_from_raw_data: true,
});

function setup(opts: {
  preprocess?: { status: string; last_run: string | null } | null;
  qts?: unknown[] | undefined;
  reports?: unknown[] | undefined;
}) {
  vi.mocked(usePipelineStatus).mockReturnValue({
    data: opts.preprocess === null
      ? undefined
      : { analysis: { preprocessing: opts.preprocess ?? { status: "ok", last_run: null, details: null } } },
  } as never);
  vi.mocked(useQuantitationTypes).mockReturnValue({ data: opts.qts } as never);
  vi.mocked(useDatasetMetadataFiles).mockReturnValue({ data: opts.reports } as never);
  return renderToStaticMarkup(<PreprocessingMetadataFooter experimentId={1658} />);
}

beforeEach(() => vi.resetAllMocks());

describe("PreprocessingMetadataFooter", () => {
  it("describes the PROCESSED preferred QT, not the raw one", () => {
    // 🛑 Both carry `is_preferred`. 120 of 120 datasets sampled on
    // 2026-09-02 had two preferred QTs — one per vector type — so
    // "the preferred QT" is ambiguous and `is_masked_preferred` is
    // the handle that is not.
    const html = setup({ qts: [RAW_PREF, PROCESSED_PREF] });
    expect(html).toContain("rma value - Processed data");
  });

  it("picks the same QT whichever order the list arrives in", () => {
    const a = setup({ qts: [RAW_PREF, PROCESSED_PREF] });
    vi.resetAllMocks();
    const b = setup({ qts: [PROCESSED_PREF, RAW_PREF] });
    expect(a).toBe(b);
  });

  it("shows every recorded flag, including the ones that are false", () => {
    // Dropping the false flags would make "not batch-corrected"
    // indistinguishable from "not recorded" — the whole point of the
    // footer is which of those a reader is looking at.
    const html = setup({ qts: [PROCESSED_PREF] });
    for (const flag of [
      "normalized",
      "background-subtracted",
      "batch-corrected",
      "recomputed from raw",
      "ratio",
    ]) {
      expect(html, `missing flag: ${flag}`).toContain(flag);
    }
    // …and the false ones are struck, not merely absent.
    expect(html).toContain("line-through");
  });

  it("renders no normalization METHOD row — Gemma stores no such name", () => {
    // 🛑 Assert over the row TERMS, not the whole string. A closed
    // `HelpPopup` keeps its body out of the static markup, so a bare
    // `not.toContain("method")` over the markup passes whatever the
    // help text says and stops being about the rows at all.
    const terms = [...setup({ qts: [PROCESSED_PREF] }).matchAll(/<dt[^>]*>(.*?)<\/dt>/g)].map(
      (m) => m[1].toLowerCase(),
    );
    expect(terms).toEqual(["preprocessed", "data", "filtering", "reports"]);
  });

  it("says a step never ran rather than showing an empty date", () => {
    const html = setup({ preprocess: { status: "not_run", last_run: null }, qts: [PROCESSED_PREF] });
    expect(html).toContain("never run");
  });

  it("names the step state when the run has gone stale", () => {
    const html = setup({
      preprocess: { status: "stale", last_run: "2015-08-20T00:34:10.000+00:00" },
      qts: [PROCESSED_PREF],
    });
    expect(html).toContain("stale");
    expect(html).toContain("2015");
  });

  it("states filtering is not recorded — never a zero", () => {
    // A `0` where the field is absent reads as "every row was filtered
    // out", which is the worst available misreading. gembro, 2026-09-02.
    const html = setup({ qts: [PROCESSED_PREF] });
    expect(html).toContain("not recorded for this dataset");
    expect(html).not.toMatch(/>0</);
  });

  it("lists a pipeline report when the dataset has one", () => {
    // Shape from gemma2's own answer for eid 40086.
    const html = setup({
      qts: [PROCESSED_PREF],
      reports: [
        {
          type: "RNASEQ_PIPELINE_REPORT",
          display_name: "RNA-Seq Pipeline Report",
          download_name: "GSE165287.multiqc.report.html",
          content_type: "text/html",
          directory: false,
        },
      ],
    });
    expect(html).toContain("RNA-Seq Pipeline Report");
  });

  it("calls an empty listing normal, not missing", () => {
    // 🛑 Microarray datasets never have one. Saying "not recorded"
    // here would report most of the corpus as defective.
    const html = setup({ qts: [PROCESSED_PREF], reports: [] });
    expect(html).toContain("RNA-seq datasets carry a pipeline report");
    expect(html).not.toContain("not recorded for this dataset\u003c/span\u003e\u003c/dd\u003e\u003c/dl\u003e");
  });

  it("does not render a directory entry as a file to open", () => {
    const html = setup({
      qts: [PROCESSED_PREF],
      reports: [
        { type: "SOME_DIR", display_name: "A folder", directory: true },
      ],
    });
    expect(html).not.toContain("A folder");
  });

  it("survives both endpoints answering nothing", () => {
    const html = setup({ preprocess: null, qts: undefined });
    expect(html).toContain("Preprocessing metadata");
    expect(html).toContain("no preferred quantitation type reported");
  });
});
