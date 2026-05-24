// Tiny fetch wrapper for the Gemma REST API.
//
// In dev, Vite proxies /rest/* to GEMMA_BASE_URL (defaults to
// staging-gemma.msl.ubc.ca), so callers just hit relative paths.
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
  return r.json() as Promise<T>;
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
  return r.json() as Promise<T>;
}

function stripUndef(p: Params): Params {
  const out: Params = {};
  for (const k in p) if (p[k] !== undefined && p[k] !== null && p[k] !== "") out[k] = p[k];
  return out;
}
