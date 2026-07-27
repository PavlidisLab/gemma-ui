/**
 * Inline term-detail popover anchored to a CURIE chip.
 *
 * Curator clicks the small CURIE portion of a Term chip and gets a
 * small floating card with the term's label, definition, parents,
 * and a footer source pill ("from Gemma" / "from OLS"). Beats
 * tabbing out to ``purl.obolibrary.org`` for the quick-verify case
 * — the canonical resolver is still available via the
 * "open in OBO ↗" link inside the popover.
 *
 * Two-stage fetch (per design review 2026-06-13 "fallback to OLS: require
 * another click"):
 *   1. On open, fetch from Gemma's ``/annotations/term``. If Gemma
 *      knows the term, render it.
 *   2. If Gemma returns null, show a "Fetch from OLS" button. Click
 *      enables the OLS query.
 *
 * Click-out / Escape closes. ``stopPropagation`` on every interactive
 * element so the underlying card (audit row, FV picker, …) doesn't
 * react to popover clicks.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  useGemmaTerm,
  useNcbiGene,
  useOlsTerm,
  useTermChildren,
  type TermChildren,
} from "@/api/annotations";
import { curieToUrl, ncbiGeneIdFromUri, shortenUri } from "@/lib/curie";

export interface CuriePopoverProps {
  uri: string;
  /** Anchor element — popover positions itself relative to it. */
  anchorRect: DOMRect;
  onClose: () => void;
}

export function CuriePopover({ uri, anchorRect, onClose }: CuriePopoverProps) {
  // In-card navigation: clicking a parent / alternate-id term walks the
  // popover to that term instead of stacking a second card (the reviewer
  // 2026-06-21 — "opens another card … might get confusing"; an in-place
  // trail with a back arrow keeps it to one card). The trail is the
  // breadcrumb of URIs visited from the chip the curator clicked; the
  // last entry is the term currently shown.
  const [trail, setTrail] = useState<string[]>([uri]);
  const [olsRequested, setOlsRequested] = useState(false);
  // Reset when the anchoring chip changes (the popover is reused across
  // chips). Drop back to a single-entry trail + clear the OLS request.
  useEffect(() => {
    setTrail([uri]);
    setOlsRequested(false);
  }, [uri]);
  const activeUri = trail[trail.length - 1] ?? uri;
  const navigateTo = (next: string) => {
    if (!next || next === activeUri) return;
    setTrail((t) => [...t, next]);
    setOlsRequested(false);
  };
  const goBack = () => {
    setTrail((t) => (t.length > 1 ? t.slice(0, -1) : t));
    setOlsRequested(false);
  };

  // NCBI gene URIs bypass Gemma + OLS entirely — they're not in OLS,
  // and Gemma's term endpoint returns nothing for them today. Hit
  // E-utilities directly so the curator sees gene symbol +
  // description + organism the first time the popover opens.
  const isNcbiGene = !!ncbiGeneIdFromUri(activeUri);
  const gemma = useGemmaTerm(isNcbiGene ? null : activeUri);
  const ols = useOlsTerm(isNcbiGene ? null : activeUri, olsRequested);
  const ncbi = useNcbiGene(isNcbiGene ? activeUri : null);
  // Immediate children — a lazy, cached OLS4 side-fetch (Gemma ships no
  // children). Runs in parallel with the primary lookup so it never
  // delays the card; the children line just fills in when it resolves.
  const childrenQ = useTermChildren(activeUri, !isNcbiGene);

  const gemmaDone = !gemma.isLoading;
  const gemmaHit = !!gemma.data;
  // A prior "Fetch from OLS" click leaves the result in the query
  // cache (keyed on the URI, long ``gcTime``). ``useOlsTerm`` returns
  // that cached value even while disabled, so ``ols.data`` is the
  // durable signal — read it directly instead of the per-mount
  // ``olsRequested`` flag, which resets to ``false`` every time the
  // popover is reopened and used to drop the already-fetched result
  // back to the "Fetch from OLS" CTA (design review 2026-06-19).
  const olsHit = !!ols.data;
  // Gemma stays the primary source when it knows the term (don't
  // surprise the curator by switching sources after they didn't ask);
  // fall back to a cached/just-fetched OLS result only when Gemma misses.
  const detail = isNcbiGene
    ? ncbi.data ?? null
    : gemma.data ?? (olsHit ? ols.data : null);
  // Show the CTA only when Gemma missed AND we have no OLS result yet.
  // ``!olsRequested`` keeps the CTA from flashing back during the
  // in-flight fetch (before ``ols.data`` resolves).
  const showOlsCta =
    !isNcbiGene && gemmaDone && !gemmaHit && !olsRequested && !olsHit;
  const primaryLoading = isNcbiGene ? ncbi.isLoading : gemma.isLoading;

  // Position: below the chip if there's room, else above. Width
  // capped so the popover doesn't blow up on a wide screen.
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({
    left: anchorRect.left,
    top: anchorRect.bottom + 6,
  });
  useEffect(() => {
    if (!popoverRef.current) return;
    const rect = popoverRef.current.getBoundingClientRect();
    const margin = 8;
    let left = anchorRect.left;
    if (left + rect.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    let top = anchorRect.bottom + 6;
    if (top + rect.height > window.innerHeight - margin) {
      top = anchorRect.top - rect.height - 6;
      if (top < margin) top = margin;
    }
    setPos({ left, top });
  }, [anchorRect, detail]);

  // Outside-click + Escape close.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!popoverRef.current) return;
      if (e.target instanceof Node && !popoverRef.current.contains(e.target)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`Ontology term ${shortenUri(activeUri)}`}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="fixed z-50 rounded-md border border-slate-300 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800 max-w-sm min-w-[18rem] text-[11px]"
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="px-3 py-2 space-y-1.5">
        <div className="flex items-baseline gap-2 flex-wrap">
          {trail.length > 1 ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                goBack();
              }}
              className="text-[11px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 -ml-0.5"
              aria-label="Back to previous term"
              title="Back"
            >
              ←
            </button>
          ) : null}
          <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
            {shortenUri(activeUri)}
          </span>
          {detail?.ontology ? (
            <span className="text-[9px] uppercase tracking-wide text-slate-400">
              {detail.ontology}
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

        {primaryLoading ? (
          <Loading source={isNcbiGene ? "ncbi" : undefined} />
        ) : detail ? (
          <Body
            detail={detail}
            childrenResult={childrenQ.data ?? null}
            onNavigate={navigateTo}
          />
        ) : showOlsCta ? (
          <NotInGemmaCta
            uri={activeUri}
            onFetchOls={() => setOlsRequested(true)}
          />
        ) : ols.isLoading ? (
          <Loading source="ols" />
        ) : (
          <NotFound uri={activeUri} />
        )}
      </div>
    </div>,
    document.body,
  );
}

