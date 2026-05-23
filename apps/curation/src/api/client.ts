/**
 * Tiny fetch wrapper for the curation REST API.
 *
 * The Vite dev server proxies /rest/* to GEMMA_CURATION_URL (mock or real),
 * so callers just hit relative paths.
 *
 * Auth: prefers the session token stored by `useLogin` (lives in
 * localStorage). When no session is active, falls back to the
 * build-time `VITE_GEMMA_CURATION_API_KEY` — useful for local dev
 * before login support landed; production should rely on session
 * tokens.
 */

const STORAGE_KEY = "gemma-curation-session";

/**
 * Typed fetch error. Use ``err instanceof ApiError`` to type-narrow
 * and read ``.status`` for status-specific UI (e.g. 404 → "endpoint
 * not yet available", 409 → "already in flight"). ``detail`` carries
 * whatever the server put in the body (``{detail: "..."}`` for
 * FastAPI, raw text otherwise).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly detail: string;
  constructor(
    message: string,
    status: number,
    statusText: string,
    detail: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.statusText = statusText;
    this.detail = detail;
  }
}

export function bearerToken(): string {
  // Session tokens win — set by useLogin via saveStoredSession.
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.token === "string") return parsed.token;
    }
  } catch {
    /* fall through */
  }
  return import.meta.env.VITE_GEMMA_CURATION_API_KEY ?? "";
}

/** Extract the most useful error text from a non-OK response.
 *  Tries JSON ``{detail}`` first (FastAPI's idiom), falls back to
 *  the raw text. Returns ``""`` on parse failure. */
async function readErrorBody(r: Response): Promise<string> {
  try {
    const body = await r.clone().json();
    if (body && typeof body === "object" && "detail" in body) {
      const d = (body as { detail: unknown }).detail;
      return typeof d === "string" ? d : JSON.stringify(d);
    }
    return JSON.stringify(body);
  } catch {
    /* not JSON; fall through to text */
  }
  try {
    return await r.text();
  } catch {
    return "";
  }
}

/** Convert a single camelCase key to snake_case.
 *
 *  Bro's mock now emits camelCase on the wire for design / workflow /
 *  calibration / permissions schemas (GEMMA_WIRE_ALIGNMENT_HANDOFF.md
 *  phase-2a, 2026-05-13). Audit + proposer + curationDetails +
 *  auditEvents stay snake_case for now. Rather than mass-rename TS
 *  types before the Friday demo, normalise incoming responses to
 *  snake_case at the API client boundary — UI keeps reading the
 *  fields it already knows.
 *
 *  Idempotent on already-snake_case keys (no uppercase = regex
 *  doesn't fire). Drop the adapter once the UI's TS interfaces are
 *  swept to camelCase — see same handoff doc.
 *
 *  Exported so SSE parsers can apply the same transform per-event,
 *  letting the audit/propose stream envelope flip from snake to
 *  camel without UI lockstep (GEMMA_WIRE_ALIGNMENT_HANDOFF.md
 *  phase-2c).
 */
function snakifyKey(key: string): string {
  // Skip prose-shaped dict keys — biomaterial.characteristics is the
  // canonical example, where Gemma's import surfaces user-facing
  // strings like "BioSource", "GEO Sample characteristic", "Genetic
  // modification" as dict KEYS, not API field names. Pre-fix the
  // generic replace mangled these into "_bio_source" /
  // "_g_e_o_sample_characteristic" which rendered as gibberish in
  // the TagBar.
  //
  // Heuristic: legitimate camelCase wire fields always start with a
  // lowercase letter and never contain whitespace. Anything else is
  // either prose (skip) or already snake_case / lowercase (the
  // regex doesn't fire anyway, so the early-out is just an optimization).
  if (/\s/.test(key)) return key;
  if (/^[A-Z]/.test(key)) return key;
  return key.replace(/([A-Z])/g, (_, ch) => `_${(ch as string).toLowerCase()}`);
}

export function snakeify(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(snakeify);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[snakifyKey(k)] = snakeify(v);
  }
  return out;
}

async function request<T>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const token = bearerToken();
  const r = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = await readErrorBody(r);
    throw new ApiError(
      `${method} ${path} failed: ${r.status} ${r.statusText}${
        detail ? ` — ${detail}` : ""
      }`,
      r.status,
      r.statusText,
      detail,
    );
  }
  if (r.status === 204) return undefined as T;
  const json = await r.json();
  // Gemma 2.0 wraps every payload in a standard envelope:
  // ``{ apiVersion, buildInfo, data: <payload> }``. local_api
  // returned the payload directly. Auto-unwrap on Gemma's envelope
  // so all the existing callers (which expect the bare payload type
  // ``T``) keep working against either backend without touching
  // every endpoint. Detection is conservative: require BOTH the
  // ``apiVersion`` sentinel AND a ``data`` field so a bare payload
  // that happens to expose ``data`` (rare; the curation domain
  // doesn't currently) isn't accidentally unwrapped.
  const unwrapped = unwrapGemmaEnvelope(json);
  return snakeify(unwrapped) as T;
}

function unwrapGemmaEnvelope(json: unknown): unknown {
  if (
    json &&
    typeof json === "object" &&
    !Array.isArray(json) &&
    "apiVersion" in (json as Record<string, unknown>) &&
    "data" in (json as Record<string, unknown>)
  ) {
    return (json as Record<string, unknown>).data;
  }
  return json;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
