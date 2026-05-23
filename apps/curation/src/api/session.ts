import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

// SECURITY-TODO (review 2026-04-27, deferred): the bearer token is
// stored in ``localStorage``, which is readable by any JavaScript
// running on the same origin. If an XSS bug ever ships, the token
// can be exfiltrated and used to impersonate the curator until it
// expires. The right fix is HttpOnly cookies set by the real
// Gemma backend, but that's out of scope while the mock uses a
// static dev token; the mock would need to issue ``Set-Cookie``
// on ``/login``, the Vite proxy would need to pass cookies
// through, and the agents-CLI bearer-token path would still need
// to coexist. Track this here so it's not forgotten when real
// Gemma auth lands. See REVIEW.md item #5.

export interface User {
  username: string;
  full_name: string;
  email: string;
}

interface LoginResponse {
  token: string;
  user: User;
}

// Real gemma-rest wraps every response in {apiVersion, buildInfo, data: ...}.
// The mock didn't — the SPA was reading resp.token directly. Once we point at
// the real backend, that field is on resp.data, not resp. Tolerate both so a
// switch back to the mock doesn't break login.
interface RestEnvelope<T> {
  data?: T;
}

const STORAGE_KEY = "gemma-curation-session";

interface StoredSession {
  token: string;
  user: User;
}

export function loadStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.token !== "string") return null;
    if (typeof parsed?.user?.username !== "string") return null;
    return parsed as StoredSession;
  } catch {
    return null;
  }
}

export function saveStoredSession(s: StoredSession | null): void {
  if (s) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

/** Hook for the current user. ``data`` is the user when logged
 *  in, ``null`` when running with the static API key, undefined
 *  while the request is in flight. */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const resp = await api.get<User | RestEnvelope<User> | null>(
        "/rest/v2/me",
      );
      if (resp && typeof resp === "object" && "data" in resp) {
        return (resp as RestEnvelope<User>).data ?? null;
      }
      return resp as User | null;
    },
    staleTime: 1000 * 60 * 5,
    retry: false,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { username: string; password: string }) =>
      api.post<LoginResponse | RestEnvelope<LoginResponse>>(
        "/rest/v2/login",
        body,
      ),
    onSuccess: (resp) => {
      // Unwrap the gemma-rest envelope if present; the mock returns the
      // LoginResponse directly. ``resp.data?.token`` is the canonical wire
      // shape on the real backend.
      const payload =
        resp && typeof resp === "object" && "data" in resp && resp.data
          ? (resp as RestEnvelope<LoginResponse>).data!
          : (resp as LoginResponse);
      saveStoredSession({ token: payload.token, user: payload.user });
      qc.setQueryData(["me"], payload.user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<null>("/rest/v2/logout", {}),
    onSettled: () => {
      saveStoredSession(null);
      qc.setQueryData(["me"], null);
      // Drop everything tied to the previous session.
      qc.invalidateQueries();
    },
  });
}
