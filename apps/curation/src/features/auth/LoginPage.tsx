import { useState } from "react";
import { useLogin } from "@/api/session";

/**
 * Login form — modelled on Gemma's `login.jsp` form-login UX
 * (j_username + j_password equivalent). Password is collected for
 * UX consistency but not validated by the mock; real auth will
 * land when this leaves the intranet.
 */
export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const login = useLogin();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;
    login.mutate({ username: username.trim(), password });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <form
        onSubmit={submit}
        className="card max-w-sm w-full p-6 space-y-4"
      >
        <div>
          <h1 className="text-lg font-semibold">Gemma Curation</h1>
          <p className="text-xs text-slate-500 mt-1">
            Sign in with your Gemma credentials. The login is verified
            against{" "}
            <code className="font-mono">/rest/v2/users/me</code> on
            gemma.msl.ubc.ca; your session reads and writes the local
            curation surface and pulls fresh data from Gemma when you
            import or refresh.
          </p>
        </div>

        <label className="block text-sm">
          <span className="text-slate-700">Username</span>
          <input
            type="text"
            value={username}
            autoFocus
            autoComplete="username"
            onChange={(e) => setUsername(e.target.value)}
            placeholder="your Gemma username"
            className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
          />
        </label>

        <label className="block text-sm">
          <span className="text-slate-700">Password</span>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            placeholder="your Gemma password"
            className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
          />
        </label>

        {login.isError ? (
          <div className="text-xs text-rose-700">
            {(login.error as Error).message}
          </div>
        ) : null}

        <button
          type="submit"
          className="btn primary w-full"
          disabled={!username.trim() || login.isPending}
        >
          {login.isPending ? "signing in…" : "sign in"}
        </button>
      </form>
    </div>
  );
}