function Loading({ source }: { source?: "ols" | "ncbi" }) {
  const label =
    source === "ols"
      ? "Fetching from OLS…"
      : source === "ncbi"
        ? "Fetching from NCBI…"
        : "Looking up…";
  return (
    <div className="text-slate-500 dark:text-slate-400 italic">{label}</div>
  );
}

/** How many immediate children to list inline before collapsing the
 *  rest into a "(+N more)" tail — a couple is enough to hint that a
 *  narrower term exists without turning the card into a subclass dump. */
const MAX_SHOWN_CHILDREN = 4;

function Body({
  detail,
  childrenResult,
  onNavigate,
}: {
  detail: NonNullable<ReturnType<typeof useGemmaTerm>["data"]>;
  /** Immediate children (direct subclasses) of the term, or null while
   *  the lazy fetch is pending / when the term has none. */
  childrenResult: TermChildren | null;
  /** Walk the popover to another term (parent / alternate id / child). */
  onNavigate: (uri: string) => void;
}) {
  return (
    <>
      <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
        {detail.label || <em className="text-slate-400">(no label)</em>}
      </div>
      {detail.taxonScientificName ? (
        <div className="text-[11px] italic text-slate-600 dark:text-slate-300">
          {detail.taxonScientificName}
          {detail.taxonId ? (
            <span className="not-italic text-slate-400 dark:text-slate-500">
              {" "}
              · NCBI Taxon {detail.taxonId}
            </span>
          ) : null}
        </div>
      ) : null}
      {detail.synonyms.length > 0 ? (
        // Aliases / synonyms sit directly under the label (the reviewer
        // 2026-06-21) — they're identity info ("cerebral ischemia" tells
        // the curator the chip's label IS this term), so they belong
        // above the definition. Text, not links: a synonym is an
        // alternate label of THIS term, there's no other term to open.
        // Scope rides in the hover title; the primary label/symbol is
        // filtered out upstream.
        <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
          <span className="font-semibold">
            {detail.source === "ncbi" ? "aliases: " : "synonyms: "}
          </span>
          {detail.synonyms.map((s, i) => (
            <span
              key={`${s.value}-${i}`}
              title={s.type ? s.type.replace(/_/g, " ") : undefined}
            >
              {i > 0 ? ", " : ""}
              {s.value}
            </span>
          ))}
        </div>
      ) : null}
      {detail.definition ? (
        <div
          className="text-slate-600 dark:text-slate-300 leading-snug"
          // CHEBI / ChEBI-derived definitions ship inline chemistry
          // formatting as HTML — ``<small>L</small>-Phenylalaninamide``,
          // ``<em>N</em><sup>α</sup>`` etc. — and rendering the
          // definition as a plain React child escapes those tags so
          // curators saw the angle brackets verbatim (design review 2026-06-15).
          // The whitelist below re-enables ONLY inline text-formatting
          // tags; everything else is escaped. No attributes survive →
          // no event handlers / scripts / links can ride in.
          dangerouslySetInnerHTML={{ __html: sanitizeDefinitionHtml(detail.definition) }}
        />
      ) : (
        <div className="italic text-slate-400 dark:text-slate-500">
          No definition recorded
        </div>
      )}
      {detail.parents.length > 0 ? (
        <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
          <span className="font-semibold">parents: </span>
          {detail.parents.map((p, i) => (
            <span key={`${p.uri ?? p.label}-${i}`}>
              {i > 0 ? ", " : ""}
              {p.uri ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigate(p.uri!);
                  }}
                  className="text-blue-700 hover:underline dark:text-blue-300"
                  title={`open ${shortenUri(p.uri)}`}
                >
                  {p.label}
                </button>
              ) : (
                p.label
              )}
            </span>
          ))}
        </div>
      ) : null}
      {childrenResult ? (
        childrenResult.children.length > 0 ? (
          // Immediate children — lets the curator spot a MORE SPECIFIC
          // term one level down. Clickable (walks the popover in-place
          // like parents); the tail collapses to "(+N more)" so a term
          // with 100 subclasses doesn't blow up the card. Only one level
          // is fetched, so this stays cheap.
          (() => {
            const shown = childrenResult.children.slice(0, MAX_SHOWN_CHILDREN);
            const moreCount = childrenResult.total - shown.length;
            return (
              <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
                <span className="font-semibold">children: </span>
                {shown.map((c, i) => (
                  <span key={`${c.uri ?? c.label}-${i}`}>
                    {i > 0 ? ", " : ""}
                    {c.uri ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onNavigate(c.uri!);
                        }}
                        className="text-blue-700 hover:underline dark:text-blue-300"
                        title={`open ${shortenUri(c.uri)}`}
                      >
                        {c.label}
                      </button>
                    ) : (
                      c.label
                    )}
                  </span>
                ))}
                {moreCount > 0 ? (
                  <span className="text-slate-400 dark:text-slate-500">
                    {" "}
                    (+{moreCount} more)
                  </span>
                ) : null}
              </div>
            );
          })()
        ) : (
          // Definitively no children (a well-formed empty page) — mark it
          // a leaf so the curator knows this is the most specific term in
          // the hierarchy, not that the lookup is still pending / failed.
          <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
            <span className="font-semibold">children: </span>
            <span className="italic text-slate-400 dark:text-slate-500">
              none — leaf term
            </span>
          </div>
        )
      ) : null}
      {detail.alternativeIds.length > 0 ? (
        // Obsolete / merged IDs that fold INTO this term — they have no
        // class of their own, so they're informational text, NOT links.
        // (They used to be clickable and dead-ended on an empty "No
        // definition recorded" card — Design review 2026-06-21.)
        <div
          className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug"
          title="Alternate / obsolete IDs merged into this term"
        >
          <span className="font-semibold">alt IDs: </span>
          <span className="font-mono">{detail.alternativeIds.join(", ")}</span>
        </div>
      ) : null}
      {detail.xrefs.length > 0 ? (
        // Cross-references to OTHER vocabularies (DOID / ICD / UMLS / …).
        // These live outside the ontology Gemma loaded, so they're
        // informational text, not internally navigable. Design review 2026-06-21.
        <div
          className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug"
          title="Cross-references to other vocabularies"
        >
          <span className="font-semibold">xrefs: </span>
          <span className="font-mono">{detail.xrefs.join(", ")}</span>
        </div>
      ) : null}
      <div className="flex items-baseline gap-2 pt-1 border-t border-slate-200 dark:border-slate-700 mt-1">
        <span
          className={
            // No ``uppercase`` — "Gemma" is a name, not an acronym, and
            // shouting it (design review 2026-06-21) read wrong. "OLS" / "NCBI"
            // are already capitalised in the literal.
            detail.source === "ols"
              ? "text-[9px] tracking-wide text-indigo-700 dark:text-indigo-300"
              : detail.source === "ncbi"
                ? "text-[9px] tracking-wide text-amber-700 dark:text-amber-300"
                : "text-[9px] tracking-wide text-emerald-700 dark:text-emerald-300"
          }
        >
          {detail.source === "ols"
            ? "from OLS"
            : detail.source === "ncbi"
              ? "from NCBI"
              : "from Gemma"}
        </span>
        {detail.ontologyVersion ? (
          // Discreet ontology-release vintage (design review 2026-06-21). Prefixed
          // with the ontology name from the term's CURIE so a bare
          // ``3.91.0`` reads as ``EFO 3.91.0`` — not an app version. The
          // raw value rides in the hover title.
          <span
            className="text-[9px] text-slate-400 dark:text-slate-500 truncate max-w-[10rem]"
            title={detail.ontologyVersion}
          >
            {formatOntologyVersion(detail.uri, detail.ontologyVersion)}
          </span>
        ) : null}
        {detail.canonicalUrl ? (
          <a
            href={detail.canonicalUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="ml-auto text-[10px] text-blue-700 hover:underline dark:text-blue-300"
          >
            {detail.source === "ncbi" ? "open in NCBI Gene ↗" : "open in OBO ↗"}
          </a>
        ) : null}
      </div>
    </>
  );
}

