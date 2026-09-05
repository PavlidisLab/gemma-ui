/**
 * What a commit — or a restore — would change, in the curator's terms.
 *
 * 🛑 **A new component, and here is the check.** Grepped both apps for
 * an existing renderer of created / updated / deleted / unchanged
 * counts and for anything reading a `changes` map: nothing. `CommitBar`
 * consumes preflight but displays none of it, and `DesignDraftContext`
 * holds the report without rendering it. So this is the missing half of
 * a chain that has been complete on the wire for weeks — every commit
 * has been answering with a full report that nothing shows.
 *
 * Drives three things off ONE `CommitReport`, because Gemma answers
 * preflight, commit and `restore?dryRun=true` with the same shape:
 * *"replays the snapshot's CurationDocument through the ordinary
 * all-or-none commit, so there is no second diff implementation that
 * could disagree with the first."* Whatever renders one renders all
 * three, and that is deliberate rather than incidental.
 */

import { cn } from "@/lib/cn";
import type { CommitReport, CommitSectionChange } from "@/api/curationCommit";

/** Sections in the order a curator reads them, then anything else the
 *  server sent — an unrecognized section renders rather than vanishing,
 *  because a silently dropped section is a change nobody was shown. */
const SECTION_ORDER = ["design", "tags", "curationDetails"] as const;

const SECTION_LABEL: Record<string, string> = {
  design: "Design",
  tags: "Tags",
  curationDetails: "Curation details",
};

function orderedSections(
  changes: Record<string, CommitSectionChange>,
): Array<[string, CommitSectionChange]> {
  const known = SECTION_ORDER.filter((s) => s in changes).map(
    (s) => [s, changes[s]] as [string, CommitSectionChange],
  );
  const rest = Object.keys(changes)
    .filter((k) => !SECTION_ORDER.includes(k as (typeof SECTION_ORDER)[number]))
    .sort()
    .map((k) => [k, changes[k]] as [string, CommitSectionChange]);
  return [...known, ...rest];
}

/** Does this section change anything? `unchanged` alone does not count
 *  — it is the denominator, not a change. */
function touches(c: CommitSectionChange): boolean {
  return Boolean(c.created || c.updated || c.deleted);
}

export function CommitChangeSummary({
  report,
  /** Copy differs between "what this commit will do" and "what undoing
   *  would do"; the numbers do not. */
  mode = "commit",
  className,
}: {
  report: CommitReport | null | undefined;
  mode?: "commit" | "restore";
  className?: string;
}) {
  if (!report) return null;

  if (report.error) {
    return (
      <p className={cn("text-xs text-red-700 dark:text-red-300", className)}>
        {report.error}
      </p>
    );
  }

  const sections = orderedSections(report.changes ?? {}).filter(([, c]) =>
    touches(c),
  );
  const reidentified = Object.entries(report.reidentified ?? {});
  const deleted = report.deletedIdentities ?? [];

  return (
    <div className={cn("text-xs space-y-2", className)}>
      {sections.length === 0 ? (
        <p className="text-slate-500 dark:text-slate-400 italic">
          {mode === "restore"
            ? "Nothing to put back — this snapshot matches the current curation."
            : "No changes."}
        </p>
      ) : (
        <ul className="space-y-0.5">
          {sections.map(([name, c]) => (
            <li key={name} className="flex items-baseline gap-2">
              <span className="text-slate-700 dark:text-slate-200 font-medium">
                {SECTION_LABEL[name] ?? name}
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                {[
                  c.created ? `${c.created} added` : null,
                  c.updated ? `${c.updated} changed` : null,
                  c.deleted ? `${c.deleted} removed` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* 🛑 The consequence a curator cannot see in the counts, and the
          reason a restore is not a plain undo. Gemma: a restore returns
          the curation's CONTENT, not its IDENTITY — an entity recreated
          in between comes back as a NEW row with a NEW id, and a
          differential-expression analysis that survived that run is
          cascaded again on the way back. Rendered only when the server
          actually reports it, never as a standing warning: a caution
          shown on every preview is one nobody reads on the preview
          where it matters. */}
      {reidentified.length > 0 ? (
        <p className="text-amber-700 dark:text-amber-300">
          {reidentified.length}{" "}
          {reidentified.length === 1 ? "annotation comes" : "annotations come"}{" "}
          back with{" "}
          {reidentified.length === 1 ? "a new id" : "new ids"} rather than in
          place. Anything referring to the old{" "}
          {reidentified.length === 1 ? "one" : "ones"} — a differential
          expression analysis, a saved link — is rebuilt or dropped.
        </p>
      ) : null}

      {deleted.length > 0 ? (
        <p className="text-amber-700 dark:text-amber-300">
          {deleted.length} existing{" "}
          {deleted.length === 1 ? "annotation is" : "annotations are"} removed.
        </p>
      ) : null}

      {mode === "restore" ? (
        <p className="text-slate-500 dark:text-slate-400">
          Nothing has been written yet — this is what restoring would do.
        </p>
      ) : null}
    </div>
  );
}
