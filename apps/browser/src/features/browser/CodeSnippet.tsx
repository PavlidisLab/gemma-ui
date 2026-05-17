// Code-snippet popover with gemmapy / gemma.R / curl / HTTP/1.1 tabs.

import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { compressArg, filterToString, formatNumber } from "@/lib/utils";
import { gemmaUrl } from "@/lib/gemmaConfig";
import type { BrowsingOptions } from "./queries";

const MAX_URL_LENGTH = 2000;
const MAX_DATASETS = 100;

interface Tab {
  label: string;
  language: string;
  content: string;
  note?: string;
}

function escapeStr(q: string) {
  return "'" + q.replace(/['\\]/g, "\\$&") + "'";
}

function buildUrl(query: string | undefined, filter: string, sort: string | undefined) {
  const params = new URLSearchParams();
  if (query !== undefined) params.append("query", query);
  if (filter.length > 0) params.append("filter", filter);
  if (sort !== undefined) params.append("sort", sort);
  params.append("offset", "0");
  params.append("limit", String(MAX_DATASETS));
  return gemmaUrl("/rest/v2/datasets") + "?" + params.toString();
}

export function CodeSnippet({
  browsing,
  total,
}: {
  browsing: BrowsingOptions;
  total: number;
}) {
  const [tab, setTab] = useState(0);
  const [compressedFilter, setCompressed] = useState("");

  useEffect(() => {
    let cancel = false;
    compressArg(filterToString(browsing.filter)).then((c) => {
      if (!cancel) setCompressed(c);
    });
    return () => {
      cancel = true;
    };
  }, [browsing.filter]);

  const filter = filterToString(browsing.filter);
  const query = browsing.query;
  const sort = browsing.sort;

  const uncompressedUrl = buildUrl(query, filter, sort);
  const compressedUrl = buildUrl(query, compressedFilter, sort);

  const tabs: Tab[] = [
    {
      label: "gemmapy",
      language: "python",
      content: (() => {
        const args: string[] = [];
        if (query !== undefined) args.push(`query=${escapeStr(query)}`);
        if (filter.length > 0) args.push(`filter=${escapeStr(filter)}`);
        if (sort !== undefined) args.push(`sort=${escapeStr(sort)}`);
        const call = args.length > 0
          ? `api.get_datasets, ${args.join(", ")}`
          : `api.get_datasets`;
        return [
          "import gemmapy",
          "api = gemmapy.GemmaPy()",
          `data = api.get_all_pages(${call})`,
        ].join("\n");
      })(),
    },
    {
      label: "gemma.R",
      language: "r",
      content: (() => {
        const args: string[] = [];
        if (query !== undefined) args.push(`query = ${escapeStr(query)}`);
        if (filter.length > 0) args.push(`filter = ${escapeStr(filter)}`);
        if (sort !== undefined) args.push(`sort = ${escapeStr(sort)}`);
        return [
          `BiocManager::install("gemma.R")`,
          `library(gemma.R)`,
          `library(dplyr)`,
          `data <- get_datasets(${args.join(", ")}) %>%`,
          `\tgemma.R::get_all_pages()`,
        ].join("\n");
      })(),
    },
    {
      label: "curl",
      language: "bash",
      content: `curl -X 'GET' --compressed -H 'accept: application/json' '${compressedUrl}'`,
      note: `Replace offset to retrieve all pages. seq 0 ${MAX_DATASETS} ${total} for the increments.`,
    },
    {
      label: "HTTP/1.1",
      language: "http",
      content: (() => {
        const u = new URL(compressedUrl);
        return `GET ${u.pathname}${u.search} HTTP/1.1\nHost: ${u.hostname}\nAccept: application/json`;
      })(),
      note: `Replace offset to retrieve all pages. Values: 0 to ${formatNumber(total)} step ${MAX_DATASETS}.`,
    },
  ];

  const active = tabs[tab];

  return (
    <div className="w-[640px] max-w-[90vw] bg-white border border-gemma-grid rounded shadow-lg">
      <div className="flex border-b border-gemma-grid">
        {tabs.map((t, i) => (
          <button
            key={t.label}
            onClick={() => setTab(i)}
            className={`px-3 py-1.5 text-sm ${
              i === tab ? "border-b-2 border-gemma-accent text-gemma-ink" : "text-gemma-subtle"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="p-3">
        {uncompressedUrl.length > MAX_URL_LENGTH ? (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded mb-2">
            The API URL exceeds {MAX_URL_LENGTH} characters — it may not work in some clients.
          </div>
        ) : null}
        <pre className="text-xs bg-gray-50 border border-gemma-grid rounded p-2 overflow-x-auto whitespace-pre">
          <code>{active.content}</code>
        </pre>
        {active.note ? <p className="text-xs text-gemma-subtle mt-2">{active.note}</p> : null}
        <div className="mt-2 flex justify-end">
          <button
            onClick={() => navigator.clipboard.writeText(active.content)}
            className="btn"
            title="Copy snippet"
          >
            <Copy className="h-3.5 w-3.5" /> Copy
          </button>
        </div>
      </div>
    </div>
  );
}
