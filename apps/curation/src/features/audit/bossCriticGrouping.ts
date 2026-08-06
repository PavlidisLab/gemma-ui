/**
 * Boss-critic review grouping — turn the raw multi-round review feed
 * into a curator worklist.
 *
 * The boss-critic is the agent's REASONING; the curator needs the
 * OUTCOME. The raw ``AuditEvidence.boss_critic_reviews`` feed carries
 * every round of every target — round 1 "blocker", round 2 "downgrade
 * to advisory, don't loop" — as sibling records. Rendered flat, the
 * curator watches the agent argue with itself (handoff
 * ``BOSS_CRITIC_REVIEW_PRESENTATION_2026_08_03``: three confusions —
 * out of context, rounds shown raw, near-duplicates).
 *
 * This module collapses that feed to ONE grouped verdict per
 * ``(target, issue)``, keeping the FINAL round as the outcome and the
 * earlier rounds as behind-an-expander history. The grouped reviews are
 * then routed by scope: ``design`` stays in the top panel; ``factor`` /
 * ``fv`` / ``tag`` render inline on the design element they're about.
 *
 * ## Grouping key
 *
 * Prefers the agent-side ``finding_key`` (``(normalized target_id,
 * issue_code)``) when present — then the collapse is a deterministic
 * groupby, per the handoff's agent-side ask. Until that field lands the
 * key falls back to ``target_id`` alone. That fallback over-merges when
 * a single target legitimately carries two distinct issues (the handoff
 * calls this out as exactly why ``finding_key`` is needed); one card per
 * target is the intended v1 shape (acceptance: "Factor: treatment — one
 * card"), and the code upgrades to per-issue splitting for free the day
 * the wire carries ``finding_key``.
 *
 * ## Final round
 *
 * Prefers ``is_final`` when the wire sets it; otherwise the highest
 * ``round`` in the group is the outcome (ties broken by severity).
 */
import type { AuditFinding, BossCriticReview } from "@/api/auditTypes";
import { parseTargetId, slug } from "./targetIds";

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

export type BossSeverity =
  | "blocker"
  | "escalation"
  | "advisory"
  | "ok"
  | "other";

export const BOSS_SEVERITY_ORDER: BossSeverity[] = [
  "blocker",
  "escalation",
  "advisory",
  "ok",
  "other",
];

export const BOSS_SEVERITY_LABEL: Record<BossSeverity, string> = {
  blocker: "Blocker",
  escalation: "Escalation",
  advisory: "Advisory",
  ok: "OK",
  other: "Other",
};

export const BOSS_SEVERITY_CHIP_CLS: Record<BossSeverity, string> = {
  blocker: "bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-200",
  escalation:
    "bg-orange-50 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200",
  advisory:
    "bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  ok: "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200",
  other: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
};

