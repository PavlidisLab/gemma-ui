import {
  browserExperimentPageUrl,
  experimentPageUrl,
} from "@/lib/gemmaUrls";
import { externalSourceLink, formatLoadedAt } from "@/features/experiment/ExperimentBanner";
import type { Design } from "@/features/experiment/types";
import { KV, SummaryCard } from "./SummaryCard";

/**
 * Where this experiment came from and where to go to see it
 * elsewhere — the three outbound links plus the load date.
 *
 * 🛑 **These lived on the banner's meta line and were crowding it out.**
 * That line carries taxon, sample count, platform, three link-outs, the
 * load date, the comparison strip AND the action cluster on one row, and
 * it reflows badly at the widths a curator actually uses (Paul,
 * 2026-08-31: *"this line of stuff is too packed, it flips out too
 * easily"*). Link-outs are the part that earns a card rather than a
 * header slot: nobody reads them while curating, they are consulted
 * deliberately, and they are the widest items on the row.
 *
 * The platform deliberately STAYS on the banner. It is identity — which
 * platform the data sits on changes how the design and the diagnostics
 * are read — and it is consulted at a glance rather than clicked.
 *
 * Sits above Publications because that card already carries the other
 * outbound row ("find on PubMed: by accession / by title"), so the two
 * halves of "go look this up somewhere else" end up adjacent.
 */
export function SourceLinksCard({ design }: { design: Design | null }) {
  if (!design) return null;

  const externalSource = design.external_source ?? null;
  const sourceHref = externalSourceLink(externalSource);
  const experimentId = design.experiment_id;
  const loadedAt = design.loaded_at ?? "";
  const loadedBy = design.loaded_by ?? "";

  return (
    <SummaryCard label="Source & links">
      <KV
        k="source"
        v={
          externalSource ? (
            sourceHref ? (
              <a
                href={sourceHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-700 hover:underline"
              >
                {externalSource.database} {externalSource.accession} ↗
              </a>
            ) : (
              // Recorded but unlinkable — say the accession rather than
              // render a dead link, same as the banner did.
              <span title="external source recorded but no canonical URL available">
                {externalSource.database} {externalSource.accession}
              </span>
            )
          ) : (
            <span
              className="italic text-slate-500"
              title="dataset not imported from an external database (direct upload)"
            >
              direct upload
            </span>
          )
        }
      />
      <KV
        k="view in Gemma"
        v={
          <span className="flex items-center gap-3">
            {/* The label says WHICH front-end. "View on Gemma" tells
                nobody where they are about to land now that there are
                two places it could mean. */}
            <a
              href={browserExperimentPageUrl(experimentId)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 hover:underline"
              title="open this experiment in the Gemma 2.0 browser"
            >
              Gemma 2.0 ↗
            </a>
            <a
              href={experimentPageUrl(experimentId)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 hover:underline"
              title="open this experiment in the Gemma 1.0 webapp"
            >
              Gemma 1.0 ↗
            </a>
          </span>
        }
      />
      {loadedAt ? (
        <KV
          k="loaded"
          v={
            // The raw value is an ISO with microseconds and a timezone
            // ("2026-04-16 07:32:35.224000+00:00"); the short form
            // renders and the full one stays in the tooltip.
            <span title={loadedAt + (loadedBy ? ` · by ${loadedBy}` : "")}>
              {formatLoadedAt(loadedAt)}
              {loadedBy ? (
                <>
                  {" by "}
                  <span className="font-medium text-slate-700">{loadedBy}</span>
                </>
              ) : null}
            </span>
          }
        />
      ) : null}
    </SummaryCard>
  );
}
