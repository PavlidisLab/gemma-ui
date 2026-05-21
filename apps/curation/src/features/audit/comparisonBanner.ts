/**
 * Pure decision logic for the inter-curator-audit comparison banner
 * rendered above the experiment shell. Pulled out of ``App.tsx``'s
 * ``ComparisonModeBanner`` so the leak-prevention rules are
 * unit-testable.
 *
 * Context: a curator can land on an experiment two ways —
 *  (1) Through an inter-curator-audit workflow Group: the URL carries
 *      ``?group=<id>`` and the resolved Group's ``name`` matches
 *      ``/inter-curator audit/i``.
 *  (2) Direct experiment open with no ``?group=`` in the URL: we fall
 *      back to scanning the experiment's audit history for an audit
 *      whose ``model`` carries the same marker. This catches the case
 *      where the curator follows a bare ``#/experiment/<id>`` link
 *      from a notification / chat / handoff doc.
 *
 * The bug fixed 2026-05-21 (Paul's repro in
 * ``memory/ui_bug_curator_banner_leak.md``): path (2) was firing
 * even when ``groupId`` WAS set in the URL but resolved to a
 * non-inter-curator group (e.g. ``hardcase10-sonnet-s0v8``). If the
 * experiment had any prior inter-curator audit in its history, the
 * banner leaked across packages.
 *
 * Fix: gate the audit-history fallback on ``!groupId``. When the user
 * is explicitly viewing within a workflow group, that group's identity
 * is authoritative — if it isn't an inter-curator group, the banner
 * stays hidden regardless of historical audits. Path (1) still
 * handles the inter-curator-group case correctly.
 */

export interface ComparisonBannerAudit {
  /** Audit ``model`` string. Inter-curator audits emit
   *  ``"inter-curator audit · X's curation applied · Y reviews"``.
   *  Normal audits emit a plain model name (e.g.
   *  ``"Sonnet S0v8+chain+..."``). */
  model?: string | null;
}

export interface ComparisonBannerDecision {
  /** Should the banner render at all. */
  show: boolean;
  /** Free-form source text the banner parses identities from. Empty
   *  string when ``show`` is false. */
  sourceText: string;
  /** Parsed curator-being-reviewed (the "gold" side). Null when the
   *  source text doesn't match the standard pattern. */
  goldCurator: string | null;
  /** Parsed reviewer (the one whose dispositions live in this
   *  package). Null when the source text doesn't match. */
  reviewer: string | null;
}

const HIDDEN: ComparisonBannerDecision = {
  show: false,
  sourceText: "",
  goldCurator: null,
  reviewer: null,
};

const INTER_CURATOR_RE = /inter-curator audit/i;
const IDENTITY_RE =
  /(\S+?)'s curation applied\s*·\s*(\S+?)\s*reviews/i;

/** Compute whether to show the comparison banner for the current
 *  package, and the text/identities to render with.
 *
 *  Inputs:
 *    - ``groupId``: URL ``?group=<id>``; undefined when the user
 *      opened the experiment directly. When set, the user is
 *      committed to a specific workflow Group — the resolved name is
 *      authoritative, audit-history fallback is suppressed.
 *    - ``groupName``: resolved Group name (or empty string while the
 *      group fetch is in flight).
 *    - ``audits``: list of audits attached to the current experiment.
 *      Scanned for an inter-curator-audit marker ONLY when ``groupId``
 *      is undefined.
 */
export function decideComparisonBanner(
  groupId: string | undefined,
  groupName: string,
  audits: ComparisonBannerAudit[],
): ComparisonBannerDecision {
  const fromGroup = INTER_CURATOR_RE.test(groupName);

  // Audit-history fallback is ONLY valid when there's no explicit
  // group context. If ``groupId`` is set but the group isn't an
  // inter-curator one, the curator is viewing a different package
  // and the banner must stay hidden — even if the experiment has a
  // historical inter-curator audit on its record.
  const allowAuditFallback = !groupId;
  const interCuratorAudit = allowAuditFallback
    ? audits.find((a) => INTER_CURATOR_RE.test(a.model || ""))
    : undefined;
  const fromAudit = !!interCuratorAudit;

  if (!fromGroup && !fromAudit) return HIDDEN;

  const sourceText =
    (fromGroup ? groupName : interCuratorAudit?.model) || "";
  const m = sourceText.match(IDENTITY_RE);

  return {
    show: true,
    sourceText,
    goldCurator: m ? m[1] : null,
    reviewer: m ? m[2] : null,
  };
}
