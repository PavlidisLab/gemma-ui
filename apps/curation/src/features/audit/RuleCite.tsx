/**
 * ``<RuleCite finding={...}/>`` — a small ``?`` next to a finding's
 * reasoning that pops the PRECISE curation rule justifying it.
 *
 * Resolves via ``guidelineRefForFinding`` (citation → issue_code →
 * null). When nothing resolves, renders nothing — so it's safe to
 * drop next to every finding's "Why proposed" header. When it
 * resolves, it reuses the existing ``HelpPopup`` ``?`` affordance
 * (same look as the "Curation guidelines: ontologies ? …" popups) and
 * shows the ref's title (heading) + snippet (body) + doc (provenance)
 * + any links (click-outs), plus an optional "more →" to the broad
 * topic guideline.
 */

import { HelpPopup } from "@/components/ui/HelpPopup";
import {
  guidelineRefForFinding,
  type FindingLike,
  type GuidelineRef,
} from "@/lib/guidelineRegistry";
import {
  normalizeWikiUrl,
  ONTOLOGY_GUIDELINE,
  FREE_TEXT_GUIDELINE,
  PREDICATE_GUIDELINE,
  BASELINE_GUIDELINE,
  TAGS_GUIDELINE,
  CHECKLIST_GUIDELINE,
  type GuidelineSnippet,
} from "@/lib/guidelines";

/** ``ref.topic`` → the broad topic snippet, for the optional
 *  "more →" refresher. Unknown topics get no "more →" link. */
const TOPIC_SNIPPETS: Record<string, GuidelineSnippet> = {
  ontologies: ONTOLOGY_GUIDELINE,
  free_text: FREE_TEXT_GUIDELINE,
  predicates: PREDICATE_GUIDELINE,
  baselines: BASELINE_GUIDELINE,
  tags: TAGS_GUIDELINE,
  checklist: CHECKLIST_GUIDELINE,
};

export function RuleCite({
  finding,
  size = "md",
  align = "left",
}: {
  finding: FindingLike | null | undefined;
  size?: "sm" | "md" | "lg";
  align?: "left" | "right";
}): JSX.Element | null {
  const ref: GuidelineRef | null = guidelineRefForFinding(finding);
  if (!ref) return null;

  const topic = TOPIC_SNIPPETS[ref.topic];
  // Normalise the precise rule's link-outs through the wiki host
  // rewrite (the producer may emit cloud-style URLs).
  const links = (ref.links ?? []).map((l) => ({
    title: l.title,
    url: normalizeWikiUrl(l.url),
  }));

  // When the entry carries precise wiki links, they ARE the source —
  // so suppress both the broad-topic "more →" (it points at the generic
  // wiki base, redundant with the precise page) and the cryptic ``doc``
  // provenance line (an internal agent-doc ref like "calibration
  // tag-match (exact/near) rules"). Keep them only as a fallback when no
  // precise link exists. Design review 2026-06-21.
  const hasLinks = links.length > 0;
  return (
    <HelpPopup
      title={ref.title}
      size={size}
      align={align}
      links={hasLinks ? links : undefined}
      source={hasLinks ? undefined : ref.doc || undefined}
      footer={
        !hasLinks && topic ? (
          <a
            href={topic.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-700 hover:underline dark:text-sky-400"
          >
            more on {topic.title.toLowerCase()} →
          </a>
        ) : null
      }
    >
      <div className="leading-snug">{ref.snippet}</div>
    </HelpPopup>
  );
}
