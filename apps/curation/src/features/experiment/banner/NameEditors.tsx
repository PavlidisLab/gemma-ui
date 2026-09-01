import { useEffect, useRef, useState } from "react";
import { Pencil as PencilIcon } from "lucide-react";

import { ApiError } from "@/api/client";
import { useRenameExperiment } from "@/api/datasets";
import { Spinner } from "@/components/ui/Spinner";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { setDesignTitle } from "@/features/design/mutations";

/** The two inline editors on the banner — accession and title. Split out of `ExperimentBanner.tsx` 2026-09-01 — behaviour unchanged. */

/**
 * Click-to-edit display of an experiment's ``short_name``. Replaces
 * what used to be a linked h1 — the link duplicated the
 * "view on Gemma ↗" affordance in the metadata row, and the title
 * is the natural home for the (rarely-needed) rename action.
 *
 * Affordance: read mode shows the name in the h1's chrome with a
 * pencil icon that reveals on hover. Click anywhere on the chip (or
 * the icon) → enters edit mode. Enter saves; Escape cancels; blur
 * commits unless the value is unchanged. Save flow surfaces inline
 * errors for the two cases that matter:
 *   - 409 (name already in use) — the unique-across-Gemma constraint
 *   - 404 (endpoint not implemented yet on this backend)
 * Other errors render the server's detail or message verbatim.
 *
 * On success, the design + datasets caches invalidate so the rest of
 * the UI repaints with the new name without a reload.
 */
