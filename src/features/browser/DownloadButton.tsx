// Bulk TSV download. Streams /datasets in slices of 100, joins, and
// downloads as TSV. URL templates copied verbatim from the Vue version.

import { useRef, useState } from "react";
import { Download, X } from "lucide-react";
import { apiGet } from "@/api/client";
import { compressFilter, downloadAs, formatNumber } from "@/lib/utils";
import type { Dataset, PaginatedResponse } from "@/lib/types";
import type { BrowsingOptions } from "./queries";

const HEADER = [
  "# If you use this file for your research, please cite:",
  "# Lim et al. (2021) Curation of over 10 000 transcriptomic studies to enable data reuse.",
  "# Database, baab006 (doi:10.1093/database/baab006).",
].join("\n");

const SLICE = 100;

function toTsv(rows: Dataset[]): string {
  const cols = ["short_name", "taxon", "title", "number_of_samples", "last_updated"];
  const lines = [cols.join("\t")];
  for (const r of rows) {
    lines.push(
      [
        r.shortName ?? "",
        r.taxon?.commonName ?? "",
        (r.name ?? "").replaceAll("\t", " ").replaceAll("\n", " "),
        String(r.numberOfBioAssays ?? ""),
        r.lastUpdated ?? "",
      ].join("\t"),
    );
  }
  return lines.join("\n");
}

interface Props {
  total: number;
  browsing: BrowsingOptions;
  filterDescription: string;
}

export function DownloadButton({ total, browsing, filterDescription }: Props) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  async function download() {
    if (busy) return;
    setBusy(true);
    setProgress(0);
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const filter = await compressFilter(browsing.filter);
      const slices: Dataset[][] = [];
      let done = 0;
      const offsets: number[] = [];
      for (let i = 0; i < total; i += SLICE) offsets.push(i);

      // run sequentially to be polite; backend handles concurrent fine but no need
      for (const offset of offsets) {
        const r = await apiGet<PaginatedResponse<Dataset>>("/rest/v2/datasets", {
          signal: ctl.signal,
          params: {
            filter,
            offset,
            limit: SLICE,
            sort: browsing.sort,
            query: browsing.query,
          },
        });
        slices.push(r.data ?? []);
        done += SLICE;
        setProgress(Math.min(1, done / total));
      }

      const rows = slices.flat();
      const csv =
        HEADER +
        "\n# " + filterDescription.replace(/\n/g, " ") +
        "\n" + toTsv(rows);

      const ts = new Date().toISOString();
      downloadAs(new Blob([csv], { type: "text/tab-separated-values" }), `datasets_${ts}.tsv`);
    } catch (e) {
      console.error("Download failed", e);
    } finally {
      setBusy(false);
      setProgress(0);
      abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  if (busy) {
    return (
      <button onClick={cancel} className="btn" title="Cancel download">
        <X className="h-4 w-4" />
        <span>{Math.round(progress * 100)}%</span>
      </button>
    );
  }

  return (
    <button onClick={download} disabled={total === 0} className="btn" title={`Download TSV for ${formatNumber(total)} datasets`}>
      <Download className="h-4 w-4" />
      <span>Download TSV</span>
    </button>
  );
}
