import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { resolveGemmaMode } from "@/lib/gemmaMode";
import { saveStoredSession, type User } from "@/lib/sessionStorage";

export type { User } from "@/lib/sessionStorage";

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

/** Normalize a user object from either backend to the UI's User shape.
 *  gemma-rest ships `{userName, email, enabled, group}` (→ user_name
 *  after snakeify); the local_api mock ships `{username, full_name,
 *  email}` directly. The UI consumes `{username, full_name, email}`.
 *  Returns null if the input is missing the minimum identity (no
 *  username under either name). */
function normalizeUser(u: unknown): User | null {
  if (!u || typeof u !== "object") return null;
  const r = u as Record<string, unknown>;
  const username =
    (typeof r.username === "string" && r.username) ||
    (typeof r.user_name === "string" && r.user_name) ||
    "";
  if (!username) return null;
  const fullName =
    (typeof r.full_name === "string" && r.full_name) ||
    (typeof r.first_name === "string" || typeof r.last_name === "string"
      ? [r.first_name, r.last_name].filter(Boolean).join(" ")
      : "") ||
    "";
  const email =
    (typeof r.email === "string" && r.email) || "";
  const authoritiesRaw = r.authorities;
  const authorities = Array.isArray(authoritiesRaw)
    ? authoritiesRaw.filter((a): a is string => typeof a === "string")
    : undefined;
  return { username, full_name: fullName, email, authorities };
}

/** Synthetic curator identity used in local mode so the UI skips
 *  the login flow entirely. local_api accepts the static dev bearer
 *  for all writes; there is no real user / session concept to
 *  authenticate against. The dispositions table just records this
 *  string as the reviewer. */
const LOCAL_MODE_USER: User = {
  username: "local-curator",
  full_name: "Local Curator",
  email: "",
  /** Local mode bypasses auth entirely, so grant the synthetic user
   *  admin authority — keeps the AppHeader Administration tab visible
   *  during local-mode dev so the dev sees the same chrome a real
   *  admin sees. */
  authorities: ["GROUP_ADMIN", "GROUP_USER"],
};

/** Hook for the current user. ``data`` is the user when logged
 *  in, ``null`` when running with the static API key, undefined
 *  while the request is in flight. In local mode the network call
 *  is skipped and a synthetic dev user returned directly — no
 *  login screen, no auth round-trip. */
export function useMe() {
  const { mode } = resolveGemmaMode();
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      if (mode === "local") {
        return LOCAL_MODE_USER;
      }
      const resp = await api.get<unknown>("/rest/v2/me");
      // Both envelopes (gemma-rest's `{data: user}` and the mock's
      // bare user) reduce to a single user-shaped object via the
      // unwrap in client.ts. Normalize key names so downstream
      // consumers always see `{username, full_name, email}`.
      const raw =
        resp && typeof resp === "object" && "data" in (resp as Record<string, unknown>)
          ? (resp as { data: unknown }).data
          : resp;
      return normalizeUser(raw);
    },
    // /me lockdown — see apps/browser/src/api/auth.ts:useMe. Without
    // these flags the focus-blur cycle (devtools attach, alt-tab,
    // window refocus) fires /me on every transition, flooding the
    // gemma-rest log with AccessDeniedException stack traces on 403.
    // Mirror the browser app's settings exactly so the two stay in
    // lockstep.
    staleTime: 1000 * 60 * 5,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
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
      // Normalize the user shape (gemma-rest's `userName` → `username`,
      // etc.) before storing — downstream consumers read username off
      // the stored session and would otherwise get undefined.
      const user = normalizeUser(payload.user);
      if (!user || typeof payload.token !== "string") return;
      saveStoredSession({ token: payload.token, user });
      qc.setQueryData(["me"], user);
    },
  });
}

export function useLogout() {
  const { mode } = resolveGemmaMode();
  const qc = useQueryClient();
  return useMutation({
    // Local mode has no real session — useMe returns a synthetic
    // dev curator unconditionally — so logout would just clear
    // localStorage (nothing there) and then useMe would resurrect
    // the same user on the next read. Skip the round-trip and
    // resolve immediately so the UI doesn't flicker.
    mutationFn: async () => {
      if (mode === "local") return null;
      return api.post<null>("/rest/v2/logout", {});
    },
    onSettled: () => {
      if (mode === "local") return;
      saveStoredSession(null);
      qc.setQueryData(["me"], null);
      // Drop everything tied to the previous session.
      qc.invalidateQueries();
    },
  });
}