export function ShortNameEditor({
  experimentId,
  shortName,
  compact = false,
}: {
  experimentId: number | string;
  shortName: string;
  /** Header sizing. The accession used to head the banner AND sit in
   *  the pinned app header ("the short name doesn't need to be listed
   *  twice" — Paul, 2026-08-16). The banner copy is the one that went,
   *  so this editor moved UP: dropping it outright would have taken
   *  rename and select-copy-the-accession with it, and the pinned row
   *  is the better home for both — it is on screen the whole time. */
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(shortName);
  const inputRef = useRef<HTMLInputElement>(null);
  const rename = useRenameExperiment(experimentId);

  useEffect(() => {
    if (!editing) {
      setDraft(shortName);
      rename.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, shortName]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function commit() {
    const next = draft.trim();
    if (!next || next === shortName) {
      setEditing(false);
      return;
    }
    rename.mutate(next, {
      onSuccess: () => setEditing(false),
      // onError keeps editing=true so the inline error is visible
      // next to the still-focused input.
    });
  }

  if (!editing) {
    // Pencil-on-hover edit. The short_name text itself is plain
    // selectable content (curators frequently select-copy the
    // accession to paste into Slack / tickets / wiki), so we gate
    // the click into edit mode on the pencil affordance — matches
    // the description editor's pattern. Hover reveals the pencil
    // and a subtle dashed underline as the discoverability cue.
    return (
      <h1
        className={
          "inline-flex items-baseline gap-1 group font-semibold " +
          (compact
            ? "text-sm text-stone-900 dark:text-slate-100"
            : "text-lg text-slate-900")
        }
      >
        <span
          className="border-b border-dashed border-transparent group-hover:border-slate-400"
          title={shortName}
        >
          {shortName}
        </span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="rename short_name — must be unique across Gemma"
          aria-label="rename short_name"
          className="p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-blue-50/60 dark:hover:bg-slate-700/40 opacity-0 group-hover:opacity-100 transition-opacity self-center shrink-0"
        >
          <PencilIcon className="h-3 w-3" aria-hidden />
        </button>
      </h1>
    );
  }

  const err = rename.error;
  const errMsg =
    err instanceof ApiError
      ? err.status === 409
        ? `"${draft.trim()}" is already in use — short_name must be unique across Gemma`
        : err.status === 404
          ? "rename endpoint not yet available"
          : err.detail || err.message
      : err
        ? (err as Error).message
        : null;

  return (
    <span className="inline-flex flex-col">
      <span className="inline-flex items-center gap-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            // Defer slightly so a click on Save / Cancel can run
            // before blur tears down the editor. ``commit`` itself
            // no-ops when the value matches the current short_name.
            window.setTimeout(() => {
              if (!rename.isPending) commit();
            }, 100);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit();
              e.preventDefault();
            } else if (e.key === "Escape") {
              setEditing(false);
              e.preventDefault();
            }
          }}
          disabled={rename.isPending}
          spellCheck={false}
          className={
            "font-semibold text-slate-900 border border-blue-300 rounded px-1 py-0 min-w-[14ch] outline-none focus:border-blue-500 disabled:opacity-60 " +
            (compact ? "text-sm" : "text-lg")
          }
          aria-label="short_name"
        />
        {rename.isPending ? (
          <Spinner />
        ) : (
          <>
            <button
              type="button"
              className="text-[11px] text-blue-700 hover:underline"
              onMouseDown={(e) => e.preventDefault()}
              onClick={commit}
            >
              save
            </button>
            <button
              type="button"
              className="text-[11px] text-slate-500 hover:text-slate-800"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setEditing(false)}
            >
              cancel
            </button>
          </>
        )}
      </span>
      {errMsg ? (
        <span className="text-[11px] text-rose-700 mt-0.5" role="alert">
          {errMsg}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Re-pull this experiment's design from real Gemma. Only meaningful
 * in **local mode** — in remote mode the UI is already talking to
 * Gemma directly, so there's nothing to "refresh from Gemma". Hidden
 * outside local mode rather than shown-disabled, since the action
 * would be a no-op there.
 *
 * Destructive on uncommitted edits — the imported Design replaces
 * whatever's currently in the local backend. Gated by a confirmation
 * modal that warns about the draft when the diff is dirty.
 */

/**
 * Click-to-edit display of the experiment title (the human-readable
 * descriptive name — e.g. "A STAT5B-driven mouse model of
 * hepatosplenic γδ T cell lymphoma…"). The title lives on the
 * design draft and edits flow through the normal commit pipeline
 * (no separate REST call) — saves stage on the draft, the floating
 * CommitBar materialises a "save" affordance, and the commit lands
 * via the usual draft-commit POST.
 *
 * Same single-click + pencil-on-hover affordance as ShortNameEditor.
 * Plain text in read mode; click → input → Enter saves / Esc cancels
 * / blur commits.
 */
export function TitleEditor({ title }: { title: string }) {
  const { draft, apply } = useDesignDraft();
  const [editing, setEditing] = useState(false);
  const [d, setD] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setD(title);
  }, [editing, title]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function commit() {
    const next = d.trim();
    if (next !== title && draft) apply((d) => setDesignTitle(d, next));
    setEditing(false);
  }

  if (!editing) {
    // Title can be long (full study sentence); curators routinely
    // select-copy chunks of it. Same pattern as short_name — text
    // stays plain selectable, pencil is the click target. Empty
    // state lets the placeholder act as the affordance since
    // there's nothing to select.
    const isEmpty = !title;
    return (
      <h2 className="text-sm font-semibold text-slate-900 leading-snug inline-flex items-baseline gap-1 group">
        {isEmpty ? (
          <span
            role="button"
            tabIndex={0}
            onClick={() => setEditing(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setEditing(true);
              }
            }}
            className="italic text-slate-400 font-normal cursor-pointer hover:underline"
            title="click to add title"
          >
            (no title — click to add)
          </span>
        ) : (
          <>
            <span className="border-b border-dashed border-transparent group-hover:border-slate-400">
              {title}
            </span>
            <button
              type="button"
              onClick={() => setEditing(true)}
              title="edit title"
              aria-label="edit title"
              className="p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-blue-50/60 dark:hover:bg-slate-700/40 opacity-0 group-hover:opacity-100 transition-opacity self-center shrink-0"
            >
              <PencilIcon className="h-3 w-3" aria-hidden />
            </button>
          </>
        )}
      </h2>
    );
  }
  return (
    <input
      ref={inputRef}
      value={d}
      onChange={(e) => setD(e.target.value)}
      onBlur={() => {
        window.setTimeout(commit, 100);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit();
          e.preventDefault();
        } else if (e.key === "Escape") {
          setEditing(false);
          e.preventDefault();
        }
      }}
      spellCheck
      className="w-full text-sm font-semibold text-slate-900 leading-snug border border-blue-300 rounded px-1 py-0 outline-none focus:border-blue-500"
      aria-label="experiment title"
    />
  );
}
