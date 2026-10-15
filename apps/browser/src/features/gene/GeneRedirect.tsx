// Legacy redirect — /gene/$id → /gene/ncbi/$ncbiId.
//
// The gene page used to be keyed by /gene/$id where $id was raw search
// text (symbol or NCBI id). That URL is ambiguous — a symbol collides
// across taxa — so the canonical route is now NCBI-id-keyed. This shim
// keeps old links (and bookmarks) alive: it resolves the legacy param to
// an NCBI id and replaces the history entry with the canonical URL.
//
// With `byInternalId` it serves /gene/id/$id instead: $id is Gemma's own
// gene id, which is what legacy /gene/showGene.html?id=N links carry
// (the server rewrites those to #/gene/id/N). Same forward, different
// lookup — a Gemma id can't go through the /gene/$id path, where a bare
// number is read as an NCBI id.

import { useEffect } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useUrlInitial } from "@/features/shared/useUrlInitial";
import { useQuery } from "@tanstack/react-query";
import { resolveGeneByInternalId, resolveGeneNcbiId } from "@/api/endpoints";
import { PageMask } from "@gemma/ui";

export function GeneRedirect({ byInternalId = false }: { byInternalId?: boolean }) {
  const { id } = useParams({ strict: false }) as { id: string };
  const { taxon } = useUrlInitial();
  const navigate = useNavigate();

  const q = useQuery({
    queryKey: byInternalId
      ? ["gene-resolve-internal", id]
      : ["gene-resolve", id, taxon ?? ""],
    queryFn: ({ signal }) =>
      byInternalId
        ? resolveGeneByInternalId(id, signal)
        : resolveGeneNcbiId(id, { taxon, signal }),
    enabled: !!id,
  });

  useEffect(() => {
    if (q.data != null) {
      navigate({
        to: "/gene/ncbi/$ncbiId",
        params: { ncbiId: String(q.data) },
        replace: true,
      });
    }
  }, [q.data, navigate]);

  if (q.isError || (!q.isLoading && q.data == null)) {
    return (
      <div className="h-full overflow-y-auto bg-gemma-bg">
        <div className="max-w-4xl mx-auto px-6 py-12 text-center space-y-2">
          <h1 className="text-lg font-semibold text-gemma-ink">
            Gene not found.
          </h1>
          <p className="text-xs text-gemma-subtle">
            {byInternalId
              ? `No gene has Gemma id ${id}.`
              : `No gene matched "${id}".`}
          </p>
        </div>
      </div>
    );
  }

  return <PageMask mode="region" label="Resolving gene" detail={`${id}…`} />;
}
