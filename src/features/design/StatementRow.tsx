import { Term } from "@/components/ui/Term";
import type { Statement } from "@/features/experiment/types";

/**
 * Render one Statement (subject + optional predicate + object) as a
 * sequence of ontology chips. Read-only in this iteration; an edit
 * mode comes when we wire the mutation API.
 */
export function StatementRow({ statement }: { statement: Statement }) {
  const isBaselineSubject = statement.subject.label
    .toLowerCase()
    .match(/wild type genotype|reference (substance|subject) role|control|initial time point/);
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      <Term
        uri={statement.subject.uri ?? null}
        variant={isBaselineSubject ? "baseline" : "default"}
      >
        {statement.subject.label}
      </Term>
      {statement.predicate ? (
        <Term variant="predicate" uri={statement.predicate.uri ?? null}>
          {statement.predicate.label}
        </Term>
      ) : null}
      {statement.object ? (
        <Term uri={statement.object.uri ?? null}>{statement.object.label}</Term>
      ) : null}
    </div>
  );
}
