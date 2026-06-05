/**
 * Bottom-of-page footer. Surfaces:
 *   - upstream Gemma host the dev proxy is fronting,
 *   - UI build SHA (baked in at vite build time),
 *   - server-side gemma-rest build (version + commit) via
 *     /rest/v2/info (anonymous, cheap).
 *
 * The historical Gemma footer carried license + version info; this
 * is the modern equivalent. Useful for the "is my page stale?"
 * check — UI SHA tells you which curation-UI build you're on,
 * server build tells you which gemma-rest deployment you're
 * talking to.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { apiGet, ApiError } from "@/api/client";
import { useMe } from "@/api/auth";
import { curationUrl } from "@/lib/appLinks";

/** Compact relative-time formatter ("3m ago", "2h ago"). Pure;
 *  caller renders the absolute ISO via title= for accuracy. */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const dt = Date.now() - then;
  const sec = Math.round(dt / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

interface ServerInfo {
  build?: {
    version?: string | null;
    timestamp?: string | null;
    gitHash?: string | null;
  } | null;
  java?: {
    version?: string | null;
    vendor?: string | null;
    vm?: string | null;
  } | null;
  os?: { name?: string | null; version?: string | null; arch?: string | null } | null;
  uptime?: { startTimeMillis?: number; uptimeMillis?: number } | null;
}

function useServerInfo() {
  return useQuery<ServerInfo | null>({
    queryKey: ["server", "info"],
    queryFn: async () => {
      try {
        return await apiGet<ServerInfo>("/rest/v2/info");
      } catch (e) {
        // /info is anonymous-safe on Gemma 2.0 but absent on older
        // builds; 401/403/404 → just hide that half of the stamp.
        if (
          e instanceof ApiError &&
          (e.status === 401 || e.status === 403 || e.status === 404)
        ) {
          return null;
        }
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function Footer() {
  const me = useMe();
  const target = typeof __GEMMA_TARGET__ === "string" ? __GEMMA_TARGET__ : "";
  const host = (() => {
    try {
      return new URL(target).host;
    } catch {
      return target;
    }
  })();
  const isLocal = /localhost|127\.0\.0\.1/.test(host);

  const uiSha =
    typeof __GEMMA_BUILD_SHA__ === "string" ? __GEMMA_BUILD_SHA__ : "dev";
  const uiShaFull =
    typeof __GEMMA_BUILD_SHA_FULL__ === "string"
      ? __GEMMA_BUILD_SHA_FULL__
      : "";
  const uiBuiltAt =
    typeof __GEMMA_BUILD_TIME__ === "string" ? __GEMMA_BUILD_TIME__ : "";

  const info = useServerInfo();
  const serverVersion = info.data?.build?.version;
  const serverGitHash = info.data?.build?.gitHash;
  const serverBuiltAt = info.data?.build?.timestamp;

  return (
    <footer
      className="flex items-center gap-3 px-3 py-1 text-[11px] border-t border-gemma-grid bg-surface text-gemma-subtle flex-wrap"
      style={{ flex: "0 0 auto" }}
    >
      <span className="inline-flex items-center gap-1">
        <span
          className={
            "inline-block w-1.5 h-1.5 rounded-full " +
            (isLocal ? "bg-amber-500" : "bg-emerald-500")
          }
          title={
            isLocal ? "pointing at a local server" : "pointing at a remote server"
          }
        />
        <span className="font-mono">
          API →{" "}
          {target ? (
            <a
              href={target}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gemma-accent hover:underline"
              title={target}
            >
              {host}
            </a>
          ) : (
            <span className="italic text-gemma-subtle">unset</span>
          )}
        </span>
      </span>

      <span className="opacity-60">·</span>

      {/* UI build stamp — short SHA links to the GitHub commit.
          Also shows a relative-time chip so a stale dev server
          (where Vite's `define` was baked at startup and the
          checkout has moved on) is visible at a glance.  */}
      <span
        className="inline-flex items-baseline gap-1 font-mono"
        title={
          uiBuiltAt
            ? `UI built ${uiBuiltAt}${uiShaFull ? " from " + uiShaFull : ""}\n\nVite bakes the build SHA at dev-server start. If this looks stale, restart the dev server (or rebuild for prod).`
            : uiShaFull
              ? `UI commit ${uiShaFull}`
              : "dev build"
        }
      >
        <span className="opacity-60">ui</span>
        {uiSha === "dev" ? (
          <span className="opacity-70">dev</span>
        ) : (
          <a
            href={`https://github.com/PavlidisLab/gemma-ui/commit/${uiShaFull || uiSha}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gemma-accent hover:underline"
          >
            {uiSha}
          </a>
        )}
        {uiBuiltAt ? (
          <span className="opacity-50" title={uiBuiltAt}>
            · {formatRelative(uiBuiltAt)}
          </span>
        ) : null}
      </span>

      {/* Server build stamp — gemma-rest version + commit. */}
      {info.data?.build ? (
        <>
          <span className="opacity-60">·</span>
          <span
            className="inline-flex items-baseline gap-1 font-mono"
            title={
              serverBuiltAt
                ? `gemma-rest built ${serverBuiltAt}${serverGitHash ? " from " + serverGitHash : ""}`
                : "gemma-rest"
            }
          >
            <span className="opacity-60">gemma</span>
            {serverVersion ? (
              <span className="opacity-80">{serverVersion}</span>
            ) : null}
            {serverGitHash ? (
              <a
                href={`https://github.com/PavlidisLab/Gemma/commit/${serverGitHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gemma-accent hover:underline"
                title={serverGitHash}
              >
                ({serverGitHash.slice(0, 8)})
              </a>
            ) : null}
          </span>
        </>
      ) : null}

      <span className="ml-auto inline-flex items-center gap-3 flex-wrap">
        {/* App-level surfaces. Render in the footer so the home page
            (which hides the AppBar) still has a way into Curation +
            Administration. TODO: gate Administration on an admin
            role flag once /me carries one — Paul 2026-05-26. */}
        <a href={curationUrl()} className="hover:underline">
          Curation
        </a>
        {me.data ? (
          <Link to="/admin/system" className="hover:underline">
            Administration
          </Link>
        ) : null}
        <span className="opacity-40" aria-hidden>·</span>
        <ExtLink href="https://pavlidislab.github.io/Gemma/">Docs</ExtLink>
        <ExtLink href="https://gemma.msl.ubc.ca/resources/restapidocs/">
          REST
        </ExtLink>
        <ExtLink href="https://github.com/PavlidisLab">GitHub</ExtLink>
        <ExtLink href="https://pavlidislab.github.io/Gemma/terms.html">
          Terms
        </ExtLink>
        <ExtLink
          href="https://pavlidislab.github.io/Gemma/terms.html#cookies"
          title="Essential cookies only — sign-in session + UI preferences."
        >
          Cookies
        </ExtLink>
        <span className="opacity-60 uppercase tracking-[0.16em] text-[10px]">
          <ExtLink
            href="https://pavlab.msl.ubc.ca"
            className="hover:underline hover:opacity-100"
          >
            Pavlidis Lab
          </ExtLink>
          {" · "}
          <ExtLink
            href="https://www.ubc.ca"
            className="hover:underline hover:opacity-100"
          >
            UBC
          </ExtLink>
        </span>
      </span>
    </footer>
  );
}

/** External link with a trailing ↗ glyph so readers can tell at a
 *  glance the click leaves Gemma. ``target="_blank"`` +
 *  ``rel="noopener noreferrer"`` are baked in (security + tab-
 *  hygiene defaults — every caller in the footer wanted them
 *  anyway). */
function ExtLink({
  href,
  children,
  title,
  className,
}: {
  href: string;
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className={className ?? "hover:underline"}
    >
      {children}
      <span
        aria-hidden
        className="ml-0.5 text-[0.85em] opacity-60"
      >
        ↗
      </span>
    </a>
  );
}
