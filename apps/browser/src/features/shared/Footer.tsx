/**
 * Bottom-of-page footer. Surfaces the upstream Gemma URL the dev
 * proxy is fronting so the curator always knows which API they're
 * talking to (staging vs. local 2.0 vs. some other override).
 *
 * Value comes from the Vite-injected ``__GEMMA_TARGET__`` global,
 * which is resolved from ``GEMMA_BASE_URL`` in
 * ``apps/browser/.env.local`` at build/dev start.
 */
export function Footer() {
  const target = typeof __GEMMA_TARGET__ === "string" ? __GEMMA_TARGET__ : "";
  const host = (() => {
    try {
      return new URL(target).host;
    } catch {
      return target;
    }
  })();
  const isLocal = /localhost|127\.0\.0\.1/.test(host);
  return (
    <footer
      className="flex items-center gap-3 px-3 py-1 text-[11px] border-t border-gemma-grid bg-surface text-gemma-subtle"
      style={{ flex: "0 0 auto" }}
    >
      <span className="inline-flex items-center gap-1">
        <span
          className={
            "inline-block w-1.5 h-1.5 rounded-full " +
            (isLocal ? "bg-amber-500" : "bg-emerald-500")
          }
          title={isLocal ? "pointing at a local server" : "pointing at a remote server"}
        />
        <span className="font-mono">
          API → {target ? (
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
      <span className="font-mono opacity-70">/rest/v2</span>
      <span className="ml-auto opacity-50">Gemma Browser · gemma-ui</span>
    </footer>
  );
}
