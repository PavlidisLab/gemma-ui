import { useState } from "react";
import { useGemmaMode } from "@/lib/gemmaMode";
import type { CommitConflict } from "@/api/commitConflict";
import type { DesignDiff } from "./diff";
import type { Design, DesignValidationState } from "@/features/experiment/types";

/** One curator-supplied override on a factor whose baseline gate fired.
 *  Surfaces as a dated stamp on the experiment's ``curation_note`` so
 *  the audit trail records *why* the curator overrode. */
export interface BaselineOverride {
  factorLabel: string;
  factorId: number;
  reason: string;
}

/**
 * Sticky footer for the design editor. Visible only when the draft
 * differs from the saved server state. Summarises the pending change
 * counts and offers Discard / Commit.
 *
 * No auto-save: the editor only PUTs when the user clicks Commit.
 *
 * Per Confluence `Curating-Baseline-Factor-Values`, every factor must
 * have exactly one baseline FV. The CommitBar gates Commit when that
 * invariant is broken — but lets the curator explicitly override on
 * a per-factor basis with a brief written reason. The reasons are
 * stamped onto the experiment's curation_note as a dated entry so
 * the audit trail records which baseline gates were waived and why.
 */
export function CommitBar({
  diff,
  saving,
  saveError,
  saveConflict,
  validation,
  draft,
  onCommit,
  onDiscard,
  lockedBy,
  onTakeOver,
  takingOver,
}: {
  diff: DesignDiff;
  saving: boolean;
  saveError: string | null;
  /** The same failure read as a reason, when the server sent one. */
  saveConflict?: CommitConflict | null;
  /** Optional — when present, the bar gates commit on baseline correctness. */
  validation?: DesignValidationState | null;
  /** Used to resolve factor names in the blocked-state message. */
  draft?: Design | null;
  /** Receives the per-factor override list (empty when no factors had
   *  a baseline gate fire). The wiring at the App level stamps these
   *  onto curation_note for provenance. */
  onCommit: (overrides: BaselineOverride[]) => void;
  onDiscard: () => void;
  /** Set when SOMEONE ELSE holds the curation lease. Blocks commit —
   *  see the note beside `lockedOut` below. Null when the lease is
   *  yours or nobody holds it. */
  lockedBy?: string | null;
  onTakeOver?: () => void;
  takingOver?: boolean;
}) {
  // Per-factor override state. Map of factor_id → ``{checked, reason}``.
  // Only relevant when a factor has a baseline-count problem; commit is
  // unblocked when every problem factor has ``checked = true``. Empty
  // reasons are allowed — the curator might override during a known-
  // intermediate state — but the placeholder copy nudges toward a note.
  const [overrideState, setOverrideState] = useState<
    Record<number, { checked: boolean; reason: string }>
  >({});
  // 🛑 Remote mode blocks the commit, before the click.
  //
  // Commit's write path is the older whole-design PUT, and `/rest` is a
  // catch-all whose meaning changes with mode — that same relative path
  // reaches the curation store locally and a real Gemma remotely. The
  // mutation refuses there too (`REMOTE_DESIGN_SAVE_REFUSED`); this is
  // the half the curator can see, so the button says why rather than
  // failing after the fact.
  //
  // Editing stays free, exactly as under someone else's lease: the
  // draft is local and has to remain workable. Only the WRITE is gated.
  const remoteMode = useGemmaMode().mode === "remote";
  if (!diff.isDirty) return null;

  // Only factors whose missing baseline should *block commit* are
  // counted. Block / batch / cell-type / organism-part factors carry
  // ``baseline_blocks_commit: false`` because they have no natural
  // baseline. Cell-line factors also carry it false (soft-baseline
  // category) — the ValidatorBanner still surfaces a "no baseline
  // marked" bullet so the curator considers it, but commit isn't
  // gated.
  // ``=== 0``, not ``!== 1``: more than one marked baseline is legal
  // (a two-experiments-in-one dataset carries a reference per
  // sub-experiment) and must not gate the commit. Only the absence of
  // any reference does. The ValidatorBanner asks about the multi case
  // in its slate advisory channel instead.
  const baselineProblem = validation
    ? validation.factors.filter(
        (f) => f.baseline_blocks_commit && f.baseline_count === 0,
      )
    : [];
  const hasBaselineProblem = baselineProblem.length > 0;
  const allOverridden = baselineProblem.every(
    (f) => overrideState[f.factor_id]?.checked,
  );
  // Hard validation problems that block commit with no override — Gemma
  // rejects them (ungrounded category / off-preset predicate). Unlike the
  // baseline gate there's no legitimate "commit anyway"; the only fix is
  // to resolve them in the editor. A missing factor description is NOT
  // here: it's advisory only — surfaced as a ValidatorBanner warning, not
  // a commit blocker (design review 2026-07-21). ``hardProblemLines`` names each
  // offending factor + its issues for the blocked message.
  const hardProblems = validation
    ? validation.factors
        .map((f) => ({
          factor: f,
          lines: [
            ...(f.ungrounded_categories.length > 0
              ? [
                  `category is free text: ${[
                    ...new Set(f.ungrounded_categories.map((u) => u.label)),
                  ]
                    .map((l) => `"${l}"`)
                    .join(", ")}`,
                ]
              : []),
            ...(f.unknown_predicates > 0
              ? [
                  `${f.unknown_predicates} predicate${
                    f.unknown_predicates === 1 ? "" : "s"
                  } not from the preset list`,
                ]
              : []),
          ],
        }))
        .filter((p) => p.lines.length > 0)
    : [];
  const hasHardProblem = hardProblems.length > 0;
  // 🛑 Someone else holds the lease, so COMMIT is blocked.
  //
  // The lease used to be purely advisory — it warned and never gated,
  // on the reasoning that a stale lock should not strand a curator.
  // That reasoning does not survive the case Paul named: the proposer
  // running over a thousand experiments while a curator hand-edits one
  // of them. Two writers, no gate, and the loser finds out at commit
  // time or not at all.
  //
  // Editing stays free — the draft is per-curator and the baseline has
  // to remain editable — and steal stays one click away, so nobody is
  // stranded by a lease whose holder walked off. What is gated is the
  // WRITE, which is the thing that can collide.
  //
  // 🛑 Two limits, so nothing downstream over-trusts this.
  //
  // It is CLIENT-SIDE. A caller going straight at Gemma is not stopped
  // by it, so a held lock is a coordination signal and never proof the
  // design is unchanged — `baseline.lastModified` remains the
  // correctness guarantee and the 409 still has to be handled.
  //
  // And it currently blocks curator-vs-curator ONLY. The case that
  // motivated it — a proposer batch running while someone hand-edits
  // one of its experiments — is not covered, because the agent takes
  // no lock for its run: `take_curation_lock` is called from exactly
  // one place, the relay endpoint the UI hits (confirmed by call site,
  // cab 2026-08-26). Agent-side locking is unbuilt.
  const lockedOut = !!lockedBy;
  const blocked =
    remoteMode ||
    lockedOut ||
    (hasBaselineProblem && !allOverridden) ||
    hasHardProblem;

  const t = diff.totals;
  const parts: string[] = [];
  if (t.addedFvs) parts.push(`${t.addedFvs} new FV${t.addedFvs === 1 ? "" : "s"}`);
  if (t.modifiedFvs)
    parts.push(`${t.modifiedFvs} modified FV${t.modifiedFvs === 1 ? "" : "s"}`);
  if (t.removedFvs)
    parts.push(`${t.removedFvs} deleted FV${t.removedFvs === 1 ? "" : "s"}`);
  if (t.factorFieldsChanged)
    parts.push(
      `${t.factorFieldsChanged} factor${t.factorFieldsChanged === 1 ? "" : "s"} renamed`,
    );
  if (t.addedFactors)
    parts.push(
      `${t.addedFactors} new factor${t.addedFactors === 1 ? "" : "s"}`,
    );
  if (t.removedFactors)
    parts.push(
      `${t.removedFactors} deleted factor${t.removedFactors === 1 ? "" : "s"}`,
    );
  if (t.addedTags)
    parts.push(`${t.addedTags} new tag${t.addedTags === 1 ? "" : "s"}`);
  if (t.modifiedTags)
    parts.push(
      `${t.modifiedTags} modified tag${t.modifiedTags === 1 ? "" : "s"}`,
    );
  if (t.removedTags)
    parts.push(
      `${t.removedTags} deleted tag${t.removedTags === 1 ? "" : "s"}`,
    );

  const wrapperCls = blocked
    ? "card border-rose-300 bg-rose-50 shadow-sm"
    : "card border-amber-300 bg-amber-50 shadow-sm";
  const dotCls = blocked ? "bg-rose-600" : "bg-amber-500";
  const labelCls = blocked
    ? "text-rose-900"
    : "text-amber-900";

  return (
    // Sticks to the top of the page-content section, right-aligned
    // so it doesn't fight with the banner's title text. Sat below
    // the banner + tabs nav (which are above the section in the
    // DOM) and pins on scroll. ``z-30`` keeps it above page content
    // but below modal overlays (z-50).
    //
    // Earlier iterations parked the bar at the bottom (sticky
    // bottom-0) — the reviewer wanted the bottom freed up — and at fixed
    // top-2 right-2 — that collided with the TopBar's user-info
    // strip. Sticky-top inside the section is the clean middle:
    // bottom is free, top-of-page user info is unobscured.
    // Renders inline in the experiment banner action row, next to
    // Status / publish. No floating / sticky wrapper — the banner's
    // own ``flex items-center`` handles layout, and the chip just
    // disappears when the draft is clean (``return null`` above).
    // Keeps everything top-and-right without the previous full-page
    // sticky bar that obscured the actual page content.
    <div className="inline-block">
      <div className={wrapperCls}>
        <div className="px-2 py-1 flex items-center gap-2 whitespace-nowrap">
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${labelCls}`}>
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotCls}`} />
            {blocked ? "blocked" : "uncommitted"}
          </span>
          <span className={`text-[10px] ${labelCls}/80 truncate max-w-[20rem]`} title={parts.join(" · ") || "minor edits"}>
            {parts.length ? parts.join(" · ") : "minor edits"}
          </span>
          <div className="flex items-center gap-1">
            {saveError ? (
              <span className="text-[10px] text-rose-700" title={saveError}>
                save failed
              </span>
            ) : null}
            <button
              type="button"
              className="text-[11px] px-2 py-0.5 rounded text-slate-600 hover:bg-slate-100"
              onClick={onDiscard}
              disabled={saving}
            >
              undo
            </button>
            <button
              type="button"
              className="text-[11px] px-2 py-0.5 rounded bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50"
              onClick={() => {
                const overrides: BaselineOverride[] = baselineProblem
                  .filter((f) => overrideState[f.factor_id]?.checked)
                  .map((f) => ({
                    factorId: f.factor_id,
                    factorLabel:
                      draft?.factors.find((x) => x.id === f.factor_id)?.name ??
                      `factor#${f.factor_id}`,
                    reason: overrideState[f.factor_id]?.reason?.trim() ?? "",
                  }));
                onCommit(overrides);
              }}
              disabled={saving || blocked}
              title={
                remoteMode
                  ? "Design commit is disabled in remote mode — this write would go straight to Gemma."
                  : lockedOut
                  ? `${lockedBy} holds the editing lease. Take over to commit — their draft is separate and survives.`
                  : hasHardProblem
                    ? "Fix the flagged factor problems (grounded category + predicate) to commit."
                    : blocked
                      ? "Each factor must have exactly one baseline FV. Tick the per-factor override to commit anyway."
                      : undefined
              }
            >
              {saving ? "committing…" : "commit"}
            </button>
          </div>
        </div>
        {remoteMode ? (
          <div className="px-3 pb-2 text-[11px] text-rose-900/90 dark:text-rose-200">
            <span className="font-semibold">Remote mode</span> — commit is
            blocked here. This save is the older whole-design write, which
            in remote mode goes straight to Gemma rather than to the
            curation store. The preflight → commit → sign chain that
            replaces it cannot map this draft&rsquo;s ids yet, so nothing
            writes. Your edits are kept; switch to local mode to commit
            them.
          </div>
        ) : null}
        {lockedOut ? (
          <div className="px-3 pb-2 text-[11px] text-rose-900/90 dark:text-rose-200 flex items-baseline gap-1.5">
            <span>
              <span className="font-semibold">{lockedBy}</span> holds the
              editing lease — commit is blocked here so two curators do not
              land on top of each other.
            </span>
            {onTakeOver ? (
              <button
                type="button"
                onClick={onTakeOver}
                disabled={takingOver}
                title={`Take the lease from ${lockedBy}. Their draft is separate and survives.`}
                className="underline hover:no-underline disabled:opacity-50"
              >
                {takingOver ? "taking over…" : "Take over"}
              </button>
            ) : null}
          </div>
        ) : null}
        {hasBaselineProblem ? (
          <div className="px-3 pb-2 text-[11px] text-rose-900/90 space-y-1">
            <div className="font-semibold">
              Tick to override:
            </div>
            {baselineProblem.map((f) => {
              // Treat empty-string names the same as missing — the
              // ``??`` fallback only catches null/undefined and was
              // letting blank-named factors render as a bare ":
              // no baseline marked".
              const rawName = (
                draft?.factors.find((x) => x.id === f.factor_id)?.name ?? ""
              ).trim();
              const factorLabel =
                rawName || `(unnamed factor#${f.factor_id})`;
              // Only the zero case reaches this list now — a multi-
              // baseline factor is legal and never gated.
              const issue = "no baseline";
              const state = overrideState[f.factor_id] ?? {
                checked: false,
                reason: "",
              };
              return (
                <div
                  key={f.factor_id}
                  className="flex items-center gap-2 flex-wrap"
                >
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={state.checked}
                      onChange={(e) =>
                        setOverrideState((prev) => ({
                          ...prev,
                          [f.factor_id]: {
                            checked: e.target.checked,
                            reason: prev[f.factor_id]?.reason ?? "",
                          },
                        }))
                      }
                    />
                    <span>{factorLabel}: {issue}</span>
                  </label>
                  {state.checked ? (
                    <input
                      type="text"
                      value={state.reason}
                      onChange={(e) =>
                        setOverrideState((prev) => ({
                          ...prev,
                          [f.factor_id]: {
                            checked: prev[f.factor_id]?.checked ?? true,
                            reason: e.target.value,
                          },
                        }))
                      }
                      placeholder="reason (optional, stamped on curation_note)"
                      className="text-[11px] border border-rose-300 rounded px-1.5 py-0.5 bg-white min-w-[24ch] flex-1"
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
        {hasHardProblem ? (
          <div className="px-3 pb-2 text-[11px] text-rose-900/90 space-y-1">
            <div className="font-semibold">Fix to commit:</div>
            {hardProblems.map(({ factor: f, lines }) => {
              const rawName = (
                draft?.factors.find((x) => x.id === f.factor_id)?.name ?? ""
              ).trim();
              const factorLabel = rawName || `(unnamed factor#${f.factor_id})`;
              return (
                <div key={f.factor_id}>
                  <span className="font-medium">{factorLabel}</span>:{" "}
                  {lines.join("; ")}
                </div>
              );
            })}
          </div>
        ) : null}
        {saveConflict ? (
          /* A commit 409 has five reasons and five different next
             moves, and only STALE_BASELINE is a re-read — so the
             message says what to DO, not just that it failed.
             🛑 There is no "force" affordance even for REQUIRES_FORCE:
             sign is the route for a change with consequences, and
             Gemma gates sign on holding the lock. */
          <div className="px-3 pb-2 text-[11px] text-rose-700">
            <span className="font-semibold">commit refused:</span>{" "}
            {saveConflict.message}
            {saveConflict.nextMove ? (
              <div className="text-slate-700 dark:text-slate-300 mt-0.5">
                {saveConflict.nextMove}
              </div>
            ) : null}
          </div>
        ) : saveError ? (
          <div className="px-3 pb-2 text-[11px] text-rose-700">
            <span className="font-semibold">save rejected:</span>{" "}
            {humaniseSaveError(saveError)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Pull a human-readable message out of the api/client.ts error
 * format. The wrapper builds messages like
 * `PUT /rest/v2/… failed: 409 Conflict {"detail":"…"}`. The user
 * doesn't need the URL or the verb; show the status reason and
 * the parsed detail instead.
 */
function humaniseSaveError(raw: string): string {
  // Try to find the trailing JSON blob.
  const i = raw.indexOf("{");
  if (i < 0) return raw;
  const head = raw.slice(0, i).trim();
  const tail = raw.slice(i);
  let detail: unknown;
  try {
    detail = JSON.parse(tail);
  } catch {
    return raw;
  }
  // FastAPI error shapes: `{detail: "..."}` (string) or
  // `{detail: [{loc, msg, type, ...}, ...]}` (validation).
  let detailText = "";
  if (detail && typeof detail === "object" && "detail" in detail) {
    const d = (detail as { detail: unknown }).detail;
    if (typeof d === "string") detailText = d;
    else if (Array.isArray(d)) {
      detailText = d
        .map((item) => {
          if (item && typeof item === "object" && "msg" in item) {
            const loc = Array.isArray((item as { loc?: unknown[] }).loc)
              ? ((item as { loc: unknown[] }).loc.join("."))
              : "";
            return loc
              ? `${loc}: ${(item as { msg: string }).msg}`
              : (item as { msg: string }).msg;
          }
          return String(item);
        })
        .join("; ");
    }
  }
  // Strip the "PUT /path failed: " prefix so just the status reason
  // + detail remains.
  const status = head.replace(/^[A-Z]+\s+\S+\s+failed:\s*/, "");
  return detailText ? `${status} — ${detailText}` : status || raw;
}