function NotInGemmaCta({
  uri,
  onFetchOls,
}: {
  uri: string;
  onFetchOls: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="italic text-slate-500 dark:text-slate-400">
        Gemma doesn&rsquo;t know this term.
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onFetchOls();
        }}
        className="text-[11px] px-2 py-0.5 rounded border border-blue-400 bg-blue-50 text-blue-900 hover:bg-blue-100 dark:border-blue-600 dark:bg-blue-900/30 dark:text-blue-100 dark:hover:bg-blue-900/50"
      >
        Fetch from OLS
      </button>
      <div className="text-[10px] text-slate-400">
        <a
          href={curieToUrl(uri) ?? uri}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="hover:underline"
        >
          or open in OBO ↗
        </a>
      </div>
    </div>
  );
}

function NotFound({ uri }: { uri: string }) {
  return (
    <div className="space-y-1">
      <div className="italic text-slate-500 dark:text-slate-400">
        Term not found.
      </div>
      <a
        href={curieToUrl(uri) ?? uri}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-[10px] text-blue-700 hover:underline dark:text-blue-300"
      >
        open in OBO ↗
      </a>
    </div>
  );
}

/** Compact, labelled display for an ontology-version string.
 *
 *  The value is wildly inconsistent across ontologies: EFO ships a bare
 *  semver (``3.91.0``), MONDO a full release IRI
 *  (``http://…/mondo/releases/2026-06-02/mondo.owl``), UBERON a date
 *  (``2026-04-01``). A bare ``3.91.0`` with no ontology name reads like
 *  an app version (design review 2026-06-21), so prefix with the ontology name
 *  taken from the term's CURIE → ``EFO 3.91.0`` / ``MONDO 2026-06-02``.
 *  Release IRIs collapse to their embedded date (else file basename). */
