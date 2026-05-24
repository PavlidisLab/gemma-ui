import { useQuantitationTypes } from "@/api/quantitation";

/**
 * Read-only listing of an experiment's quantitation types —
 * proxied from real Gemma via the mock. Columns mirror Gemma's
 * own QT tab so the curator sees the same data in the same layout
 * (Name, Description, Recompu / Batch corr / Pref / Ratio /
 * Bkgrd / Bkgrd Sub / Norm flags, then General Type / Type /
 * Representation / Scale).
 */
export function QuantitationTypesPanel({
  experimentId,
}: {
  experimentId: number | string;
}) {
  const { data: qts, isLoading, error } = useQuantitationTypes(experimentId);

  if (isLoading) {
    return (
      <div className="card p-4 text-sm text-slate-500">
        loading quantitation types…
      </div>
    );
  }
  if (error) {
    return (
      <div className="card p-4 text-sm text-rose-700">
        couldn't load quantitation types: {(error as Error).message}
      </div>
    );
  }
  if (!qts || qts.length === 0) {
    return (
      <div className="card p-6 text-sm text-slate-500">
        No quantitation types reported for this experiment.
      </div>
    );
  }

  const preferredCount = qts.filter((q) => q.is_preferred).length;
  const maskedCount = qts.filter((q) => q.is_masked_preferred).length;

  return (
    <div className="card">
      <div className="px-3 py-2 border-b border-slate-200 flex items-center gap-3 flex-wrap">
        <span className="section-h">Quantitation types</span>
        <span className="text-xs text-slate-400">
          {qts.length} type{qts.length === 1 ? "" : "s"} ·{" "}
          {preferredCount} pref
          {maskedCount ? ` · ${maskedCount} masked-pref` : ""} · sourced from Gemma
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr className="border-b border-slate-200">
              <th className="text-left font-medium px-3 py-2">name</th>
              <th className="text-left font-medium px-3 py-2">description</th>
              <th className="text-center font-medium px-2 py-2 w-16" title="Recomputed from raw">recompu?</th>
              <th className="text-center font-medium px-2 py-2 w-16" title="Batch corrected">batch corr?</th>
              <th className="text-center font-medium px-2 py-2 w-14" title="Preferred QT">pref?</th>
              <th className="text-center font-medium px-2 py-2 w-14" title="Ratio">ratio?</th>
              <th className="text-center font-medium px-2 py-2 w-14" title="Background">bkgrd?</th>
              <th className="text-center font-medium px-2 py-2 w-14" title="Background subtracted">bkgrd sub?</th>
              <th className="text-center font-medium px-2 py-2 w-14" title="Normalized">norm?</th>
              <th className="text-left font-medium px-2 py-2 w-28">general type</th>
              <th className="text-left font-medium px-2 py-2 w-20">type</th>
              <th className="text-left font-medium px-2 py-2 w-24">representation</th>
              <th className="text-left font-medium px-2 py-2 w-20">scale</th>
            </tr>
          </thead>
          <tbody>
            {qts.map((q) => (
              <tr key={q.id} className="border-b border-slate-100 hover:bg-slate-50/40">
                <td className="px-3 py-1.5 text-slate-800 font-medium">
                  {q.name || (
                    <span className="italic text-slate-400">(unnamed)</span>
                  )}
                  {q.is_masked_preferred ? (
                    <span
                      className="ml-1 text-[10px] uppercase tracking-wide bg-sky-100 text-sky-800 px-1 rounded"
                      title="masked-preferred — the processed view derived from the preferred raw QT"
                    >
                      processed
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-1.5 text-slate-700">
                  {q.description || (
                    <span className="text-slate-400 italic">—</span>
                  )}
                </td>
                <BoolCell value={q.is_recomputed_from_raw_data} />
                <BoolCell value={q.is_batch_corrected} />
                <BoolCell value={q.is_preferred} highlight />
                <BoolCell value={q.is_ratio} />
                <BoolCell value={q.is_background} />
                <BoolCell value={q.is_background_subtracted} />
                <BoolCell value={q.is_normalized} />
                <td className="px-2 py-1.5 text-slate-700 uppercase text-[11px]">
                  {q.general_type || "—"}
                </td>
                <td className="px-2 py-1.5 text-slate-700 uppercase text-[11px]">
                  {q.type || "—"}
                </td>
                <td className="px-2 py-1.5 text-slate-700 uppercase text-[11px]">
                  {q.representation || "—"}
                </td>
                <td className="px-2 py-1.5 text-slate-700 uppercase text-[11px]">
                  {q.scale || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BoolCell({
  value,
  highlight = false,
}: {
  value: boolean;
  highlight?: boolean;
}) {
  if (value) {
    return (
      <td
        className={
          "px-2 py-1.5 text-center font-semibold " +
          (highlight ? "text-emerald-700" : "text-slate-700")
        }
      >
        yes
      </td>
    );
  }
  return (
    <td className="px-2 py-1.5 text-center text-slate-400">no</td>
  );
}