export function classifyBossSeverity(raw: string): BossSeverity {
  const s = (raw || "").trim().toLowerCase();
  if (s === "blocker") return "blocker";
  if (s === "escalation") return "escalation";
  if (s === "advisory") return "advisory";
  if (s === "ok") return "ok";
  return "other";
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

export type BossScopeKind = "design" | "factor" | "fv" | "tag" | "other";

/** Canonicalize a boss-critic ``target_id`` into the finding-side slug
 *  convention, and lower-case it so the group key matches the agent's
 *  ``finding_key`` normalization ("strip whitespace + lower-case the
 *  target"). Two things this fixes:
 *   - The boss feed writes tags as ``tag:<cat>|<val>`` (pipe) while
 *     ``parseTargetId`` + every finding ``target_id`` use ``/``.
 *   - The same FV can arrive twice differing only in case
 *     (``fv:treatment/oxymatrine`` vs ``fv:treatment/Oxymatrine``); on
 *     the ``target_id`` fallback path (no ``finding_key`` yet) those must
 *     collapse to ONE card, not read as a near-duplicate. Lower-casing
 *     merges them, mirroring what ``finding_key`` does agent-side. */
function canonicalTargetId(targetId: string): string {
  let t = targetId;
  if (t.startsWith("tag:") && t.includes("|")) t = t.replace("|", "/");
  return t.toLowerCase();
}

/** Classify a boss-critic ``target_id`` into the scope that decides
 *  where it renders — ``design`` stays in the top panel, the rest route
 *  inline onto the matching design element's section. */
export function bossScopeKind(targetId: string): BossScopeKind {
  const t = canonicalTargetId(targetId || "");
  if (!t || t === "design") return "design";
  const parsed = parseTargetId(t);
  if (!parsed) return "other";
  if (parsed.kind === "factor") return "factor";
  if (parsed.kind === "fv") return "fv";
  if (parsed.kind === "tag") return "tag";
  return "other";
}

/** Curator-readable scope label. The wire carries ``target_id`` shapes
 *  like ``design`` / ``factor:age`` / ``tag:cell-type|astrocyte`` /
 *  ``tag:14`` / ``fv:age/young``; render a friendlier label. */
export function bossScopeLabel(targetId: string): string {
  if (!targetId || targetId === "design") return "Whole design";
  if (targetId.startsWith("factor:")) {
    return `Factor: ${targetId.slice("factor:".length)}`;
  }
  if (targetId.startsWith("tag:")) {
    const tail = targetId.slice("tag:".length);
    if (/^\d+$/.test(tail)) return `Tag #${tail}`;
    return `Tag: ${tail.replace("|", " : ")}`;
  }
  if (targetId.startsWith("fv:")) {
    return `FV: ${targetId.slice("fv:".length)}`;
  }
  return targetId;
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/** One collapsed boss-critic decision — the FINAL verdict for a
 *  ``(target, issue)`` plus the round history behind it. */
export interface GroupedBossReview {
  /** Group key — ``finding_key`` when the wire carries it, else the
   *  canonical ``target_id``. Stable across renders (DOM key). */
  key: string;
  /** ``target_id`` of the final verdict (canonicalized). */
  targetId: string;
  scopeKind: BossScopeKind;
  /** Severity of the FINAL verdict — what the curator acts on. */
  severity: BossSeverity;
  /** The outcome verdict (latest round). */
  final: BossCriticReview;
  /** Every round for this group, ascending, de-duplicated. ``length``
   *  ≥ 2 means there's a progression worth showing behind an expander. */
  history: BossCriticReview[];
  /** Highest round seen for the group. */
  maxRound: number;
  /** Final verdict is still a blocker AND only round 1 ever ran — the
   *  proposer never got to re-evaluate, so the curator should treat it
   *  as a debatable, unresolved escalation. */
  unresolvedBlocker: boolean;
}

function groupKey(r: BossCriticReview): string {
  if (r.finding_key && r.finding_key.trim()) return r.finding_key.trim();
  return canonicalTargetId(r.target_id || "");
}

/** Pick the final (outcome) review of a group: the ``is_final`` one if
 *  the wire marks it, else the highest round, breaking ties toward the
 *  most severe so a blocker never hides behind a same-round ok. */
function pickFinal(group: BossCriticReview[]): BossCriticReview {
  const flagged = group.find((r) => r.is_final === true);
  if (flagged) return flagged;
  return group.reduce((best, r) => {
    if (r.round !== best.round) return r.round > best.round ? r : best;
    const rv = BOSS_SEVERITY_ORDER.indexOf(classifyBossSeverity(r.severity));
    const bv = BOSS_SEVERITY_ORDER.indexOf(classifyBossSeverity(best.severity));
    return rv < bv ? r : best;
  }, group[0]);
}

/** De-duplicate identical (round, severity, verdict) records — the raw
 *  feed sometimes emits a review twice (the oxymatrine synonym-bind
 *  appeared once "round 2" and once with no round). Keeps history clean
 *  without fuzzy text-matching. */
function dedupeHistory(group: BossCriticReview[]): BossCriticReview[] {
  const seen = new Set<string>();
  const out: BossCriticReview[] = [];
  for (const r of group) {
    const sig = `${r.round} ${(r.severity || "").trim().toLowerCase()} ${(
      r.verdict || ""
    ).trim()}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(r);
  }
  return out;
}

/** Collapse the raw boss-critic feed to one grouped verdict per
 *  ``(target, issue)``, ordered by severity (blockers first) then
 *  design-first then target. */
export function groupBossReviews(
  reviews: BossCriticReview[] | null | undefined,
): GroupedBossReview[] {
  const list = Array.isArray(reviews) ? reviews : [];
  if (list.length === 0) return [];

  const byKey = new Map<string, BossCriticReview[]>();
  for (const r of list) {
    const k = groupKey(r);
    const arr = byKey.get(k);
    if (arr) arr.push(r);
    else byKey.set(k, [r]);
  }

  const groups: GroupedBossReview[] = [];
  for (const [key, raw] of byKey) {
    const history = dedupeHistory(
      [...raw].sort((a, b) => a.round - b.round),
    );
    const final = pickFinal(history);
    const maxRound = history.reduce((m, r) => Math.max(m, r.round), 0);
    const severity = classifyBossSeverity(final.severity);
    groups.push({
      key,
      targetId: canonicalTargetId(final.target_id || ""),
      scopeKind: bossScopeKind(final.target_id || ""),
      severity,
      final,
      history,
      maxRound,
      unresolvedBlocker: severity === "blocker" && maxRound <= 1,
    });
  }

  groups.sort((a, b) => {
    const av = BOSS_SEVERITY_ORDER.indexOf(a.severity);
    const bv = BOSS_SEVERITY_ORDER.indexOf(b.severity);
    if (av !== bv) return av - bv;
    if (a.scopeKind === "design" && b.scopeKind !== "design") return -1;
    if (b.scopeKind === "design" && a.scopeKind !== "design") return 1;
    return a.targetId.localeCompare(b.targetId);
  });
  return groups;
}

export function bossSeverityCounts(
  groups: GroupedBossReview[],
): Partial<Record<BossSeverity, number>> {
  const out: Partial<Record<BossSeverity, number>> = {};
  for (const g of groups) out[g.severity] = (out[g.severity] ?? 0) + 1;
  return out;
}

// ---------------------------------------------------------------------------
// Routing — match a grouped review to the finding card it belongs on
// ---------------------------------------------------------------------------

/** Design-side id → slug lookups, so the router can anchor a boss
 *  verdict to a finding whose ``target_id`` carries only a numeric id.
 *
 *  Every finding about an element that ALREADY EXISTS in the design
 *  ships that shape — ``factor:2``, ``tag:1`` — because the id is what
 *  storage hands back. The boss feed, meanwhile, always names the
 *  element (``factor:timepoint``, ``fv:timepoint/2 h``). Without a
 *  bridge the numeric branch bails to ``null`` and EVERY boss verdict
 *  about an existing factor / tag misses its card and piles up in the
 *  unmatched block at the tail of the section — the "boss-critic stuff
 *  outside the associated item" report on GSE1658 (audit
 *  87d9d77f, findings ``factor:1/2/3`` vs boss ``fv:timepoint/2 h``).
 *
 *  Built by the caller from the design draft; omit it and routing
 *  degrades to the old slug-only behaviour rather than breaking. */
export interface BossRouteIndex {
  /** design factor id → category (or name) slug */
  factorSlugById?: Map<number, string>;
  /** design tag id → (category, value) slugs */
  tagSlugById?: Map<number, { cat: string; val: string }>;
}

/** Every factor-category slug a finding can legitimately be addressed
 *  by. A boss verdict names ONE of them; the card is the same card, so
 *  matching any candidate anchors it.
 *
 *    - ``factor:<cat>[#id]``                    → the category slug
 *    - ``calibration:factor_extra:<cat>:<val>`` → ``<cat>`` (an
 *      agent-proposed "ADD FACTOR" card — the common proposal-review case)
 *    - ``factor:<numeric id>``                  → resolved through
 *      ``index.factorSlugById`` (an existing-design factor; the category
 *      isn't recoverable from the id alone)
 *    - ``rename.{agent,gold}.category``         → a near-match card holds
 *      BOTH namings of one factor. The boss reasons over the agent's
 *      proposal, so it says ``factor:individual`` where the design (and
 *      the target_id) say ``cell line`` — GSE11630 / audit 87d9d77f.
 *      Without the agent-side name those verdicts miss the very card
 *      that presents the rename.
 *
 *  Empty for non-factor findings and for a numeric id the index doesn't
 *  cover. */
function findingFactorCategorySlugs(
  finding: AuditFinding,
  index?: BossRouteIndex,
): string[] {
  if (finding.target_kind !== "factor") return [];
  const out = new Set<string>();
  const add = (s: string | null | undefined) => {
    const v = slug(s || "");
    if (v) out.add(v);
  };
  const tid = finding.target_id || "";
  const extra = tid.match(/(?:^|:)factor_extra:([^:]+)(?::|$)/);
  if (extra) add(extra[1]);
  else {
    const p = parseTargetId(tid);
    if (p?.kind === "factor") {
      if (!/^\d+$/.test(p.factorSlug)) add(p.factorSlug);
      else add(index?.factorSlugById?.get(Number(p.factorSlug)));
    }
  }
  add(finding.rename?.agent?.category?.label);
  add(finding.rename?.gold?.category?.label);
  return [...out];
}

/** (category, value) slugs of a TAG finding, across its target_id shapes:
 *    - ``tag:<cat>/<val>``
 *    - ``calibration:{extra,miss,match}:<cat>/<val>``
 *    - ``tag:<numeric id>`` → resolved through ``index.tagSlugById``
 *  Returns ``null`` for non-tag findings, and for a numeric id the index
 *  doesn't cover. */
function findingTagCatVal(
  finding: AuditFinding,
  index?: BossRouteIndex,
): { cat: string; val: string } | null {
  if (finding.target_kind !== "tag") return null;
  const tid = finding.target_id || "";
  const cal = tid.match(/^calibration:(?:extra|miss|match):(.+)$/);
  const body = cal
    ? cal[1]
    : tid.startsWith("tag:")
      ? tid.slice("tag:".length)
      : null;
  if (body == null) return null;
  const slash = body.indexOf("/");
  if (slash === -1) {
    // Numeric existing-design tag id — the slug pair isn't in the id.
    if (!/^\d+$/.test(body)) return null;
    return index?.tagSlugById?.get(Number(body)) ?? null;
  }
  return { cat: slug(body.slice(0, slash)), val: slug(body.slice(slash + 1)) };
}

/** Does this grouped boss review anchor to ``finding``'s design element
 *  so it can nest INSIDE that finding's card? Matches on category /
 *  value SLUGS extracted from whatever target_id shape the finding
 *  carries (the clean ``factor:``/``fv:``/``tag:`` forms AND the
 *  ``calibration:*`` proposal forms), re-slugging both sides so an
 *  un-slugged boss label (``factor:diurnal ZT sampling``) still compares
 *  equal.
 *
 *  A **factor** or **FV** verdict nests inside the FACTOR card (the
 *  factor proposal is "the relevant proposal" — an FV verdict rides with
 *  its parent factor); an FV verdict also matches an exact FV card when
 *  one exists. Unmatched groups render standalone in the same section. */
export function bossMatchesFinding(
  g: GroupedBossReview,
  finding: AuditFinding,
  index?: BossRouteIndex,
): boolean {
  const bp = parseTargetId(g.targetId);
  if (!bp) return false;
  if (bp.kind === "factor" || bp.kind === "fv") {
    const bcat = slug(bp.factorSlug);
    if (findingFactorCategorySlugs(finding, index).includes(bcat)) return true;
    if (bp.kind === "fv" && finding.target_kind === "fv") {
      const fp = parseTargetId(finding.target_id);
      return (
        fp?.kind === "fv" &&
        slug(fp.factorSlug) === slug(bp.factorSlug) &&
        slug(fp.fvSlug) === slug(bp.fvSlug)
      );
    }
    return false;
  }
  if (bp.kind === "tag") {
    const tv = findingTagCatVal(finding, index);
    return (
      tv != null &&
      tv.cat === slug(bp.categorySlug) &&
      tv.val === slug(bp.valueSlug)
    );
  }
  return false;
}

/** The GROUPS section a routed scope renders under. ``factor`` AND
 *  ``fv`` verdicts render under the ``factor`` section — an FV verdict
 *  belongs with its parent factor's proposal, not in a separate
 *  factor-values block. ``tag`` maps to the tag section. ``design`` /
 *  ``other`` stay in the top panel and return ``null``. */
export function bossSectionKind(
  scope: BossScopeKind,
): "factor" | "tag" | null {
  if (scope === "factor" || scope === "fv") return "factor";
  if (scope === "tag") return "tag";
  return null;
}
