import { Link } from "@tanstack/react-router";
import { browseTermLink } from "@/lib/appLinks";
import { shortenUri } from "@/lib/curie";
import { geneDisplayLabel } from "@/lib/gene";
import type { DatasetAnnotationPair } from "@/lib/types";

/**
 * One annotation, statement and all, inside ONE chip frame.
 *
 * 🛑 Single frame on purpose. The parts of a statement are not three
 * independent chips — `NEFH-tTa`, `has_genotype`, `Heterozygous` set
 * side by side in three bordered boxes read as three annotations, and
 * a row of them gives no clue where one value ends and the next
 * begins. The curation UI settled this convention for its tag chips:
 * one frame per annotation, inner terms carrying colour and weight but
 * no border of their own (Paul, 2026-09-01: "you can't blow them
 * apart, keep them together in the same chip").
 *
 * Inner term treatment mirrors ``apps/curation``'s ``TagInnerTerm``:
 * grounded terms in emerald with their CURIE, ungrounded in italic
 * slate with nothing after it, predicates in a muted mono caption.
 */

/** A term inside the frame — no border, no background of its own.
 *
 *  ``browse`` is supplied only for the annotation's own term. A
 *  statement's OBJECT renders identically but inert — see
 *  ``browseTermLink`` for why linking one would report the wrong set. */
function InnerTerm({
  label,
  uri,
  browse,
}: {
  label: string;
  uri: string | null;
  browse?: { to: "/browser"; search: Record<string, string> } | null;
}) {
  const display = geneDisplayLabel(label, uri);
  if (!uri) {
    return <span className="italic text-stone-600">{display}</span>;
  }
  const body = (
    <>
      <span className="font-medium text-emerald-800" title={label}>
        {display}
      </span>
      <span className="text-slate-400 font-mono text-[10px] whitespace-nowrap">
        {shortenUri(uri)}
      </span>
    </>
  );
  if (!browse) {
    return (
      <span className="inline-flex items-baseline gap-1" title={uri}>
        {body}
      </span>
    );
  }
  return (
    <Link
      to={browse.to}
      search={browse.search}
      title={`Browse datasets annotated with this term\n${uri}`}
      className="inline-flex items-baseline gap-1 no-underline hover:underline"
    >
      {body}
    </Link>
  );
}

export function AnnotationStatementChip({
  termName,
  termUri,
  categoryLabel,
  categoryUri,
  statements,
}: {
  termName: string;
  termUri: string | null;
  categoryLabel?: string | null;
  categoryUri?: string | null;
  statements: readonly DatasetAnnotationPair[];
}) {
  return (
    <span
      className={
        "inline-flex items-baseline gap-1 flex-wrap px-1.5 py-0.5 rounded " +
        "text-xs leading-5 border max-w-full align-baseline " +
        (termUri
          ? "bg-emerald-50 border-emerald-200"
          : "bg-stone-50 border-stone-200")
      }
    >
      <InnerTerm
        label={termName}
        uri={termUri}
        browse={browseTermLink({
          uri: termUri,
          label: termName,
          categoryUri,
          categoryLabel,
        })}
      />
      {statements.map((s, i) => (
        <span key={i} className="inline-flex items-baseline gap-1">
          {s.predicate || s.predicateUri ? (
            <>
              <span className="text-emerald-900/40">·</span>
              <span
                className="font-mono text-[10px] text-emerald-900/75"
                title={s.predicateUri ?? undefined}
              >
                {s.predicate ?? ""}
              </span>
            </>
          ) : null}
          {s.object || s.objectUri ? (
            <>
              <span className="text-emerald-900/40">·</span>
              <InnerTerm label={s.object ?? ""} uri={s.objectUri ?? null} />
            </>
          ) : null}
        </span>
      ))}
    </span>
  );
}
