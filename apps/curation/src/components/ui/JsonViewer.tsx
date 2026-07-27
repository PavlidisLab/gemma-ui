/**
 * Inspectable JSON viewer popover.
 *
 * Renders any value as a syntax-coloured, collapsible, searchable
 * tree inside a modal-style scrolling panel. Used for "view raw"
 * affordances on audit reports / proposal annotation sets / any
 * structured payload the curator wants to peek at without opening
 * DevTools.
 *
 * Per design review 2026-06-14: "a scrolling popup with a search function and
 * ability to collapse/expand the json graph."
 *
 * Lightweight on purpose — no external deps. Three pieces:
 *   - ``JsonViewer`` — the modal shell (overlay + close + Escape).
 *   - ``JsonNode``   — the recursive value renderer with collapse +
 *                      syntax tinting.
 *   - search        — substring match highlights every hit; pressing
 *                     Enter cycles through them via scrollIntoView.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface JsonViewerProps {
  open: boolean;
  onClose: () => void;
  /** Heading shown at the top of the panel. */
  title: string;
  /** Optional subtitle / one-line context under the title. */
  subtitle?: string;
  /** The value to render. Any JSON-shaped value; functions / symbols
   *  / circular refs aren't expected (this is for wire payloads). */
  data: unknown;
  /** Initial expand depth. Anything deeper than this collapses on
   *  first render; the curator opens nodes manually from there. */
  initialExpandDepth?: number;
}

export function JsonViewer({
  open,
  onClose,
  title,
  subtitle,
  data,
  initialExpandDepth = 2,
}: JsonViewerProps) {
  const [search, setSearch] = useState("");
  const [matchCursor, setMatchCursor] = useState(0);
  const treeRef = useRef<HTMLDivElement>(null);

  // Reset search when the data identity changes (curator opens a
  // different node) so the previous query doesn't carry over silently.
  useEffect(() => {
    setSearch("");
    setMatchCursor(0);
  }, [data]);

  // Outside click + Escape close.
  const overlayRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Reset cursor on every new search string.
  useEffect(() => {
    setMatchCursor(0);
  }, [search]);

  // Match count is derived by walking the data tree once per search —
  // mirrors what ``Line`` registers as a match (key OR primitive value
  // contains the search). Stays in sync with what's actually rendered
  // even when subtrees are collapsed; the auto-expand effect in
  // ``JsonNode`` opens any subtree containing a hit so all matches
  // land in the DOM before we scroll.
  const matchCount = useMemo(
    () => _countMatches(data, search),
    [data, search],
  );

  // Scroll the active match into view. Reads the live DOM order
  // (querySelectorAll inside ``treeRef``) instead of accumulated refs
  // so ordering matches visual top-to-bottom and stale collapsed-
  // subtree refs can't desync the cursor. Two RAFs: the first lets
  // auto-expand subtree opens settle, the second runs after layout.
  useEffect(() => {
    if (!search || matchCount === 0) return;
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const els = treeRef.current?.querySelectorAll<HTMLElement>(
          '[data-json-match="true"]',
        );
        if (!els || els.length === 0) return;
        const i = ((matchCursor % els.length) + els.length) % els.length;
        const target = els[i];
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        // Visually mark the active match so cycling is obvious even
        // when multiple hits look the same.
        els.forEach((e, j) => {
          if (j === i) {
            e.classList.add("ring-2", "ring-orange-500");
          } else {
            e.classList.remove("ring-2", "ring-orange-500");
          }
        });
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [matchCursor, search, matchCount]);

  function cycleMatch(delta: number) {
    if (matchCount === 0) return;
    setMatchCursor((c) => (c + delta + matchCount) % matchCount);
  }

  function handleCopy() {
    try {
      const txt = JSON.stringify(data, null, 2);
      navigator.clipboard?.writeText(txt);
    } catch {
      // ignore — best effort
    }
  }

  if (!open) return null;
  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 p-4 sm:p-8"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md shadow-2xl flex flex-col max-w-3xl w-full max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-700">
          <span className="font-semibold text-slate-800 dark:text-slate-100 text-sm">
            {title}
          </span>
          {subtitle ? (
            <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {subtitle}
            </span>
          ) : null}
          <span className="ml-auto flex items-baseline gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="text-[11px] px-2 py-0.5 rounded border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700"
              title="copy the full payload to clipboard"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-lg leading-none px-1"
              aria-label="close"
              title="close (Esc)"
            >
              ×
            </button>
          </span>
        </div>
        {/* Search row */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                cycleMatch(e.shiftKey ? -1 : 1);
              }
            }}
            placeholder="Search keys + values (Enter = next, Shift+Enter = prev)"
            className="text-[11px] flex-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {search ? (
            <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
              {matchCount === 0 ? "0" : `${matchCursor + 1}/${matchCount}`}
            </span>
          ) : null}
        </div>
        {/* Tree */}
        <div
          ref={treeRef}
          className="flex-1 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-slate-800 dark:text-slate-100"
        >
          <JsonNode
            value={data}
            depth={0}
            initialExpandDepth={initialExpandDepth}
            search={search}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Recursive renderer
