/**
 * Publications card internals — the rows, the abstract modal, the
 * agent's proposed-paper block, and the add-by-PMID/DOI form.
 *
 * Split out of ``OverviewPanel.tsx`` 2026-08-09: that file had grown
 * past 4200 lines and half a megabyte of transpiled output, which the
 * dev server re-parses on every navigation. Nothing here changed in
 * the move — the publications UI is self-contained (its only inbound
 * edges are the five symbols ``OverviewPanel`` imports below), which
 * is what made it the first piece to leave.
 */
import { useEffect, useState } from "react";
import { usePubmedMetadata } from "@/api/pubmed";
import { shortenUri } from "@/lib/curie";
import { cn } from "@/lib/cn";
import { ProvenanceDot } from "@/features/provenance/ProvenanceDot";
import { publicationRefId } from "@/features/provenance/refs";
import { publicationTarget } from "@/features/audit/targetIds";
import { AuditDot } from "@/features/audit/AuditDot";
import { useAuditOptional, useFocusFinding } from "@/features/audit/AuditContext";
import type { Publication } from "@/features/experiment/types";

/** Parse the actual abstract out of the agent's ``paper_excerpt``.
 *  Biolit hands back a kitchen-sink dump — GEO metadata header
 *  (Title / Type / Organism / Platform / Sample count / linked
 *  PMIDs), the GEO ``Summary``, ``Overall design``, then under a
 *  ``--- Linked Publication ---`` divider an ``=== ABSTRACT ===``
 *  block followed by ``=== INTRODUCTION ===``. We want the abstract
 *  body for the curator, not the metadata they already see on the
 *  page. Prefer the explicit ``=== ABSTRACT ===`` marker; fall back
 *  to the GEO ``Summary:`` block (close-enough alternative for
 *  experiments where biolit didn't reach the linked publication).
 *  Returns ``null`` when neither marker matches — the caller shows
 *  the verbatim excerpt as a last-resort fallback. */
export function extractAbstract(excerpt: string): string | null {
  if (!excerpt) return null;
  const ab = excerpt.match(
    /===\s*ABSTRACT\s*===\s*\n([\s\S]*?)(?=\n===\s|\n---\s|$)/i,
  );
  if (ab && ab[1].trim()) return ab[1].trim();
  const summary = excerpt.match(
    /(?:^|\n)Summary:\s*([\s\S]*?)(?=\n\n|\nOverall design:|\nExperiment type:|\n---|\n===|$)/i,
  );
  if (summary && summary[1].trim()) return summary[1].trim();
  return null;
}

/** Modal overlay holding the abstract. Centered, capped width,
 *  scrolls internally. Inline expansion was crowding the
 *  Publications card with a wall of text — kicking the abstract
 *  into a modal keeps the card compact and gives the text room to
 *  breathe at a comfortable reading width. Closes on overlay
 *  click, on the close button, and on Escape. */
