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
  // Bro's /login returns `ResponseDataObject<LoginResponse>` =
  // `{apiVersion, buildInfo, data: {token, user}}` per
  // AuthWebService.java:124. Unwrap the envelope.
  const body = await apiPost<{ data?: LoginResponse } | LoginResponse>(
    `${BASE}/login`,
    req,
  );
  if (body && typeof body === "object" && "data" in (body as Record<string, unknown>)) {
    const inner = (body as { data?: LoginResponse }).data;
    if (!inner || typeof inner.token !== "string") {
      throw new Error("login response missing token");
    }
    return inner;
  }
  // Tolerate a future flat shape, just in case bro un-envelopes
  // it later.
  return body as LoginResponse;
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
      // Bro's /rest/v2/logout only revokes the bearer token (per
      // AuthWebService.java:140) — it does NOT invalidate the
      // HTTP session that Spring sets during /login. Without a
      // hard reload the JSESSIONID cookie keeps /me returning a
      // user. Reload nukes every cached query + tears down the
      // page so the new mount comes up anon (unless the cookie
      // is still server-valid, in which case the user shouldn't
      // see "signed out" — see the matching handoff for the bro
      // /logout-invalidates-session fix).
      try {
        window.location.reload();
      } catch {
        /* SSR / sandbox */
      }
    },
  });
}
