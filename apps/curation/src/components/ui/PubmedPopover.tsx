/**
 * Inline abstract card anchored to a PMID, and the PMID chip that
 * opens it.
 *
 * The ontology-card pattern applied to a publication: the small
 * identifier is the hot spot, the card carries what you would have
 * tabbed out to read, and the external link lives inside it. A curator
 * checking whether a linked paper is the right paper should not have to
 * leave the experiment to find out.
 *
 * Why this is not `CuriePopover` with a flag: that card is a TERM card
 * end to end — Gemma `/annotations/term`, the OLS fallback CTA, the
 * relation ladder, derived facts, gene handling, in-card parent
 * navigation. None of it applies to an article, and an article's
 * content (a multi-paragraph abstract, a MeSH list) does not fit the
 * shape it renders. What the two DO share — anchored positioning,
 * dismiss-on-outside, the card chrome — is shared for real, via
 * `anchoredCard.ts`, rather than copied.
 *
 * Why this is not `AbstractModal` (features/overview/publications.tsx):
 * that renders the AGENT's `paper_excerpt` — a biolit dump the agent
 * fetched, present only where an agent has run, and scraped for its
 * abstract with a pair of regexes. This is PubMed's own record, always
 * available for a PMID, and it carries MeSH, which no excerpt does.
 */
import { createPortal } from "react-dom";
import { useState, useRef } from "react";
import { usePubmedAbstract, type MeshHeading } from "@/api/pubmed";
import { useAnchoredPosition, useDismissOnOutside } from "./anchoredCard";

const MESH_BROWSER = "https://meshb.nlm.nih.gov/record/ui?ui=";

export interface PubmedPopoverProps {
  pmid: string;
  anchorRect: DOMRect;
  onClose: () => void;
  /** Stacking override, for anchors already inside an overlay. Mirrors
   *  `CuriePopoverProps.zIndex`. */
  zIndex?: number;
}

export function PubmedPopover({
  pmid,
  anchorRect,
  onClose,
  zIndex,
}: PubmedPopoverProps) {
  const { data, isLoading, error } = usePubmedAbstract(pmid);
  // Re-measure once the record lands: the card is one line while it
  // fetches and a dozen when it resolves.
  const { ref, pos } = useAnchoredPosition<HTMLDivElement>(anchorRect, [data]);
  useDismissOnOutside(ref, onClose);

  const pubmedUrl = `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(pmid)}/`;

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`PubMed record ${pmid}`}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="fixed z-50 rounded-md border border-slate-300 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800 max-w-md min-w-[20rem] text-[11px]"
      style={{ left: pos.left, top: pos.top, zIndex }}
    >
      <div className="px-3 py-2 space-y-1.5 max-h-[26rem] overflow-y-auto">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
            PMID {pmid}
          </span>
          {data?.journal ? (
            <span className="text-[9px] tracking-wide text-slate-400">
              {data.journal}
              {data.year ? ` ${data.year}` : ""}
            </span>
          ) : null}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="ml-auto text-[10px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {isLoading ? (
          <div className="text-slate-500 dark:text-slate-400 italic">
            Fetching from PubMed…
          </div>
        ) : error || !data ? (
          // Says which step failed. "PubMed did not answer" and "PubMed
          // has no such record" send a curator to different places, and
          // the thrown message already distinguishes them.
          <div className="text-slate-500 dark:text-slate-400 italic">
            {error instanceof Error ? error.message : "PubMed lookup failed."}
          </div>
        ) : (
          <>
            {data.title ? (
              <div className="font-medium text-slate-800 dark:text-slate-100 leading-snug">
                {data.title}
              </div>
            ) : null}
            <AbstractBody sections={data.sections} />
            <MeshBlock mesh={data.mesh} />
          </>
        )}

        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 pt-1 border-t border-slate-200 dark:border-slate-700 mt-1">
          {/* Amber for NCBI, the same hue `CuriePopover` gives an
              NCBI-sourced term — the source pill's colour means the
              same thing on both cards. */}
          <span className="text-[9px] tracking-wide whitespace-nowrap text-amber-700 dark:text-amber-300">
            from PubMed
          </span>
          <a
            href={pubmedUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-[10px] text-blue-700 hover:underline dark:text-blue-300 whitespace-nowrap"
          >
            open in PubMed ↗
          </a>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function AbstractBody({
  sections,
}: {
  sections: { label: string | null; text: string }[];
}) {
  if (sections.length === 0) {
    // Not an error and not a gap in our fetch: plenty of indexed
    // records genuinely have no abstract. Saying so is what stops a
    // curator retrying and concluding the lookup is broken.
    return (
      <div className="pt-1 border-t border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 italic">
        No abstract in PubMed for this record.
      </div>
    );
  }
  return (
    <div className="pt-1 border-t border-slate-200 dark:border-slate-700 space-y-1">
      <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
        abstract
      </div>
      {sections.map((s, i) => (
        <p
          key={`${s.label ?? "body"}-${i}`}
          className="text-slate-700 dark:text-slate-200 leading-relaxed"
        >
          {/* Structured abstracts get their journal's own run-in
              heading, the way PubMed prints them. */}
          {s.label ? (
            <span className="font-semibold text-slate-500 dark:text-slate-400">
              {s.label}:{" "}
            </span>
          ) : null}
          {s.text}
        </p>
      ))}
    </div>
  );
}

function MeshBlock({ mesh }: { mesh: MeshHeading[] }) {
  if (mesh.length === 0) return null;
  return (
    <div className="pt-1 border-t border-slate-200 dark:border-slate-700 space-y-1">
      <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
        MeSH headings{" "}
        {/* Same idiom as the term card's "— derived, not curated": say
            whose claim this is. NLM's indexers assign these to the
            PAPER; they are not annotations of the experiment and must
            never be read as a curation. */}
        <span className="font-normal italic">— assigned by NLM to the paper</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {mesh.map((m) => (
          <a
            key={m.ui || m.descriptor}
            href={m.ui ? `${MESH_BROWSER}${encodeURIComponent(m.ui)}` : undefined}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title={
              m.qualifiers.length > 0
                ? `${m.descriptor} — ${m.qualifiers.join(", ")}`
                : m.descriptor
            }
            className={
              // 🛑 Weight, not order. PubMed lists MeSH alphabetically
              // and a curator comparing the card against PubMed's own
              // page should find the same sequence; re-sorting majors
              // to the front would make the two disagree. The star is
              // PubMed's own mark for a major topic.
              m.major
                ? "inline-flex items-baseline px-1.5 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-900 font-medium no-underline hover:bg-amber-100 dark:border-amber-600/60 dark:bg-amber-900/30 dark:text-amber-200"
                : "inline-flex items-baseline px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-600 no-underline hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-700/50 dark:text-slate-300"
            }
          >
            {m.descriptor}
            {m.major ? "*" : ""}
          </a>
        ))}
      </div>
    </div>
  );
}

/** The PMID chip that opens the card — `CurieLink`'s counterpart for a
 *  publication. Owns its own anchor-rect tracking and open state so
 *  callers do not plumb it through. */
export function PubmedLink({
  pmid,
  className,
}: {
  pmid: string | null | undefined;
  className?: string;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const trimmed = (pmid ?? "").trim();
  if (!trimmed) return null;
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={`PubMed ${trimmed} — abstract and MeSH headings`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
          setOpen((v) => !v);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className={
          className ??
          "text-blue-700 hover:underline cursor-pointer bg-transparent border-0 p-0"
        }
      >
        PMID {trimmed}
      </button>
      {open && rect ? (
        <PubmedPopover
          pmid={trimmed}
          anchorRect={rect}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
