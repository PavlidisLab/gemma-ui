import { useState } from "react";
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
  validation,
  draft,
  onCommit,
  onDiscard,
}: {
  diff: DesignDiff;
  saving: boolean;
  saveError: string | null;
  /** Optional — when present, the bar gates commit on baseline correctness. */
  validation?: DesignValidationState | null;
  /** Used to resolve factor names in the blocked-state message. */
  draft?: Design | null;
  /** Receives the per-factor override list (empty when no factors had
   *  a baseline gate fire). The wiring at the App level stamps these
   *  onto curation_note for provenance. */
  onCommit: (overrides: BaselineOverride[]) => void;
  onDiscard: () => void;
}) {
  // Per-factor override state. Map of factor_id → ``{checked, reason}``.
  // Only relevant when a factor has a baseline-count problem; commit is
  // unblocked when every problem factor has ``checked = true``. Empty
  // reasons are allowed — the curator might override during a known-
  // intermediate state — but the placeholder copy nudges toward a note.
  const [overrideState, setOverrideState] = useState<
    Record<number, { checked: boolean; reason: string }>
  >({});
  if (!diff.isDirty) return null;

  // Only factors whose missing baseline should *block commit* are
  // counted. Block / batch / cell-type / organism-part factors carry
  // ``baseline_blocks_commit: false`` because they have no natural
  // baseline. Cell-line factors also carry it false (soft-baseline
  // category) — the ValidatorBanner still surfaces a "no baseline
  // marked" bullet so the curator considers it, but commit isn't
  // gated.
  const baselineProblem = validation
    ? validation.factors.filter(
        (f) => f.baseline_blocks_commit && f.baseline_count !== 1,
      )
    : [];
  const hasBaselineProblem = baselineProblem.length > 0;
  const allOverridden = baselineProblem.every(
    (f) => overrideState[f.factor_id]?.checked,
  );
  const blocked = hasBaselineProblem && !allOverridden;

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
    // bottom-0) — Paul wanted the bottom freed up — and at fixed
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
              discard
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
                blocked
                  ? "Each factor must have exactly one baseline FV. Tick the per-factor override to commit anyway."
                  : undefined
              }
            >
              {saving ? "committing…" : "commit"}
            </button>
          </div>
        </div>
        {hasBaselineProblem ? (
          <div className="px-3 pb-2 text-[11px] text-rose-900/90 space-y-1">
            <div className="font-semibold">
              Baseline gate fired — tick to override (per factor):
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
              const issue =
                f.baseline_count === 0
                  ? "no baseline marked"
                  : `${f.baseline_count} baselines marked (must be 1)`;
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
                    <span>· {factorLabel}: {issue}</span>
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
        {saveError ? (
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
