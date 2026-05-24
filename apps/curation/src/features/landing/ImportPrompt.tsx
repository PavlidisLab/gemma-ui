import { useState } from "react";
import { useImportFromGemma } from "@/api/datasets";
import { navigate } from "@/routes";

/**
 * Shown when a curator navigates to an experiment that hasn't
 * been imported into the mock yet. Pulls from real Gemma on
 * demand. Defaults the import reference to the numeric id from
 * the URL — usually that's enough to find it. Curator can edit
 * (e.g. type the GSE accession instead) before submitting.
 */
export function ImportPrompt({ experimentId }: { experimentId: number | string }) {
  const importer = useImportFromGemma();
  const [ref, setRef] = useState(String(experimentId));

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <form
        className="card max-w-md w-full p-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const r = ref.trim();
          if (!r) return;
          importer.mutate(r, {
            onSuccess: (design) => {
              if (design.experiment_id !== experimentId) {
                // The accession the curator typed resolves to a
                // different id; route there.
                navigate(`#/experiments/${design.experiment_id}`);
              }
              // Otherwise the same route is already correct;
              // the design query will refetch and the editor
              // takes over.
            },
          });
        }}
      >
        <div>
          <h2 className="text-base font-semibold">
            Experiment not imported yet
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Experiment {experimentId} hasn't been pulled from Gemma into
            this curation surface. Import it now to start curating.
          </p>
        </div>
        <label className="block text-sm">
          <span className="text-slate-700">Gemma reference</span>
          <input
            type="text"
            value={ref}
            autoFocus
            onChange={(e) => setRef(e.target.value)}
            placeholder="GSE accession, Gemma shortName, or numeric id"
            className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
          />
          <span className="text-[11px] text-slate-500 mt-1 block">
            If the URL id doesn't resolve, paste the GSE accession
            instead — gemmapy resolves either form.
          </span>
        </label>

        {importer.isError ? (
          <div className="text-xs text-rose-700">
            {(importer.error as Error).message}
          </div>
        ) : null}

        <div className="flex justify-between gap-2">
          <a href="#/" className="btn ghost">back to list</a>
          <button
            type="submit"
            className="btn primary"
            disabled={!ref.trim() || importer.isPending}
          >
            {importer.isPending ? "importing…" : "import"}
          </button>
        </div>
      </form>
    </div>
  );
}
