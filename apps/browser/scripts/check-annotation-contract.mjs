#!/usr/bin/env node
// Re-validate the annotation field names against a LIVE Gemma.
//
// Why this is a script and not a test: the unit suite must not depend on
// a reachable server, and hammering someone else's API from CI is rude.
// So the suite runs on fixtures captured from a real response, and this
// is the thing you run when you want to know whether those fixtures
// still describe reality — before a release, or when the panel looks
// wrong. Four requests, no retries, no loop.
//
// The four fields Gemma renamed with no aliases:
//     className -> category      termName -> value
//     classUri  -> categoryUri   termUri  -> valueUri
//
// Three routes serve them. `21420e9` fixed one and missed two, and the
// miss was silent — an empty facet panel reads as "nothing matched".
// This script's job is to make that loud.
//
//   node scripts/check-annotation-contract.mjs
//   node scripts/check-annotation-contract.mjs --base https://gemma2.msl.ubc.ca --eid 38390
//
// Exits non-zero on the first route whose rows carry neither spelling,
// which is the shape a rename regression takes.

import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    eid: { type: "string", default: "38390" },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log("usage: node scripts/check-annotation-contract.mjs [--base URL] [--eid ID]");
  process.exit(0);
}

/** Same resolution order as vite.config.ts: flag, then GEMMA_BASE_URL
 *  from the shell, then `.env`. No built-in default — pointing this at
 *  a server nobody asked for is exactly the kind of surprise traffic
 *  it shouldn't generate. */
function resolveBase() {
  if (values.base) return values.base;
  if (process.env.GEMMA_BASE_URL) return process.env.GEMMA_BASE_URL;
  try {
    const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
    const m = readFileSync(envPath, "utf8").match(/^\s*GEMMA_BASE_URL\s*=\s*(.+)$/m);
    if (m) return m[1].trim();
  } catch {
    /* no .env — fall through to the error below */
  }
  return null;
}

const rawBase = resolveBase();
if (!rawBase) {
  console.error(
    "no upstream. Pass --base, or set GEMMA_BASE_URL, or put it in apps/browser/.env",
  );
  process.exit(2);
}
const BASE = `${rawBase.replace(/\/+$/, "")}/rest/v2`;

/** Every route that serves the renamed fields, with the OpenAPI schema
 *  it declares — grep the spec for the schema name if a row here starts
 *  looking wrong. */
const ROUTES = [
  {
    schema: "CategoryWithUsageStatisticsValueObject",
    path: "/datasets/categories?limit=5",
    adapter: "withCategoryCompat",
    pairs: [["category", "className"], ["categoryUri", "classUri"]],
    // A category row's URI is legitimately null (the uncategorized
    // rows), so only the label is load-bearing here.
    required: ["category"],
  },
  {
    schema: "AnnotationWithUsageStatisticsValueObject",
    path: `/datasets/annotations?category=${encodeURIComponent("organism part")}&limit=5`,
    adapter: "withAnnotationTermCompat",
    pairs: [
      ["category", "className"],
      ["categoryUri", "classUri"],
      ["value", "termName"],
      ["valueUri", "termUri"],
    ],
    required: ["value"],
  },
  {
    schema: "AnnotationValueObject",
    path: `/datasets/${values.eid}/annotations?includeFreeText=true`,
    adapter: "withDatasetAnnotationCompat",
    pairs: [
      ["category", "className"],
      ["categoryUri", "classUri"],
      ["value", "termName"],
      ["valueUri", "termUri"],
    ],
    required: ["value"],
  },
];

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { redirect: "follow" });
  if (!r.ok) throw new Error(`http ${r.status} ${r.statusText}`);
  return r.json();
}

let failed = false;

console.log(`upstream ${BASE}`);
try {
  const root = await get("/");
  console.log(`gemma   ${root?.data?.version ?? "(no version in root response)"}\n`);
} catch (e) {
  console.log(`gemma   (root unreadable: ${e.message})\n`);
}

for (const route of ROUTES) {
  const label = `${route.schema} — ${route.path.split("?")[0]}`;
  let rows;
  try {
    const body = await get(route.path);
    rows = body?.data ?? [];
  } catch (e) {
    console.log(`✗ ${label}\n    request failed: ${e.message}`);
    failed = true;
    continue;
  }

  if (!rows.length) {
    console.log(`? ${label}\n    no rows came back — can't judge the field names`);
    continue;
  }

  // Which spelling is actually on the wire, per field pair.
  const seen = [];
  for (const [nu, old] of route.pairs) {
    const hasNew = rows.some((row) => nu in row);
    const hasOld = rows.some((row) => old in row);
    seen.push({ nu, old, hasNew, hasOld });
  }

  const missing = seen.filter(
    (f) => route.required.includes(f.nu) && !f.hasNew && !f.hasOld,
  );
  const spelling = seen.some((f) => f.hasNew)
    ? seen.some((f) => f.hasOld)
      ? "both spellings"
      : "new names only"
    : "old names only";

  if (missing.length) {
    failed = true;
    console.log(`✗ ${label}`);
    console.log(
      `    neither spelling present for: ${missing
        .map((f) => `${f.nu}/${f.old}`)
        .join(", ")}`,
    );
    console.log(`    ${route.adapter} cannot populate these — the panel will read blank`);
    console.log(`    a row as served: ${JSON.stringify(rows[0]).slice(0, 220)}`);
  } else {
    console.log(`✓ ${label}`);
    console.log(`    ${rows.length} rows, ${spelling} — ${route.adapter} covers this`);
  }
}

// The one that bit us wasn't a blank label, it was an empty list. Worth
// a look even when every field name checks out.
console.log("");
try {
  const cats = (await get("/datasets/categories?limit=5"))?.data ?? [];
  const ids = cats.map((c) => c.categoryUri || c.category?.toLowerCase() || "");
  const blank = ids.filter((id) => !id).length;
  if (blank) {
    failed = true;
    console.log(`✗ ${blank}/${ids.length} categories yield no usable id`);
    console.log("    getCategoriesWithChildren drops these — the facet panel goes empty");
  } else {
    console.log(`✓ all ${ids.length} categories yield a usable id`);
  }
} catch (e) {
  console.log(`? category ids unchecked: ${e.message}`);
}

process.exit(failed ? 1 : 0);
