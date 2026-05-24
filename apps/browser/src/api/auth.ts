/**
 * Auth surface for the browser app — POST /rest/v2/login,
 * /rest/v2/logout, and the typed `/rest/v2/me` probe.
 *
 * Token discipline: `POST /login` returns `{token, user}` where
 * `token` is an opaque bearer. We stash it in localStorage via
 * `writeSessionToken`; `client.ts` reads it on every outbound
 * fetch and rides it as `Authorization: Bearer <token>`. Sign-out
 * POSTs `/logout` (to give the server a chance to invalidate it)
 * and clears the local copy.
 *
 * The legacy session-cookie path still works in parallel — every
 * request also ships `credentials: "include"` so a curator who
 * signed in via the JSP form on the Gemma webapp keeps working.
 * The two paths are additive, not mutually exclusive.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiGet,
  apiPost,
  ApiError,
  readSessionToken,
  writeSessionToken,
} from "./client";

const BASE = "/rest/v2";

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginUser {
  userName?: string | null;
  email?: string | null;
  groups?: string[] | null;
  /** Tolerate the wider Gemma User shape (id, fullName, etc.) — we
   *  only care about the few fields the AppBar surfaces. */
  [k: string]: unknown;
}

export interface LoginResponse {
  token: string;
  user: LoginUser;
}

export async function postLogin(req: LoginRequest): Promise<LoginResponse> {
  // The /login endpoint isn't enveloped — it returns the bearer +
  // user directly. apiPost handles JSON shape + auth headers.
  return apiPost<LoginResponse>(`${BASE}/login`, req);
}

export async function postLogout(): Promise<void> {
  try {
    await apiPost<void>(`${BASE}/logout`, {});
  } catch (e) {
    // 401 / 404 on logout are survivable — the server has already
    // forgotten this token (or the endpoint isn't deployed on this
    // build). Clear the local copy regardless.
    if (!(e instanceof ApiError) || (e.status !== 401 && e.status !== 404)) {
      throw e;
    }
  }
}

export async function getMe(signal?: AbortSignal): Promise<LoginUser | null> {
  try {
    const body = await apiGet<{ data?: LoginUser } | LoginUser>(`${BASE}/me`, {
      signal,
    });
    if (body && typeof body === "object" && "data" in (body as Record<string, unknown>)) {
      return (body as { data?: LoginUser }).data ?? null;
    }
    return body as LoginUser;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 404)) {
      return null;
    }
    throw e;
  }
}

// ─── Hooks ────────────────────────────────────────────────────────

export function useMe() {
  return useQuery({
    queryKey: ["auth", "me", readSessionToken() ?? "cookie"],
    queryFn: ({ signal }) => getMe(signal),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: postLogin,
    onSuccess: (resp) => {
      writeSessionToken(resp.token);
      // Re-fire the /me probe under the new token, and any other
      // auth-sensitive queries (admin/* in particular).
      qc.invalidateQueries({ queryKey: ["auth"] });
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: postLogout,
    onSettled: () => {
      writeSessionToken(null);
      qc.invalidateQueries({ queryKey: ["auth"] });
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });
}
