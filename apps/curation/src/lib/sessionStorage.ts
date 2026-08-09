/**
 * Persisted curator session (bearer token + identity).
 *
 * Lives in ``lib/`` rather than ``api/session.ts`` because BOTH
 * ``api/session.ts`` (which writes it on login) and ``api/client.ts``
 * (which reads the token onto every request) need it, and
 * ``api/session.ts`` already imports ``api/client.ts`` — putting the
 * storage helpers in either one makes an import cycle. ``client.ts``
 * previously side-stepped that by re-parsing the same localStorage key
 * inline, which left two copies of the key string and two
 * not-quite-identical validity checks.
 *
 * SECURITY-TODO (review 2026-04-27, deferred): the bearer token is
 * stored in ``localStorage``, which is readable by any JavaScript
 * running on the same origin. If an XSS bug ever ships, the token can
 * be exfiltrated and used to impersonate the curator until it expires.
 * The right fix is HttpOnly cookies set by the real Gemma backend, but
 * that's out of scope while the mock uses a static dev token: the mock
 * would need to issue ``Set-Cookie`` on ``/login``, the Vite proxy
 * would need to pass cookies through, and the agents-CLI bearer-token
 * path would still need to coexist. Tracked here so it isn't
 * forgotten when real Gemma auth lands.
 */

export interface User {
  username: string;
  full_name: string;
  email: string;
  /** Spring Security authority names from gemma-rest (e.g.
   *  ``["GROUP_ADMIN", "GROUP_USER"]``). Exposed on /me as of
   *  gemma-rest commit 4a9605c23f (2026-06-07). Used by the
   *  AppHeader Administration tab visibility gate. May be undefined
   *  on responses from older Gemma versions. */
  authorities?: string[];
}

export interface StoredSession {
  token: string;
  user: User;
}

const STORAGE_KEY = "gemma-curation-session";

/** Read the persisted session, or null when absent / unusable.
 *
 *  Self-validating on read: a payload missing either the token or the
 *  username is treated as absent rather than returned half-formed, so
 *  a forward-drifted or hand-edited entry degrades to "logged out"
 *  instead of producing a session with an undefined identity. */
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

/** Persist the session, or clear it when passed null. */
export function saveStoredSession(s: StoredSession | null): void {
  try {
    if (s) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Private-mode tab or a full quota — never let session bookkeeping
    // break the login/logout it is bookkeeping for.
  }
}
