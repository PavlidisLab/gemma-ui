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
  /** Spring Security authority names — e.g. ``["GROUP_ADMIN",
   *  "GROUP_USER"]`` plus any per-UserGroup authority the server
   *  appends. Populated by ``RootWebService.UserValueObject`` (see
   *  gemma-rest commit 4a9605c23f, 2026-06-07). Used by the
   *  Administration nav-tab visibility gate in AppBar / Footer. */
  authorities?: string[] | null;
  /** Tolerate the wider Gemma User shape (id, fullName, etc.) — we
   *  only care about the few fields the AppBar surfaces. */
  [k: string]: unknown;
}

export interface LoginResponse {
  token: string;
  user: LoginUser;
}

export async function postLogin(req: LoginRequest): Promise<LoginResponse> {
  // The agents-side /login returns `ResponseDataObject<LoginResponse>` =
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
  // Tolerate a future flat shape, just in case the agents side un-envelopes
  // it later.
  return body as LoginResponse;
}

/**
 * Multi-target logout. The JSESSIONID cookie is HttpOnly (per
 * `gemma-web/.../web.xml:282-288`) so JS can't delete it
 * client-side; only the server can invalidate the session.
 *
 * Three things stack up here, in priority order:
 *   1. POST /rest/v2/logout — revokes the bearer token
 *      (AuthWebService.java:140).
 *   2. POST /logout — Spring Security 6.5.1's default
 *      LogoutFilter URL. Gemma's <s:logout/> in
 *      `applicationContext-security.xml:73` declares no
 *      `logout-url`, so /logout is what's wired. THIS is what
 *      invalidates the HttpSession and clears JSESSIONID.
 *   3. POST /j_spring_security_logout — legacy Spring 3 URL.
 *      Kept as a fallback for any deployment that still wires it
 *      (Gemma's web.xml still references it for CORS).
 *
 * All three fire fire-and-forget via Promise.allSettled.
 * Whichever path your deployment honors wins.
 *
 * Once the backend lands `session.invalidate()` inside
 * /rest/v2/logout itself, paths 2 and 3 can be dropped.
 */
export async function postLogout(): Promise<void> {
  const bearerCall = apiPost<void>(`${BASE}/logout`, {}).catch((e) => {
    if (e instanceof ApiError && (e.status === 401 || e.status === 404)) {
      return;
    }
    throw e;
  });
  const springLogout = fetch("/logout", {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json,text/plain,*/*" },
  }).catch(() => undefined);
  const legacyLogout = fetch("/j_spring_security_logout", {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json,text/plain,*/*" },
  }).catch(() => undefined);
  await Promise.allSettled([bearerCall, springLogout, legacyLogout]);
}

export async function getMe(signal?: AbortSignal): Promise<LoginUser | null> {
  try {
    const body = await apiGet<{ data?: LoginUser } | LoginUser>(`${BASE}/me`, {
      signal,
    });
    const user =
      body && typeof body === "object" && "data" in (body as Record<string, unknown>)
        ? ((body as { data?: LoginUser }).data ?? null)
        : (body as LoginUser);
    return treatEmptyAsAnonymous(user);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 404)) {
      return null;
    }
    throw e;
  }
}

/** Defensive: some Gemma deployments / build versions return a
 *  truthy-but-empty user object when /me is hit with stale auth
 *  (cookie present, but the session-attached principal has no
 *  populated fields). Treat anything without a userName or email
 *  as "not really signed in" so the AppBar doesn't render
 *  "Signed in as (signed in)" — which looks like a bug to the
 *  curator even if technically /me did return data. */
function treatEmptyAsAnonymous(u: LoginUser | null): LoginUser | null {
  if (!u || typeof u !== "object") return null;
  const userName =
    typeof u.userName === "string" ? u.userName.trim() : "";
  const email = typeof u.email === "string" ? u.email.trim() : "";
  if (!userName && !email) return null;
  return u;
}

// ─── Hooks ────────────────────────────────────────────────────────

export function useMe() {
  return useQuery({
    queryKey: ["auth", "me", readSessionToken() ?? "cookie"],
    queryFn: ({ signal }) => getMe(signal),
    // Generous staleTime + no refetch triggers — the only times
    // we want /me to re-fire are (a) session-token change (handled
    // via queryKey) and (b) explicit ``invalidateQueries(["auth"])``
    // from useLogin/useLogout. ``refetchOnWindowFocus: true`` was
    // the prior default and produced /me hammering on every
    // focus-blur cycle (devtools, alt-tab, …) — observed 2-3 QPS
    // sustained against the Gemma host with 5KB stack traces per 403.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    retry: false,
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
      // The agents-side /rest/v2/logout only revokes the bearer token (per
      // AuthWebService.java:140) — it does NOT invalidate the
      // HTTP session that Spring sets during /login. Without a
      // hard reload the JSESSIONID cookie keeps /me returning a
      // user. Reload nukes every cached query + tears down the
      // page so the new mount comes up anon (unless the cookie
      // is still server-valid, in which case the user shouldn't
      // see "signed out" — the agents-side
      // /logout-invalidates-session fix covers this).
      try {
        window.location.reload();
      } catch {
        /* SSR / sandbox */
      }
    },
  });
}