// ---------------------------------------------------------------------------

interface NodeProps {
  value: unknown;
  /** Optional key the parent renders this node under (string or
   *  index) — drives the leading ``"key": …`` prefix. */
  k?: string | number;
  depth: number;
  initialExpandDepth: number;
  search: string;
}

function JsonNode({
  value,
  k,
  depth,
  initialExpandDepth,
  search,
}: NodeProps) {
  const [open, setOpen] = useState(depth < initialExpandDepth);

  // Auto-expand any subtree containing a search hit so the match is
  // actually visible without manual clicking. Recomputed when the
  // search changes.
  const hasMatch = useMemo(
    () => (search ? subtreeMatches(value, k, search) : false),
    [value, k, search],
  );
  useEffect(() => {
    if (hasMatch) setOpen(true);
  }, [hasMatch]);

  const valueMatch = _primitiveMatches(value, search);
  if (value === null) {
    return (
      <Line k={k} search={search} matchesValue={valueMatch}>
        <span className="text-slate-400">null</span>
      </Line>
    );
  }
  if (typeof value === "boolean") {
    return (
      <Line k={k} search={search} matchesValue={valueMatch}>
        <span className="text-amber-700 dark:text-amber-300">
          {value ? "true" : "false"}
        </span>
      </Line>
    );
  }
  if (typeof value === "number") {
    return (
      <Line k={k} search={search} matchesValue={valueMatch}>
        <span className="text-violet-700 dark:text-violet-300">
          {String(value)}
        </span>
      </Line>
    );
  }
  if (typeof value === "string") {
    return (
      <Line k={k} search={search} matchesValue={valueMatch}>
        <span className="text-emerald-700 dark:text-emerald-300 break-all">
          {`"`}
          <Highlighted text={value} search={search} />
          {`"`}
        </span>
      </Line>
    );
  }
  if (Array.isArray(value)) {
    const n = value.length;
    return (
      <div className="flex flex-col" data-depth={depth}>
        <Line
          k={k}
          search={search}
          toggle={n > 0 ? () => setOpen((v) => !v) : undefined}
          glyph={n > 0 ? (open ? "▾" : "▸") : null}
        >
          <span className="text-slate-500">
            [<span className="text-slate-400 text-[10px]"> {n} </span>]
          </span>
        </Line>
        {open && n > 0 ? (
          <div className="pl-4 border-l border-slate-200 dark:border-slate-700 ml-1">
            {value.map((v, i) => (
              <JsonNode
                key={i}
                value={v}
                k={i}
                depth={depth + 1}
                initialExpandDepth={initialExpandDepth}
                search={search}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <div className="flex flex-col" data-depth={depth}>
        <Line
          k={k}
          search={search}
          toggle={entries.length > 0 ? () => setOpen((v) => !v) : undefined}
          glyph={entries.length > 0 ? (open ? "▾" : "▸") : null}
        >
          <span className="text-slate-500">
            {`{`}
            <span className="text-slate-400 text-[10px]">
              {" "}
              {entries.length} keys{" "}
            </span>
            {`}`}
          </span>
        </Line>
        {open && entries.length > 0 ? (
          <div className="pl-4 border-l border-slate-200 dark:border-slate-700 ml-1">
            {entries.map(([childK, v]) => (
              <JsonNode
                key={childK}
                value={v}
                k={childK}
                depth={depth + 1}
                initialExpandDepth={initialExpandDepth}
                search={search}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  // Fallback (functions / symbols / etc).
  return (
    <Line k={k} search={search} matchesValue={valueMatch}>
      <span className="italic text-slate-400">{String(value)}</span>
    </Line>
  );
}

function Line({
  k,
  children,
  toggle,
  glyph,
  search,
  matchesValue,
}: {
  k?: string | number;
  children: React.ReactNode;
  toggle?: () => void;
  glyph?: string | null;
  search: string;
  /** True when the rendered primitive value contains the search
   *  substring. Container lines (objects / arrays) leave this false
   *  so we don't register a hit for ``"{ 5 keys }"`` matching ``"5"``. */
  matchesValue?: boolean;
}) {
  const keyText = k != null ? String(k) : "";
  const matchesKey =
    !!search && keyText.toLowerCase().includes(search.toLowerCase());
  const isMatch = matchesKey || !!matchesValue;
  return (
    <div
      data-json-match={isMatch ? "true" : undefined}
      className={`flex items-baseline gap-1 ${
        isMatch ? "bg-yellow-100 dark:bg-yellow-900/30 rounded px-0.5" : ""
      }`}
    >
      {glyph ? (
        <button
          type="button"
          onClick={toggle}
          className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 w-3 text-center"
          aria-label="toggle"
        >
          {glyph}
        </button>
      ) : glyph === null ? null : (
        <span className="w-3" />
      )}
      {k !== undefined && k !== "" ? (
        <span className="text-sky-700 dark:text-sky-300">
          {typeof k === "number" ? (
            <span className="text-slate-400">{k}</span>
          ) : (
            <>
              {`"`}
              <Highlighted text={String(k)} search={search} />
              {`"`}
            </>
          )}
          <span className="text-slate-400">: </span>
        </span>
      ) : null}
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/** Inline substring highlighter. Wraps every occurrence of ``search``
 *  (case-insensitive) in a yellow background span. Empty search →
 *  text passes through unchanged. */
function Highlighted({ text, search }: { text: string; search: string }) {
  if (!search) return <>{text}</>;
  const lc = text.toLowerCase();
  const q = search.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    const hit = lc.indexOf(q, i);
    if (hit === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (hit > i) parts.push(text.slice(i, hit));
    parts.push(
      <span
        key={hit}
        className="bg-yellow-300 dark:bg-yellow-600/60 text-slate-900 dark:text-slate-100 rounded px-0.5"
      >
        {text.slice(hit, hit + q.length)}
      </span>,
    );
    i = hit + q.length;
  }
  return <>{parts}</>;
}

/** Does this leaf primitive match the search? Mirrors what ``Line``
 *  registers as a match — keep these two in sync. Container types
 *  (object / array) intentionally return false; their summary lines
 *  ("{ 5 keys }") would otherwise false-match unrelated numeric
 *  searches. */
function _primitiveMatches(value: unknown, search: string): boolean {
  if (!search) return false;
  const q = search.toLowerCase();
  if (value === null) return "null".includes(q);
  if (typeof value === "string") return value.toLowerCase().includes(q);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).toLowerCase().includes(q);
  }
  return false;
}

/** Total number of matching lines for ``search`` — sum of every node
 *  whose key OR primitive value matches. Walks the data tree once
 *  per search change (memoized in ``JsonViewer``). Order of the walk
 *  matches visual top-to-bottom render order. */
function _countMatches(value: unknown, search: string): number {
  if (!search) return 0;
  const q = search.toLowerCase();
  let count = 0;
  function walk(v: unknown, k: string | number | undefined): void {
    const keyMatch = k != null && String(k).toLowerCase().includes(q);
    if (keyMatch || _primitiveMatches(v, search)) count++;
    if (Array.isArray(v)) {
      v.forEach((child, i) => walk(child, i));
    } else if (v && typeof v === "object") {
      for (const [childK, child] of Object.entries(
        v as Record<string, unknown>,
      )) {
        walk(child, childK);
      }
    }
  }
  walk(value, undefined);
  return count;
}

/** Does any descendant key OR string value match the search? Used to
 *  auto-expand subtrees containing a hit. Cheap — bails on first
 *  match. */
function subtreeMatches(
  value: unknown,
  k: string | number | undefined,
  search: string,
): boolean {
  const q = search.toLowerCase();
  if (k != null && String(k).toLowerCase().includes(q)) return true;
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.toLowerCase().includes(q);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).toLowerCase().includes(q);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (subtreeMatches(value[i], i, search)) return true;
    }
    return false;
  }
  if (typeof value === "object") {
    for (const [childK, v] of Object.entries(value as Record<string, unknown>)) {
      if (subtreeMatches(v, childK, search)) return true;
    }
  }
  return false;
}
