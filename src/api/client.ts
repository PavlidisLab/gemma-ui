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
      ...(opts.headers ?? {}),
    },
  });
  if (!r.ok) {
    throw new ApiError(`GET ${path} → ${r.status}`, r.status, r.statusText, await readErr(r));
  }
  return r.json() as Promise<T>;
}

function stripUndef(p: Params): Params {
  const out: Params = {};
  for (const k in p) if (p[k] !== undefined && p[k] !== null && p[k] !== "") out[k] = p[k];
  return out;
}