function formatOntologyVersion(uri: string, version: string): string {
  let v = version.trim();
  if (/^https?:\/\//.test(v)) {
    v = v.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? (v.split("/").filter(Boolean).pop() || v);
  }
  // Ontology prefix from the CURIE (``EFO:0005168`` → ``EFO``); skip
  // when the URI doesn't shorten to a clean ``PREFIX:id`` shape.
  const curie = shortenUri(uri);
  const prefix =
    curie.includes(":") && !curie.includes("/") ? curie.split(":")[0] : "";
  return prefix ? `${prefix} ${v}` : v;
}

/** Whitelist-based HTML sanitiser for ontology definitions.
 *
 *  CHEBI / ChEBI-derived definitions ship inline formatting via
 *  HTML — ``<small>L</small>-Phenylalaninamide``,
 *  ``<em>N</em><sup>α</sup>``, etc. — and those tags are
 *  meaningful (italic stereodescriptors, superscript locants).
 *  Stripping them loses chemistry; rendering them raw is unsafe.
 *
 *  Strategy: HTML-escape EVERYTHING, then re-enable only the
 *  inline text-formatting tags from a small whitelist by replacing
 *  the escaped sequences back to their tag form. No attributes
 *  survive — no event handlers, no ``javascript:`` URLs, no
 *  ``style``. Closing tags + the void ``<br>`` are also allowed
 *  (un-paired ``<br>`` shows up in some XML-ish OWL serialisations
 *  of definitions). */
function sanitizeDefinitionHtml(raw: string): string {
  const escaped = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const allowed = ["small", "sup", "sub", "em", "i", "b", "strong"];
  let html = escaped;
  for (const tag of allowed) {
    const open = new RegExp(`&lt;${tag}&gt;`, "gi");
    const close = new RegExp(`&lt;/${tag}&gt;`, "gi");
    html = html.replace(open, `<${tag}>`).replace(close, `</${tag}>`);
  }
  html = html.replace(/&lt;br\s*\/?&gt;/gi, "<br/>");
  return html;
}
