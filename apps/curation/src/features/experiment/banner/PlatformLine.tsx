import { useDesignDraft } from "@/features/design/DesignDraftContext";
import {
  inferModality,
  modalityLabel,
  type Modality,
} from "@/features/experiment/modality";
import { cn } from "@/lib/cn";
import { platformPageUrl } from "@/lib/gemmaUrls";

/** The banner's identity line: what kind of assay, on which platform.
 *  Split out of `ExperimentBanner.tsx` 2026-09-01 — behaviour unchanged. */

/**
 * "Save draft" button in the experiment banner. Mirrors the
 * CommitBar at the bottom: disabled when there are no pending
 * changes, shows the count + a small dirty dot when there are.
 * Clicking commits the shared design draft via
 * `useDesignDraft().commit()`.
 *
 * Discard / saveError surfacing stays exclusively on the bottom
 * CommitBar to avoid duplicating both the success and error
 * affordances at top + bottom.
 */
/**
 * Strong modality chip for the banner. Single-cell / bulk RNA-seq
 * / microarray classification — at a glance, before the curator
 * scrolls. Reads the draft (not just the saved server state) so
 * edits to assay-tag inferences are reflected immediately.
 */
export function ModalityIndicator() {
  const { draft } = useDesignDraft();
  const m = inferModality(draft);
  const { label, hint } = modalityLabel(m);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] uppercase tracking-wide font-bold px-2 py-0.5 rounded border",
        modalityClasses(m),
      )}
      title={hint}
    >
      {label}
    </span>
  );
}

function modalityClasses(m: Modality): string {
  switch (m) {
    case "single-cell":
      return "bg-violet-100 text-violet-900 border-violet-300";
    case "bulk-rnaseq":
      return "bg-sky-100 text-sky-900 border-sky-300";
    case "microarray":
      return "bg-amber-100 text-amber-900 border-amber-300";
    default:
      return "bg-slate-100 text-slate-700 border-slate-300";
  }
}

/**
 * Platform line for the banner metadata strip. Replaces a naive
 * ``{assay} · {platform}`` render that was showing curators
 * misleading text — for RNA-seq experiments Gemma stores a
 * ``Generic platform for Mus musculus, indexed by NCBI IDs``
 * stand-in array_design, and the technology_type field carries the
 * machine code (``GENELIST`` / ``SEQUENCING`` / ``ONECOLOR`` / …)
 * that's not the curator's vocabulary.
 *
 * Behaviour:
 *
 *   - Modality already shows up as the chip next to the title, so
 *     we don't repeat the technology_type code here.
 *   - For real wet-lab platforms (microarrays, named sequencers
 *     when Gemma has them) we render the platform name as a link
 *     to the Gemma platform record.
 *   - For Gemma stub platforms (``Generic_*`` short_name, or
 *     ``GENELIST`` / ``OTHER`` technology_type with a stub-shaped
 *     name) we suppress the misleading "Generic platform for…"
 *     text and surface only a subdued "Gemma platform: <link>" so
 *     the curator can still navigate to the platform record but
 *     isn't fooled into thinking the experiment is on that array.
 *   - When ``original_platform`` differs from ``platform`` (Gemma
 *     auto-switched the array_design — common for older platforms
 *     that have been merged into a successor) we surface it as
 *     "originally <name>" so the curator sees the source-DB
 *     identity. Linked when we have a short_name / id.
 */
export function PlatformLine({
  technologyType,
  assay,
  platform,
  platformShortName,
  platformId,
  originalPlatform,
  originalPlatformShortName,
  originalPlatformId,
}: {
  technologyType: string;
  assay: string;
  platform: string;
  platformShortName: string;
  platformId: number | null;
  originalPlatform: string;
  originalPlatformShortName: string;
  originalPlatformId: number | null;
}) {
  // Gemma stub detection: technology_type is GENELIST / OTHER, or
  // the short_name starts with "Generic_". The latter catches stubs
  // that arrived without a tech_type field (older imports, manual
  // uploads). Empty platform string is also "no info to show".
  const tt = (technologyType || "").toUpperCase();
  const isStub =
    !platform ||
    tt === "GENELIST" ||
    tt === "OTHER" ||
    /^Generic[_ ]/i.test(platformShortName);
  const platformUrl = platformPageUrl(platformShortName, platformId);
  const origUrl = platformPageUrl(
    originalPlatformShortName,
    originalPlatformId,
  );
  const showOriginal =
    !!originalPlatform &&
    originalPlatform !== platform &&
    !/^Generic[_ ]/i.test(originalPlatformShortName);

  if (isStub) {
    // Suppress the misleading "Generic platform for…" name; surface
    // only a subdued link to the Gemma platform record so curators
    // can still get there. If there's no link target either, drop
    // the line entirely — the modality chip already says RNA-seq.
    if (!platformUrl) return null;
    return (
      <span className="text-slate-400">
        platform:{" "}
        <a
          href={platformUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-slate-500 hover:text-slate-700 hover:underline"
          title="Gemma stand-in platform — open the platform record"
        >
          {platformShortName || "Gemma stub"}
          <span className="ml-0.5">↗</span>
        </a>
      </span>
    );
  }

  // Real platform — name as link.
  return (
    <span className="inline-flex items-baseline gap-1.5 flex-wrap">
      {platformUrl ? (
        <a
          href={platformUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-700 hover:underline"
          title={`open platform ${platformShortName || ""} on Gemma`}
        >
          {platform}
          <span className="ml-0.5 text-[10px]">↗</span>
        </a>
      ) : (
        <span>{platform}</span>
      )}
      {showOriginal ? (
        <span className="text-slate-400 italic">
          (originally{" "}
          {origUrl ? (
            <a
              href={origUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-500 hover:text-slate-700 hover:underline not-italic"
            >
              {originalPlatform}
            </a>
          ) : (
            originalPlatform
          )}
          )
        </span>
      ) : null}
      {/* Fallback: surface the raw assay code only when the
          modality classifier isn't going to disambiguate (i.e.
          the chip would say "unknown"). Avoids the redundant
          GENELIST / ONECOLOR strings in the common case. */}
      {assay && tt === "" ? (
        <span className="text-slate-400">· {assay}</span>
      ) : null}
    </span>
  );
}
