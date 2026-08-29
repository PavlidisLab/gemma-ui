// Tiny fetch wrapper for the Gemma REST API.
//
// In dev, Vite proxies /rest/* to GEMMA_BASE_URL (no built-in default —
// set via env), so callers just hit relative paths.
//
// Params are serialized with `qs` using `arrayFormat: "repeat"`,
// matching the legacy Vue browser. `credentials: "include"` keeps
// the Spring session cookie for logged-in admin views.

import qs from "qs";

export class ApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly detail: string;
  constructor(message: string, status: number, statusText: string, detail: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.statusText = statusText;
    this.detail = detail;
  }
}

export type Params = Record<string, unknown>;

export interface ApiResponse<T> {
  data: T;
  status: number;
}

async function readErr(r: Response): Promise<string> {
  try {
    const body = await r.clone().json();
    if (body && typeof body === "object" && "error" in body) {
      const e = (body as { error: unknown }).error;
      // Gemma's envelope is `{error: {code, message}}`. Stringifying
      // the object handed the caller `{"code":400,"message":"..."}` —
      // the sentence is in there, wrapped in JSON nobody should have to
      // read. `/annotations/search` started returning a message worth
      // showing verbatim on 2026-08-25 (gemma2 `8b76ee195c`).
      if (e && typeof e === "object" && "message" in e) {
        const m = (e as { message: unknown }).message;
        if (typeof m === "string" && m) return m;
      }
      return typeof e === "string" ? e : JSON.stringify(e);
    }
    return JSON.stringify(body);
  } catch {
    /* not JSON */
  }
  try {
    return await r.text();
  } catch {
    return "";
  }
}

export interface RequestOptions {
  params?: Params;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/** Local-storage key for the opaque bearer minted by
 *  `POST /rest/v2/login`. Read on every request so a sign-in in
 *  one tab is picked up by the next request in another tab. */
const SESSION_TOKEN_KEY = "gemma-browser-session";

export function readSessionToken(): string | null {
  try {
    const raw = localStorage.getItem(SESSION_TOKEN_KEY);
    // Self-heal: a prior commit accidentally wrote the literal
    // string "undefined" via localStorage.setItem(KEY, undefined)
    // on a broken login response unwrap. Treat that as no token
    // and purge it so the bad value doesn't keep being read.
    if (!raw || raw === "undefined" || raw === "null") {
      if (raw) {
        try {
          localStorage.removeItem(SESSION_TOKEN_KEY);
        } catch {
          /* ignore */
        }
      }
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

export function writeSessionToken(token: string | null | undefined): void {
  try {
    // Defensive: refuse to persist anything that isn't a real
    // non-empty string. localStorage.setItem(KEY, undefined)
    // silently stores the literal string "undefined" — bug magnet.
    if (typeof token === "string" && token.length > 0) {
      localStorage.setItem(SESSION_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(SESSION_TOKEN_KEY);
    }
  } catch {
    /* sandboxed env — ignore */
  }
}

/** Compose auth headers. Bearer wins when a session token is set
 *  (REST login flow); otherwise we still ship the session cookie
 *  via `credentials: "include"` so legacy JSP-form-login users
 *  keep working. */
function authHeaders(): Record<string, string> {
  const t = readSessionToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/**
 * 🛑 **Gemma answers an XHR with HTTP 200 even when it failed.**
 *
 * `AbstractExceptionMapper.getResponseBuilder` is explicit about it:
 *
 *     Response.status( isXmlHttpRequest( request ) ? Response.Status.OK
 *                                                  : getStatus( exception ) )
 *
 * and `RestAuthEntryPoint` does the same for 401 (deliberately, together
 * with `WWW-Authenticate: xBasic`, to keep the browser's native
 * basic-auth popup from firing). The trigger is the
 * `X-Requested-With: XMLHttpRequest` header, which every call below
 * sends — a legacy ExtJS convention where the real code travels in the
 * body as `error.code`.
 *
 * So `r.ok` is TRUE for a 400, a 404 and a 401 alike, and a status-only
 * check hands the error envelope back to the caller as if it were data.
 * Measured 2026-08-29 against build `e4e12f906e`: a bad `filter=`
 * returns 200, and the admin page rendered `[object Object]` where a
 * count belonged and `NaN` where it summed them. With the header
 * removed the same request is a clean 400.
 *
 * Keep the header — the 401 popup suppression depends on it — and read
 * the body instead. This is the one chokepoint; do not re-check status
 * per call site.
 */
function errorCodeInBody(body: unknown): number | null {
  if (!body || typeof body !== "object") return null;
  const err = (body as { error?: unknown }).error;
  if (!err || typeof err !== "object") return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === "number" ? code : null;
}

/** Read the JSON body and throw when it is Gemma's error envelope
 *  wearing a 200. Returns the parsed body otherwise. */
async function jsonOrThrow<T>(r: Response, what: string): Promise<T> {
  const body = (await r.json()) as unknown;
  const code = errorCodeInBody(body);
  if (code !== null) {
    const err = (body as { error?: { message?: string } }).error;
    const message = typeof err?.message === "string" ? err.message : "";
    throw new ApiError(
      `${what} → ${code}${message ? ` — ${message}` : ""}`,
      code,
      "",
      message,
    );
  }
  return body as T;
}

export async function apiGet<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const q = opts.params
    ? "?" + qs.stringify(stripUndef(opts.params), { arrayFormat: "repeat" })
    : "";
  const r = await fetch(path + q, {
    method: "GET",
    credentials: "include",
    signal: opts.signal,
    headers: {
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...authHeaders(),
      ...(opts.headers ?? {}),
    },
  });
  if (!r.ok) {
    throw new ApiError(`GET ${path} → ${r.status}`, r.status, r.statusText, await readErr(r));
  }
  return jsonOrThrow<T>(r, `GET ${path}`);
}

/** POST a JSON body. Same auth headers + cookie discipline as apiGet. */
export async function apiPost<T>(
  path: string,
  body: unknown,
  opts: { signal?: AbortSignal; headers?: Record<string, string> } = {},
): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    credentials: "include",
    signal: opts.signal,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...authHeaders(),
      ...(opts.headers ?? {}),
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new ApiError(`POST ${path} → ${r.status}`, r.status, r.statusText, await readErr(r));
  }
  if (r.status === 204) return undefined as T;
  return jsonOrThrow<T>(r, `POST ${path}`);
}

function stripUndef(p: Params): Params {
  const out: Params = {};
  for (const k in p) if (p[k] !== undefined && p[k] !== null && p[k] !== "") out[k] = p[k];
  return out;
}
