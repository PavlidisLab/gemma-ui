/**
 * In-app sign-in modal. Replaces the previous "open the legacy
 * /login.jsp in a new tab" affordance. Posts directly to the
 * REST `/rest/v2/login` endpoint and stashes the returned bearer
 * token; every subsequent fetch carries `Authorization: Bearer
 * <token>` via the `apiGet` / `apiPost` wrappers in
 * `apps/browser/src/api/client.ts`.
 *
 * On success the modal closes; the AppBar's `/me` query re-fires
 * under the new token and the "Sign in" pill flips to "Signed in
 * as X". On failure the username/password fields stay populated
 * and the form shows the server error inline.
 */

import { useEffect, useState } from "react";
import { useLogin } from "@/api/auth";
import { ApiError } from "@/api/client";

export function LoginModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const login = useLogin();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Reset transient form state every time the modal opens. Don't
  // hold a typed password in memory after the modal closes either.
  useEffect(() => {
    if (open) {
      login.reset();
      return;
    }
    setUsername("");
    setPassword("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc closes when not mid-submit.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !login.isPending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, login.isPending, onClose]);

  if (!open) return null;

  const errMsg = login.error
    ? login.error instanceof ApiError
      ? login.error.status === 401
        ? "Wrong username or password."
        : login.error.status === 403
          ? // Server-side bug: /rest/v2/login is hitting the legacy
            // XML chain instead of the REST chain that disables
            // CSRF. Server fix is one @Order annotation
            // (handoffs/HANDOFF_REST_CHAIN_ORDER_CSRF.md); meanwhile
            // clearing cookies usually works around it.
            "Sign-in blocked (HTTP 403). The server is rejecting the POST due to a Spring CSRF check that should be disabled on /rest/v2 (filter-chain ordering bug). Workaround: clear cookies for this host and reload. Fix tracked in HANDOFF_REST_CHAIN_ORDER_CSRF.md."
          : `Sign-in failed (HTTP ${login.error.status}).`
      : (login.error as Error).message
    : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center px-4"
      onClick={login.isPending ? undefined : onClose}
    >
      <form
        className="bg-white dark:bg-slate-800 rounded shadow-lg w-full max-w-sm p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!username || !password || login.isPending) return;
          login.mutate(
            { username, password },
            {
              onSuccess: () => {
                setPassword("");
                onClose();
              },
            },
          );
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Sign in to Gemma
          </h2>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            onClick={onClose}
            disabled={login.isPending}
            aria-label="close"
          >
            ×
          </button>
        </div>

        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
          Username
          <input
            type="text"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1 w-full text-sm border border-slate-300 dark:border-slate-600 dark:bg-slate-900 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
            disabled={login.isPending}
          />
        </label>

        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full text-sm border border-slate-300 dark:border-slate-600 dark:bg-slate-900 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
            disabled={login.isPending}
          />
        </label>

        {errMsg ? (
          <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-900/30 dark:border-rose-700 px-2 py-1.5 text-xs text-rose-900 dark:text-rose-200">
            {errMsg}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            className="text-sm px-3 py-1.5 rounded text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
            onClick={onClose}
            disabled={login.isPending}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!username || !password || login.isPending}
            className="text-sm px-3 py-1.5 rounded font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-500 dark:disabled:bg-slate-700"
          >
            {login.isPending ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}
