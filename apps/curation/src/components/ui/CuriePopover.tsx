/**
 * Inline term-detail popover anchored to a CURIE chip.
 *
 * Curator clicks the small CURIE portion of a Term chip and gets a
 * small floating card with the term's label, definition, parents,
 * and a footer source pill ("from Gemma" / "from OLS"). Beats
 * tabbing out to ``purl.obolibrary.org`` for the quick-verify case
 * — the external browsers are still available via the
 * "open in Ontobee ↗ · OLS ↗" links inside the popover, and the raw
 * IRI is one click away via the footer copy button.
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
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  useGemmaTerm,
  useNcbiGene,
  useOlsTerm,
  useTermChildren,
  useTermSynonyms,
  type TermChildren,
} from "@/api/annotations";
import {
  cellosaurusUrl,
  curieToUrl,
  isOlsHosted,
  mgiUrl,
  ncbiGeneIdFromUri,
  olsUrl,
  ontobeeUrl,
  shortenUri,
  termRegistry,
} from "@/lib/curie";
import {
  alertFact,
  deriveFromTerm,
  type DerivedFact,
} from "@/lib/derivedFacts";
import {
  BASIS_COPY,
  DEFAULT_MAX_OBJECT_BREADTH,
  isTopicRelation,
  mergeRelations,
  rankRelations,
  useTermRelations,
  withinBreadth,
  type MergedRelation,
} from "@/api/termRelations";
import { GeneSpeciesMark } from "@/components/ui/GeneSpeciesMark";
import { geneDisplayLabel, isGeneUri } from "@/lib/gene";

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
  // Every OLS path below — the primary fallback, the children and
  // synonyms side-fetches, and the "Fetch from OLS" CTA — is gated on
  // OLS actually indexing this ontology. TGEMO, Cellosaurus and MGI
  // aren't in OLS, so those calls could only ever come back empty:
  // wasted round-trips, and a CTA that promises a lookup it can't do.
  const olsCapable = !isNcbiGene && isOlsHosted(activeUri);
  const gemma = useGemmaTerm(isNcbiGene ? null : activeUri);
  const ols = useOlsTerm(olsCapable ? activeUri : null, olsRequested);
  const ncbi = useNcbiGene(isNcbiGene ? activeUri : null);
  // Immediate children — a lazy, cached OLS4 side-fetch (Gemma ships no
  // children). Runs in parallel with the primary lookup so it never
  // delays the card; the children line just fills in when it resolves.
  const childrenQ = useTermChildren(activeUri, olsCapable);
  // Synonyms side-fetch — Gemma's term payload ships synonyms for some
  // terms but not others; fill the gap from OLS in parallel, used only
  // when the primary source shipped none.
  const synonymsQ = useTermSynonyms(activeUri, olsCapable);
  // What else is known about this term — Gemma's ANNOTATION_RELATION.
  // Always on, for every term (not gated on ``olsCapable``): the source
  // is Gemma, not OLS, and the relations that matter most are on terms
  // OLS never indexes — Cellosaurus lines, MGI strains, TGEMO models.
  // One request per popover a curator opened, which is the whole reason
  // this is affordable; the contract's own warning is that one call per
  // row of a browse page is fifty queries.
  const relationsQ = useTermRelations(activeUri, true);
  // Merge the copies the harvest emits for one fact, drop the objects
  // that identify nothing, then rank — all three in `api/termRelations`
  // with the measurements that forced them.
  const relations = useMemo(() => {
    const rows = relationsQ.data ?? null;
    if (!rows) return null;
    return rankRelations(
      withinBreadth(
        mergeRelations(rows.filter(isTopicRelation)),
        DEFAULT_MAX_OBJECT_BREADTH,
      ),
    );
  }, [relationsQ.data]);

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
  const detailRaw = isNcbiGene
    ? ncbi.data ?? null
    : gemma.data ?? (olsHit ? ols.data : null);
  const sideSynonyms = synonymsQ.data;
  // Backfill synonyms from the OLS side-fetch when the primary source
  // (usually Gemma) shipped none — so a curator seeing "Ammothamnine"
  // still gets "oxymatrine, matrine oxide, …" rather than a bare card.
  // Memoized so the backfilled object keeps a stable identity across
  // renders (a positioning effect depends on it).
  const detail = useMemo(() => {
    if (detailRaw && detailRaw.synonyms.length === 0 && (sideSynonyms?.length ?? 0) > 0) {
      return { ...detailRaw, synonyms: sideSynonyms! };
    }
    return detailRaw;
  }, [detailRaw, sideSynonyms]);
  // Show the CTA only when Gemma missed AND we have no OLS result yet.
  // ``!olsRequested`` keeps the CTA from flashing back during the
  // in-flight fetch (before ``ols.data`` resolves).
  const showOlsCta =
    olsCapable && gemmaDone && !gemmaHit && !olsRequested && !olsHit;
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
          <CuriePopoverBody
            detail={detail}
            childrenResult={childrenQ.data ?? null}
            relations={relations}
            activeUri={activeUri}
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

/** How many relations to list before collapsing the tail. The card is
 *  small and the panel is reference material, not a worklist — a term
 *  with fifty relations should not push the source pills off screen. */