export function AbstractModal({
  title,
  excerpt,
  tone,
  onClose,
}: {
  title: string;
  excerpt: string;
  tone: "annotated" | "proposed";
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const body = extractAbstract(excerpt) ?? excerpt;
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const accentCls =
    tone === "annotated"
      ? "border-l-4 border-emerald-400"
      : "border-l-4 border-violet-400";
  const labelCls =
    tone === "annotated" ? "text-emerald-700" : "text-violet-700";
  const labelText = tone === "annotated" ? "Abstract" : "Proposed paper · abstract";
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className={
          "card max-w-2xl w-full max-h-[80vh] flex flex-col shadow-xl " +
          accentCls
        }
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-baseline justify-between gap-2 px-4 py-2 border-b border-slate-200 shrink-0">
          <div className="min-w-0 flex-1">
            <div
              className={
                "text-[10px] uppercase tracking-wider font-semibold " + labelCls
              }
            >
              {labelText}
            </div>
            {title ? (
              <div className="text-[13px] font-medium text-slate-800 leading-snug truncate">
                {title}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-700 text-lg leading-none px-1"
            onClick={onClose}
            aria-label="close"
            title="close (Esc)"
          >
            ×
          </button>
        </header>
        {/* ``flex-1 min-h-0`` lets the body claim the remaining
            modal height and lets ``overflow-auto`` actually kick in
            — without ``min-h-0``, flex children default to
            ``min-height: auto`` and the body grows past max-h-[80vh]
            without scrolling. Caught when a long abstract truncated
            mid-sentence with no scrollbar. */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 text-xs leading-relaxed text-slate-700 space-y-2">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Decide which publication, if any, the agent's paper_excerpt
 *  belongs to. Three cases:
 *
 *    1. ``paper_source`` substring-mentions this publication's
 *       PMID or DOI — definitive match.
 *    2. ``paper_source`` is opaque (a provenance label like
 *       "geo_linked_fulltext" / "biolit") AND there's exactly one
 *       publication on the experiment — attach the abstract here.
 *       The proposer fetches one paper per run from the experiment's
 *       linked publication, so the 1:1 inference is safe.
 *    3. Otherwise — return null, and the abstract surfaces in the
 *       Proposed-paper block instead of a publication row.
 */
export function abstractForPublication(
  publication: Publication,
  allPublications: Publication[],
  ev: { paper_source: string; paper_excerpt: string } | null,
): string | null {
  if (!ev || !ev.paper_excerpt) return null;
  const src = (ev.paper_source || "").toLowerCase();
  if (
    publication.pubmed_id &&
    src.includes(publication.pubmed_id.toLowerCase())
  ) {
    return ev.paper_excerpt;
  }
  if (publication.doi && src.includes(publication.doi.toLowerCase())) {
    return ev.paper_excerpt;
  }
  // Opaque-source fallback — attach to the lone publication if
  // there's only one. Avoids leaving the abstract orphaned in the
  // common single-paper case.
  if (allPublications.length === 1) {
    return ev.paper_excerpt;
  }
  return null;
}

export function anyPublicationGetsAbstract(
  publications: Publication[],
  ev: { paper_source: string; paper_excerpt: string } | null,
): boolean {
  if (!ev) return false;
  return publications.some(
    (p) => abstractForPublication(p, publications, ev) !== null,
  );
}

/** Block for an agent-fetched paper that *isn't* linked to any
 *  confirmed publication on this experiment. Surfaces the abstract
 *  the agent used so the curator can decide whether to link the
 *  paper or reject it. Click "Show abstract" to expand. */
export function ProposedAbstract({
  source,
  excerpt,
}: {
  source: string;
  excerpt: string;
}) {
  const [open, setOpen] = useState(false);
  if (!excerpt) return null;
  const sourceIsUrl = /^https?:\/\//i.test(source);
  return (
    <div className="mb-2 border border-violet-200 bg-violet-50/60 rounded p-2 text-xs">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-violet-800">
          Proposed paper
        </span>
        <span className="text-[11px] text-slate-600">
          Agent fetched a paper but it's not linked to this
          experiment yet.
        </span>
      </div>
      {source ? (
        <div className="mt-1 text-[11px] text-slate-700 break-all">
          <span className="font-medium">source: </span>
          {sourceIsUrl ? (
            <a
              href={source}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 hover:underline"
            >
              {source}
            </a>
          ) : (
            source
          )}
        </div>
      ) : null}
      <button
        type="button"
        className="mt-1 text-[11px] text-violet-800 hover:text-violet-950 underline underline-offset-2"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "▾ Hide abstract" : "▸ Show abstract"}
      </button>
      {open ? (
        <AbstractModal
          title=""
          excerpt={excerpt}
          tone="proposed"
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

/** Always-visible callout surfacing the publication-provenance audit's
 *  verdict directly on the row — no dot-hunting, no clicking into the
 *  sidebar, no jargon from the tag/factor finding-card framework
 *  ("PROPOSER reference-blind" / "INTERNAL CRITIC") that doesn't apply
 *  to a plain "is this the right paper" check. Renders nothing when no
 *  provenance audit has run, or when it confirmed the link (severity
 *  "ok") — a confirmed link needs no attention. Design review
 *  2026-08-26: the dot-only version was reported as "completely
 *  unclear ... there is no indication of what the issue is." */
function PublicationProvenanceBanner({ pmid }: { pmid: string }) {
  const ctx = useAuditOptional();
  const focusFinding = useFocusFinding();
  if (!ctx || !pmid) return null;
  const targetId = publicationTarget(pmid);
  const findings = ctx.findingsByTarget.get(targetId);
  if (!findings || findings.length === 0) return null;
  const finding = findings[0]; // pre-sorted worst-severity-first
  if (finding.severity === "ok") return null;

  const isRejectLike =
    finding.severity === "major" || finding.severity === "blocker";
  const headline = isRejectLike
    ? "Likely the wrong paper"
    : "Unconfirmed — could not verify this is the source paper";
  const toneCls = isRejectLike
    ? "border-rose-300 bg-rose-50 dark:border-rose-700 dark:bg-rose-950/40"
    : "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30";
  const headlineCls = isRejectLike
    ? "text-rose-800 dark:text-rose-200"
    : "text-amber-800 dark:text-amber-200";

  return (
    <div className={cn("mt-1.5 rounded border px-2.5 py-2 text-[12px]", toneCls)}>
      <div className={cn("font-semibold text-[13px] mb-0.5", headlineCls)}>
        ⚠ {headline}
      </div>
      <div className="text-slate-700 dark:text-slate-300 leading-snug">
        {finding.rationale}
      </div>
      <div className="mt-1 font-medium text-slate-600 dark:text-slate-400">
        Check this publication manually.
      </div>
      <button
        type="button"
        className="mt-1.5 text-[11px] text-blue-700 dark:text-blue-300 hover:underline"
        onClick={() => focusFinding(targetId)}
      >
        Open in audit sidebar →
      </button>
    </div>
  );
}

export function PublicationRow({
  publication,
  abstract,
  onDelete,
}: {
  publication: Publication;
  /** When non-null, the agent-fetched paper excerpt for this
   *  publication. Renders behind a "Show abstract" toggle so the
   *  curator can read it inline. Null when no agent has fetched
   *  the paper yet — the row stays compact. */
  abstract?: string | null;
  onDelete?: () => void;
}) {
  const [abstractOpen, setAbstractOpen] = useState(false);
  // Fetch live PubMed metadata when the local row lacks a title.
  // The local API only persists what was on the GEO MINiML
  // ``<Pubmed-ID>`` tag (just the PMID); title / citation /
  // authors are pulled from NCBI esummary on-demand. usePubmedMetadata
  // is a no-op when pubmed_id is empty.
  const needsFetch =
    !publication.title?.trim() && !publication.citation?.trim();
  const { data: pubmedMeta, isLoading: pubmedLoading } = usePubmedMetadata(
    needsFetch ? publication.pubmed_id : undefined,
  );
  const displayTitle =
    publication.title?.trim() ||
    pubmedMeta?.title ||
    publication.citation?.trim() ||
    "";
  const displayCitation =
    publication.citation?.trim() || pubmedMeta?.citation || "";
  const effectiveDoi = publication.doi?.trim() || pubmedMeta?.doi || "";
  const pmidUrl = publication.pubmed_id
    ? `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(publication.pubmed_id)}/`
    : null;
  const doiUrl = effectiveDoi
    ? `https://doi.org/${encodeURIComponent(effectiveDoi)}`
    : null;
  return (
    <li
      className="flex items-start gap-2"
      data-audit-target={publicationTarget(publication.pubmed_id)}
    >
      <div className="flex-1 min-w-0">
        <div className="font-medium text-slate-800 leading-snug">
          {displayTitle ? (
            displayTitle
          ) : pubmedLoading ? (
            <span className="italic text-slate-400">fetching from PubMed…</span>
          ) : (
            <span className="italic text-slate-400">(metadata not fetched yet)</span>
          )}
        </div>
        {displayCitation && displayTitle && displayCitation !== displayTitle ? (
          <div className="text-slate-500 italic">{displayCitation}</div>
        ) : null}
        <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
          {/* Why this paper is linked to this experiment — inert until
              a curator runs "populate provenance", and absent for a
              link nobody has recorded a basis for. Sits with the
              identifiers, not the title: it speaks to the LINK, not to
              the paper. */}
          <ProvenanceDot refId={publicationRefId(publication)} />
          {/* Is this actually the right paper? — the publication-
              provenance audit's verdict. Renders nothing until a
              provenance audit has run against this dataset; this was
              the missing piece that made a loaded finding invisible
              on the row itself (only discoverable by opening the
              sidebar and reading an unlabeled list). */}
          <AuditDot targetId={publicationTarget(publication.pubmed_id)} />
          {pmidUrl ? (
            <a
              href={pmidUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 hover:underline"
            >
              PMID {publication.pubmed_id} ↗
            </a>
          ) : null}
          {doiUrl ? (
            <a
              href={doiUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 hover:underline font-mono"
            >
              {shortenUri(`https://doi.org/${effectiveDoi}`)} ↗
            </a>
          ) : null}
          {abstract ? (
            <button
              type="button"
              className="text-emerald-800 hover:text-emerald-950 underline underline-offset-2"
              onClick={() => setAbstractOpen((v) => !v)}
              title="abstract fetched by the curation agent"
            >
              {abstractOpen ? "▾ Hide abstract" : "▸ Show abstract"}
            </button>
          ) : null}
        </div>
        {abstract && abstractOpen ? (
          <AbstractModal
            title={displayTitle || ""}
            excerpt={abstract}
            tone="annotated"
            onClose={() => setAbstractOpen(false)}
          />
        ) : null}
        <PublicationProvenanceBanner pmid={publication.pubmed_id} />
      </div>
      {onDelete ? (
        <button
          type="button"
          onClick={() => {
            // Confirm before removing — publications are intentionally
            // surfaced by the curator (via the agent or by hand) and
            // an accidental click on the × shouldn't drop the link
            // silently. The next mutation re-renders the row so the
            // curator sees the result immediately. Design review 2026-06-11.
            const what =
              displayTitle ||
              (publication.pubmed_id ? `PMID ${publication.pubmed_id}` : "this publication");
            if (window.confirm(`Remove “${what}” from this experiment?`)) {
              onDelete();
            }
          }}
          className="text-rose-700 hover:text-rose-900 text-xs"
          title="remove this publication"
        >
          ×
        </button>
      ) : null}
    </li>
  );
}

/** Classify a single curator-typed string as either a PubMed ID or
 *  a DOI. PMIDs are bare integers; DOIs match Crossref's
 *  ``10.NNNN/...`` pattern, optionally with a ``doi:`` prefix or a
 *  ``https://doi.org/`` URL wrapper.
 *
 *  Returns ``null`` for empty / ambiguous input so the caller can
 *  disable submit and show a "unrecognised" hint.
 */
export function parsePmidOrDoi(
  raw: string,
): { kind: "pmid"; value: string } | { kind: "doi"; value: string } | null {
  const v = raw.trim();
  if (!v) return null;
  // PMID: bare digits, length 1+ (PubMed PMIDs are <= 9 digits today
  // but no point hard-coding a length cap — Pub gradually growth.)
  if (/^\d+$/.test(v)) {
    return { kind: "pmid", value: v };
  }
  // DOI: strip optional URL / prefix, then match ``10.NNNN/anything``.
  const stripped = v
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim();
  if (/^10\.\d{4,9}\/[^\s]+$/.test(stripped)) {
    return { kind: "doi", value: stripped };
  }
  return null;
}

export function AddPublicationForm({
  onAdd,
  accession,
  title,
}: {
  onAdd: (pub: { pubmed_id?: string; doi?: string }) => void;
  accession: string;
  title: string;
}) {
  // One input, auto-classified. PMIDs are integers; DOIs match the
  // ``10.NNNN/...`` Crossref pattern, optionally wrapped in a
  // ``https://doi.org/`` URL or a ``doi:`` prefix. Anything else
  // shows a hint and the submit stays disabled. Two-field UX (one
  // for PMID, one for DOI) was an avoidable hoop — the format
  // disambiguates without curator help.
  const [value, setValue] = useState("");
  const parsed = parsePmidOrDoi(value);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!parsed) return;
    onAdd(
      parsed.kind === "pmid"
        ? { pubmed_id: parsed.value }
        : { doi: parsed.value },
    );
    setValue("");
  }

  // PubMed-search stubs. Two cases when the GEO submitter forgot to
  // link a publication: (1) a paper that mentions the GSE
  // accession in its text, (2) a paper by the dataset's submitter
  // whose title matches. Both open the relevant PubMed query in a
  // new tab — curator picks the right hit, copies the PMID, pastes
  // into the form below. Future: a gemma-mcp skill does this match
  // server-side and pre-fills.
  const accessionQuery = accession ? buildAccessionPubmedUrl(accession) : null;
  const titleQuery = title ? buildTitlePubmedUrl(title) : null;

  return (
    <div className="border-t border-slate-100 pt-2 space-y-2">
      {(accessionQuery || titleQuery) ? (
        <div className="flex items-center gap-2 flex-wrap text-[11px]">
          <span className="text-slate-500">find on PubMed:</span>
          {accessionQuery ? (
            <a
              href={accessionQuery}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-700 hover:underline"
              title={`Search PubMed for papers that mention "${accession}"`}
            >
              by accession ({accession}) ↗
            </a>
          ) : null}
          {titleQuery ? (
            <a
              href={titleQuery}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-700 hover:underline"
              title="Search PubMed using the experiment title as the query"
            >
              by title ↗
            </a>
          ) : null}
        </div>
      ) : null}
      <form
        onSubmit={submit}
        className="flex items-center gap-1.5 flex-wrap text-[11px]"
      >
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="PubMed ID or DOI"
          className="border border-slate-300 rounded px-1.5 py-0.5 flex-1 min-w-[14rem] font-mono"
          title="Paste a PMID (digits) or a DOI (10.xxxx/yyyy or https://doi.org/...). The form picks the right field for you."
        />
        {/* Tiny inline classifier hint — confirms the input parsed
            and tells the curator which field will be set on submit. */}
        {value.trim() ? (
          <span
            className={
              "text-[10px] uppercase tracking-wide " +
              (parsed ? "text-emerald-700" : "text-rose-700")
            }
          >
            {parsed ? parsed.kind : "unrecognised"}
          </span>
        ) : null}
        <button
          type="submit"
          className="btn primary !px-2 !py-0.5 text-[11px]"
          disabled={!parsed}
        >
          + add
        </button>
      </form>
    </div>
  );
}

/**
 * Find papers that mention the GSE / E-MTAB / etc accession.
 * The accession-as-text query catches papers that cite the dataset
 * in their methods or supplement, which is the most reliable signal
 * when the GEO record itself is missing the publication link.
 */
export function buildAccessionPubmedUrl(accession: string): string {
  const q = encodeURIComponent(`"${accession}"`);
  return `https://pubmed.ncbi.nlm.nih.gov/?term=${q}`;
}

/**
 * Title-based search. Less reliable than accession (titles get
 * reworded between the GEO submission and the manuscript) but
 * useful when the accession search returns nothing — often happens
 * with older datasets and brand-new submissions.
 */
export function buildTitlePubmedUrl(title: string): string {
  // Strip common GEO boilerplate that hurts title match recall:
  // "[bulk RNA-seq]", "(GSE…)", trailing date stamps, etc.
  const cleaned = title
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\(GSE\d+\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Quoted full-string match in PubMed's [Title] field. PubMed will
  // fall back to its own term-mapping if the exact match fails.
  const q = encodeURIComponent(`${cleaned}[Title]`);
  return `https://pubmed.ncbi.nlm.nih.gov/?term=${q}`;
}
