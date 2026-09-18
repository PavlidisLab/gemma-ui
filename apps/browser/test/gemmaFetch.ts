/**
 * A stand-in for the Gemma REST API in render tests.
 *
 * The app talks to relative `/rest/v2/…` paths through one `fetch`
 * (`src/api/client.ts`), so replacing `fetch` puts the whole wire under
 * the test's control while the real client, the real query hooks and
 * the real components run. That is the point: these tests are about
 * what a PAYLOAD puts on screen, which is where the app's bugs live.
 *
 * 🛑 An unrouted path answers `{data: []}` and is recorded rather than
 * throwing. Curation's e2e HAR aborts on an uncovered call, which is
 * right there — every call is recorded, so an uncovered one is a stale
 * fixture. Here the opposite is true: a page fetches a dozen optional
 * things (publications, pipeline status, diagnostics) and a spec pins
 * one of them. Erroring on the rest would fill the render with error
 * states and test nothing. What a spec CAN assert is that a call was
 * not made at all — `calls` and `fetched()` are there for exactly that,
 * and the empty envelope is what "the server knows nothing" looks like.
 */
import { gunzipSync } from "node:zlib";
import { vi } from "vitest";

export interface StubRoute {
  /** Matched against the request path + query string. */
  match: RegExp;
  /** Body served verbatim. Wrap payloads in {@link envelope} yourself —
   *  some endpoints answer a bare object and the difference matters.
   *  A function is called per request, for a route whose answer
   *  depends on the filter it was asked (see {@link filterOf}). */
  body: unknown | ((url: string) => unknown);
  status?: number;
}

/**
 * The `filter=` a request carried, as the clause string the app built.
 *
 * `compressArg` (src/lib/utils.ts) gzips + base64s a filter of 150
 * characters or more when that comes out shorter, and two or three
 * clauses get there. Whether a given URL is readable therefore depends
 * on how much else is selected; this reads either form. Returns "" for
 * a request with no filter.
 */
export function filterOf(url: string): string {
  const raw = new URL(url, "http://stub").searchParams.get("filter") ?? "";
  // gzip's magic bytes, base64-encoded.
  if (!raw.startsWith("H4sI")) return raw;
  return gunzipSync(Buffer.from(raw, "base64")).toString("utf8");
}

/** A query-string parameter of a recorded request, or null. */
export function paramOf(url: string, name: string): string | null {
  return new URL(url, "http://stub").searchParams.get(name);
}

/** Gemma's 200 envelope: the payload under `data`, with paging fields
 *  beside it on a collection. */
export function envelope<T>(
  data: T,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { data, ...extra };
}

/** A collection envelope with the paging fields the tables read. */
export function page<T>(rows: T[], totalElements = rows.length) {
  return envelope(rows, {
    offset: 0,
    limit: rows.length,
    totalElements,
    sort: { orderBy: "id", direction: "+" },
  });
}

export interface GemmaFetchStub {
  /** Every URL requested, in order. */
  calls: string[];
  /** URLs no route matched — served as an empty envelope. */
  unmatched: string[];
  /** Was anything matching this pattern requested? */
  fetched: (pattern: RegExp) => boolean;
  /** Every recorded URL matching the pattern, in order. */
  requests: (pattern: RegExp) => string[];
  restore: () => void;
}

export function installGemmaFetch(routes: StubRoute[]): GemmaFetchStub {
  const calls: string[] = [];
  const unmatched: string[] = [];
  const original = globalThis.fetch;

  const stub = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    calls.push(url);
    const route = routes.find((r) => r.match.test(url));
    if (!route) unmatched.push(url);
    const body = !route
      ? envelope([])
      : typeof route.body === "function"
        ? (route.body as (url: string) => unknown)(url)
        : route.body;
    return new Response(JSON.stringify(body), {
      status: route?.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  globalThis.fetch = stub as unknown as typeof fetch;

  return {
    calls,
    unmatched,
    fetched: (pattern: RegExp) => calls.some((u) => pattern.test(u)),
    requests: (pattern: RegExp) => calls.filter((u) => pattern.test(u)),
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