const MAX_SHOWN_RELATIONS = 5;

/** How many immediate children to list inline before collapsing the
 *  rest into a "(+N more)" tail — a couple is enough to hint that a
 *  narrower term exists without turning the card into a subclass dump. */
const MAX_SHOWN_CHILDREN = 4;

/**
 * Facts a catalogue asserts about the term, rendered so they can never
 * be mistaken for the term's own definition or for a curator's claim.
 *
 * Three cues carry the "derived" class, matching the axis
 * ``features/audit/evidenceSource.ts`` already establishes for evidence
 * provenance (colour = kind of source, badge = which source, and green
 * stays reserved for ontology-backed): an indigo rule down the left, a
 * "derived" caption naming the class, and a per-row source badge. A row
 * is deliberately NOT a term chip — no catalogue ships a grounded URI
 * for these yet, and a chip opening a card Gemma can't resolve would
 * dead-end the curator.
 *
 * Grouped by relation because one term carries several facts at once
 * and two diseases from one CLO description are two rows, not one.
 */
function DerivedBlock({ facts }: { facts: DerivedFact[] }) {
  const byRelation = new Map<string, DerivedFact[]>();
  for (const f of facts) {
    // The alert row is already hoisted above the definition; repeating
    // it here would read as two separate findings.
    if (f.tone === "warn") continue;
    const list = byRelation.get(f.relation);
    if (list) list.push(f);
    else byRelation.set(f.relation, [f]);
  }
  if (byRelation.size === 0) return null;
  return (
    <div className="border-l-2 border-indigo-300 dark:border-indigo-600 pl-2 mt-0.5 space-y-0.5">
      <div
        className="text-[9px] uppercase tracking-wide text-indigo-700/90 dark:text-indigo-300/90"
        title="Read from a catalogue, not curated by anyone. Derived facts can be wrong — verify before relying on one."
      >
        derived
      </div>
      {[...byRelation.entries()].map(([relation, rows]) => (
        <div key={relation} className="text-[10px] leading-snug">
          <span className="text-slate-500 dark:text-slate-400">{relation}: </span>
          <span className="text-slate-700 dark:text-slate-200">
            {rows.map((r) => r.value).join(" · ")}
          </span>{" "}
          <span
            className="text-[9px] text-indigo-700/80 dark:text-indigo-300/80"
            title={`Read from ${rows[0].source}'s ${rows[0].sourceDetail}`}
          >
            {rows[0].source}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * What else is known about this term — Gemma's `ANNOTATION_RELATION`.
 *
 * 🛑 **These are not annotations, and nothing here is actionable.** No
 * row was written onto any experiment. A curator reading this in the
 * tag list would take it for somebody's claim about the dataset in
 * front of them and for something they could edit; it is neither, which
 * is why it lives in a term card and nowhere near the design. There is
 * deliberately no Accept, no Add, and no "apply this" — an inference
 * that becomes a tag stops being recomputable, and the curator still
 * has to make the annotation themselves.
 *
 * 🛑 **Rendered literally, `subject — predicate → object`.** Which end a
 * term sits on is the curator's choice of predicate, and both shapes
 * are in the corpus: `SNCA → has disease → Parkinson disease` and
 * `disease model: autism → has_genotype → Mef2c`. A renderer that
 * normalized them into "related disease" would draw half the corpus
 * backwards, so the arrow states the direction and the predicate is
 * never reworded.
 *
 * 🛑 **The basis rides on every row.** "A curator asserted this" and
 * "this co-occurs in our corpus" are different claims, and a row that
 * does not say which invites the weaker one to be read as the stronger.
 */
function RelatedBlock({
  relations,
  activeUri,
  onNavigate,
}: {
  relations: readonly MergedRelation[];
  activeUri: string;
  onNavigate: (uri: string) => void;
}) {
  const shown = relations.slice(0, MAX_SHOWN_RELATIONS);
  const more = relations.length - shown.length;
  return (
    <div className="pt-1 border-t border-slate-200 dark:border-slate-700 space-y-1">
      <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
        related terms{" "}
        {/* Says what class of thing these are, in the words the rest of
            the app uses: "derived" is a fact read from OUTSIDE the
            experiment, distinct from "inherited" (a projection up from
            a sample characteristic) and from curated. */}
        <span className="font-normal italic">— derived, not curated</span>
      </div>
      {shown.map((r, i) => (
        <RelatedRow
          key={`${r.basis}-${r.predicate}-${r.object}-${i}`}
          relation={r}
          activeUri={activeUri}
          onNavigate={onNavigate}
        />
      ))}
      {more > 0 ? (
        <div className="text-[10px] text-slate-400 dark:text-slate-500">
          (+{more} more)
        </div>
      ) : null}
    </div>
  );
}

/** One relation, from the point of view of the term on screen. */
function RelatedRow({
  relation,
  activeUri,
  onNavigate,
}: {
  relation: MergedRelation;
  activeUri: string;
  onNavigate: (uri: string) => void;
}) {
  // Which end is the OTHER one. Compared on the resolved IRI so a CURIE
  // on either side still matches.
  const active = (curieToUrl(activeUri) ?? activeUri).toLowerCase();
  const subjectIri = (
    curieToUrl(relation.subject_uri ?? "") ??
    relation.subject_uri ??
    ""
  ).toLowerCase();
  const activeIsSubject = !!subjectIri && subjectIri === active;
  const other = activeIsSubject
    ? { label: relation.object, uri: relation.object_uri ?? null }
    : { label: relation.subject, uri: relation.subject_uri ?? null };
  const basis = BASIS_COPY[relation.basis] ?? {
    label: relation.basis,
    title: "",
  };
  const support = relation.number_of_experiments ?? 0;
  return (
    <div className="text-[10px] leading-snug text-slate-600 dark:text-slate-300">
      <span className="text-slate-500 dark:text-slate-400">
        {/* The arrow carries the direction so the predicate never has to
            be reworded to fit the reading order. */}
        {activeIsSubject ? "→ " : "← "}
        {relation.predicate}
      </span>{" "}
      <OtherEnd term={other} taxon={relation.taxon_name} onNavigate={onNavigate} />
      {/* Basis and support ride on the SAME line, dim. They have to be
          visible — "a curator asserted this" and "this co-occurs in our
          corpus" are different claims and a row that does not say which
          invites the weaker to be read as the stronger — but a second
          line per row made the section taller than the definition it
          sits under. Everything that is detail rather than claim (the
          ontology version, what "folded" means, how support is counted)
          is in the hover. */}
      <span className="text-[9px] text-slate-400 dark:text-slate-500">
        {" · "}
        <span title={basis.title}>{basis.label}</span>
        {relation.source ? (
          <span title={relation.source_version ?? undefined}>
            {" "}
            {relation.source}
          </span>
        ) : null}
        {/* 🛑 Support is what THIS caller can see — ACL-exact, counted
            at read — so it is phrased as datasets we can show, never as
            a property of the relation. Absent on an asserted basis,
            where 0 means "not counted", not "no evidence". */}
        {support > 0 ? (
          <span title="Datasets you can see that carry this relation. Counted behind your permissions, so another curator may see a different number.">
            {" "}
            · {support} dataset{support === 1 ? "" : "s"}
          </span>
        ) : null}
        {relation.copies > 1 ? (
          <span title="The source emits this fact more than once, split on fields that do not change what it says. Folded here; the count shown is the largest of them.">
            {" "}
            · folded {relation.copies}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** The far end of a relation: navigable when it is grounded, a gene
 *  chip when it is a gene.
 *
 *  Genes get the symbol-plus-species treatment every other surface
 *  gives them. A gene shown without its species has misled a reader
 *  before, and relation subjects are frequently genes — the corpus
 *  stores them as NCBI gene IRIs, not ontology terms. */
function OtherEnd({
  term,
  taxon,
  onNavigate,
}: {
  term: { label: string; uri: string | null };
  taxon: string | null | undefined;
  onNavigate: (uri: string) => void;
}) {
  const gene = isGeneUri(term.uri);
  const label = gene ? geneDisplayLabel(term.label, term.uri) : term.label;
  const body = (
    <>
      {label}
      {gene ? (
        <GeneSpeciesMark
          uri={term.uri}
          species={taxon ?? null}
          // 🛑 No dataset to compare against — a term card is not an
          // experiment page. That yields the "unchecked" verdict, which
          // shows the species and claims nothing about whether it is
          // the right one. Passing the RELATION's taxon here would be
          // comparing a value with itself and rendering a match nobody
          // checked.
          datasetTaxon={null}
          className="ml-0.5"
        />
      ) : null}
    </>
  );
  if (!term.uri) {
    // Ungrounded values are ordinary, not broken — `aortic banding` has
    // no URI and is a perfectly good object. Plain text, no dead link.
    return <span className="text-slate-700 dark:text-slate-200">{body}</span>;
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onNavigate(term.uri!);
      }}
      className="text-blue-700 hover:underline dark:text-blue-300"
      title={`open ${shortenUri(term.uri)}`}
    >
      {body}
    </button>
  );
}

/** Exported for render tests: the card body is where the sections
 *  live, and asserting on what a curator reads means rendering it
 *  directly rather than booting the popover's four fetches. Production
 *  only ever mounts it through {@link CuriePopover}. */
export function CuriePopoverBody({
  detail,
  childrenResult,
  relations,
  activeUri,
  onNavigate,
}: {
  detail: NonNullable<ReturnType<typeof useGemmaTerm>["data"]>;
  /** Immediate children (direct subclasses) of the term, or null while
   *  the lazy fetch is pending / when the term has none. */
  childrenResult: TermChildren | null;
  /** Relations this term takes part in, either end. Null while the
   *  side-fetch is pending; empty for the many terms nothing is
   *  recorded about, which renders as nothing at all. */
  relations: readonly MergedRelation[] | null;
  /** The term the card is currently showing — decides which end of each
   *  relation is "the other one". */
  activeUri: string;
  /** Walk the popover to another term (parent / alternate id / child). */
  onNavigate: (uri: string) => void;
}) {
  // Derived facts are lifted out of the term BEFORE the definition
  // renders: a CLO cell line's ``definition`` may BE a derived fact
  // ("disease: plasmacytoma;   myeloma"), and showing that in the
  // definition slot would present a catalogue's inference as the term's
  // meaning. See lib/derivedFacts.ts for the class distinction.
  const { definition, facts } = deriveFromTerm(detail);
  const alert = alertFact(facts);
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
      {alert ? (
        // Hoisted above the definition on purpose: a Cellosaurus
        // contamination flag is the one derived fact that should stop a
        // curator mid-annotation, and Cellosaurus definitions run to
        // ~900 characters, so anywhere below here it is buried.
        <div className="flex items-baseline gap-1.5 rounded border border-amber-300 bg-amber-50/70 px-1.5 py-1 text-[10px] text-amber-900 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-100">
          <span aria-hidden="true">⚠</span>
          <span>
            <span className="font-semibold">{alert.value}</span> — this line is
            flagged by {alert.source}. Check it is the line the study means.
          </span>
        </div>
      ) : null}
      {definition ? (
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
          dangerouslySetInnerHTML={{ __html: sanitizeDefinitionHtml(definition) }}
        />
      ) : facts.length === 0 ? (
        // Only claim "no definition" when there's nothing at all. A CLO
        // cell line whose definition WAS the derived disease fact has
        // one — it just isn't a definition, and it renders below.
        <div className="italic text-slate-400 dark:text-slate-500">
          No definition recorded
        </div>
      ) : null}
      {facts.length > 0 ? <DerivedBlock facts={facts} /> : null}
      {relations && relations.length > 0 ? (
        <RelatedBlock
          relations={relations}
          activeUri={activeUri}
          onNavigate={onNavigate}
        />
      ) : null}
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
        <TermLinkOuts
          uri={detail.uri}
          source={detail.source}
          oboUrl={detail.canonicalUrl ?? curieToUrl(detail.uri)}
          label={detail.label}
        />
      </div>
    </>
  );
}

/** External link-outs for a term, shown in the popover footer. One
 *  "open in" label followed by the applicable targets — the label is
 *  never repeated per link (design review 2026-08-02) — then a
 *  copy-the-IRI button, which is always present even when the term has
 *  no browsable home.
 *
 *  **Every link offered must be able to resolve, and to a DISTINCT
 *  page.** A term only gets the registry that actually holds it,
 *  decided by ``termRegistry``: OBO Foundry terms get Ontobee + OLS,
 *  EFO gets a single OLS link (its canonical IRI already redirects
 *  there), and TGEMO gets its own canonical Gemma link and nothing
 *  else — neither Ontobee nor OLS has it. **Cell lines** also get a
 *  Cellosaurus link: a native Cellosaurus term (CVCL accession) gets
 *  ONLY that, while a Cell-Line-Ontology term (CLO) keeps Ontobee + OLS
 *  and adds a Cellosaurus name-search alongside. NCBI genes keep their
 *  single Gene link. **Mouse strains** get an MGI link — the
 *  URI is the page there, so it is the one registry that needs no
 *  builder. Anything we still can't place (unrecognised prefixes) gets
 *  no registry link rather than a guess. */
function TermLinkOuts({
  uri,
  source,
  oboUrl,
  label,
}: {
  uri: string;
  source?: string;
  oboUrl: string | null;
  label?: string | null;
}) {
  const linkCls =
    "text-[10px] text-blue-700 hover:underline dark:text-blue-300";
  const links: Array<{ key: string; href: string; label: string }> = [];
  const cvcl = cellosaurusUrl(uri, label);
  const nativeCvcl = /CVCL_\d+/i.test(uri);
  const mgi = mgiUrl(uri);
  if (source === "ncbi") {
    if (oboUrl) links.push({ key: "ncbi", href: oboUrl, label: "NCBI Gene" });
  } else if (nativeCvcl && cvcl) {
    // Native Cellosaurus entity — OBO/OLS don't host it.
    links.push({ key: "cvcl", href: cvcl, label: "Cellosaurus" });
  } else if (mgi) {
    // A mouse strain grounded to MGI. Gemma resolves these (and the
    // write gate accepts them), so curators can now bind a strain to
    // one — and until this link existed, that binding was the only kind
    // in the app a curator could not open and check.
    links.push({ key: "mgi", href: mgi, label: "MGI" });
  } else {
    // Only offer the registry that actually holds the term. TGEMO,
    // Cellosaurus and MGI are in neither OBO nor OLS, so a blanket
    // "OBO · OLS" pair on those sent the curator to a 404 or an empty
    // OLS result page. TGEMO still gets its own canonical link — it has
    // a real home at gemma.msl.ubc.ca/ont, it just isn't OBO's.
    //
    // For OBO terms the first link is Ontobee, NOT the bare purl: the
    // purl content-negotiates an HTML request straight to OLS, so the
    // old "OBO" link and the "OLS" link beside it opened the same page.
    const registry = termRegistry(uri);
    const ontobee = ontobeeUrl(uri);
    if (registry === "obo" && ontobee) {
      links.push({ key: "ontobee", href: ontobee, label: "Ontobee" });
    } else if (oboUrl && registry === "tgemo") {
      links.push({ key: "tgemo", href: oboUrl, label: "TGEMO" });
    }
    if (oboUrl && registry === "efo") {
      // EFO's canonical IRI redirects to the OLS4 *entity* page — a
      // better target than the OLS search below, and the same
      // destination, so it takes the OLS slot rather than sitting
      // beside it under a second label.
      links.push({ key: "efo", href: oboUrl, label: "OLS" });
    } else {
      const ols = olsUrl(uri);
      if (ols) links.push({ key: "ols", href: ols, label: "OLS" });
    }
    // CLO cell line (or any cell line resolvable by name) → Cellosaurus.
    if (cvcl) links.push({ key: "cvcl", href: cvcl, label: "Cellosaurus" });
  }
  return (
    <span className="ml-auto flex items-baseline gap-1 text-[10px] text-slate-400 dark:text-slate-500">
      {links.length > 0 ? <span>open in</span> : null}
      {links.map((l, i) => (
        <span key={l.key} className="flex items-baseline gap-1">
          {i > 0 ? <span aria-hidden>·</span> : null}
          <a
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={linkCls}
          >
            {l.label} ↗
          </a>
        </span>
      ))}
      {links.length > 0 ? (
        // Divider, not the "·" used between link-outs — copy isn't one
        // of the "open in" targets.
        <span aria-hidden className="text-slate-300 dark:text-slate-600">
          |
        </span>
      ) : null}
      <CopyUriButton uri={uri} className={linkCls} />
    </span>
  );
}

/** Copy the term's full IRI to the clipboard. The IRI — not the CURIE
 *  — because that's what every downstream box wants pasted into it
 *  (Gemma's term endpoint, an OLS search, a ticket, a note); the CURIE
 *  is already on screen and selectable. Bare CURIEs are resolved
 *  through ``curieToUrl`` first so the copied value is the same string
 *  the link-outs point at.
 *
 *  Confirms in place for ~1.2 s rather than raising a toast — the
 *  popover is transient and a toast outliving it reads as unrelated. */
function CopyUriButton({ uri, className }: { uri: string; className: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const iri = curieToUrl(uri) ?? uri;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        try {
          navigator.clipboard?.writeText(iri);
        } catch {
          // best effort
        }
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1200);
      }}
      className={className}
      title={`Copy ${iri} to the clipboard`}
    >
      {copied ? "copied ✓" : "copy URI"}
    </button>
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
        <TermLinkOuts uri={uri} oboUrl={curieToUrl(uri)} />
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
      <TermLinkOuts uri={uri} oboUrl={curieToUrl(uri)} />
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
  if (!prefix) return v;
  // Some ontologies ship a NAME where a version belongs — Gemma returns
  // ``ontologyVersion: "TGEMO"`` for its own terms. Prefixing that gives
  // "TGEMO TGEMO", so skip the prefix when the value already leads with
  // it.
  if (v.toUpperCase() === prefix.toUpperCase()) return v;
  if (v.toUpperCase().startsWith(`${prefix.toUpperCase()} `)) return v;
  return `${prefix} ${v}`;
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
