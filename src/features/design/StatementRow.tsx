import { Term } from "@/components/ui/Term";
import type { Statement } from "@/features/experiment/types";

/**
 * Render one Statement (subject + optional predicate + object) as a
 * sequence of ontology chips. Read-only in this iteration; an edit
 * mode comes when we wire the mutation API.
 */
export function StatementRow({ statement }: { statement: Statement }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      <Term
        uri={statement.subject.uri ?? null}
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
