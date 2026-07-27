/**
 * Adapter: turn a cross-source Design pair into a synthetic
 * ``AuditReport`` that the existing ``AuditSidebarPanel`` can
 * render as audit-style cards.
 *
 * Why this exists: the right-side sidebar is the curation app's
 * canonical "what differs" surface — agent-proposal cards live
 * there today. PR 3 of the curation comparison view
 * (``docs/CURATION_COMPARISON_VIEW_2026_05_27.md``) reuses that
 * same surface for chip-driven diffs. Synthesising an
 * ``AuditReport`` is the seam: ``AuditProvider.setOverrideReport``
 * accepts one, and every downstream component renders from
 * context.
 *
 * Matching is by obvious key only (factor category URI / label,
 * tag URI / label). Non-matches become
 * add/remove pairs; no fuzzy second pass.
 *
 * Severity is "minor" so cards render expanded by default —
 * "ok" findings auto-collapse and would defeat the point.
 */
import type {
  Design,
  Factor,
  Tag,
} from "@/features/experiment/types";
import type {
  AuditFinding,
  AuditFindingDisposition,
  AuditReport,
  AuditTargetKind,
  DispositionStatus,
} from "@/api/auditTypes";
import type { OntologyTerm } from "@/api/types";
import {
  isPolishedSource,
  polishedCuratorOf,
  type Source,
} from "./sources";

function factorKey(f: Factor): string {
  const cat = f.category;
  if (cat?.uri) return `uri:${cat.uri.toLowerCase()}`;
  if (cat?.label) return `label:${cat.label.toLowerCase()}`;
  return `name:${(f.name || "").toLowerCase()}`;
}

function tagKey(t: Tag): string {
  const c = t.category;
  const v = t.value;
  const ck = c?.uri ?? c?.label ?? "";
  const vk = v?.uri ?? v?.label ?? "";
  return `${ck.toLowerCase()}|${vk.toLowerCase()}`;
}

function termCopy(t: { label: string; uri?: string | null }): OntologyTerm {
  return { label: t.label, uri: t.uri ?? null, resolver: null, score: null };
}

function tagDescription(t: Tag): string {
  const cat = t.category?.label || "(no category)";
  const val = t.value?.label || "(no value)";
  // Tag cards are dense by default — keep the description to a tight
  // ``category: value`` line. The proposer_term chip carries the URI;
  // no need to repeat it in the rationale text.
  return `${cat}: ${val}`;
}

function factorDescription(f: Factor): string {
  const cat = f.category?.label || f.name || "(no category)";
  const fvs = f.factor_values ?? [];
  if (fvs.length === 0) return cat;
  // Show the FV count + a tight preview of the first two labels —
  // gives the curator enough to recognise the factor at a glance
  // without expanding ``AUDITOR DETAILS``. Truncated labels (long
  // CL terms) round to 28 chars so the rationale stays single-line
  // in the dense card layout.
  const labels = fvs
    .map((fv) => fv.free_text_label || "")
    .filter((s) => s.length > 0)
    .slice(0, 2)
    .map((s) => (s.length > 28 ? s.slice(0, 27) + "…" : s));
  const more = fvs.length > 2 ? ` +${fvs.length - 2} more` : "";
  if (labels.length === 0) return `${cat} (${fvs.length} value${fvs.length === 1 ? "" : "s"})`;
  return `${cat} — ${labels.join(", ")}${more}`;
}

function factorModifiedDescription(before: Factor, after: Factor): string {
  // Surface only the field that actually changed so the card text
  // matches the diff signal. Same matching by obvious key means we
  // don't drift across semantically-equivalent rewordings.
  const cat = after.category?.label || after.name || "(no category)";
  const parts: string[] = [];
  if ((before.name ?? "") !== (after.name ?? "")) {
    parts.push(`name: ${before.name || "∅"} → ${after.name || "∅"}`);
  }
  if ((before.description ?? "") !== (after.description ?? "")) {
    parts.push(`description edited`);
  }
  if ((before.type ?? "") !== (after.type ?? "")) {
    parts.push(`type: ${before.type || "?"} → ${after.type || "?"}`);
  }
  return parts.length > 0 ? `${cat} — ${parts.join("; ")}` : cat;
}

/** Actor name for the card-leading rationale. Mirrors the spec's
 *  panel-header table — the comparator slot identity is the voice
 *  speaking. */
function actor(source: Source): string {
  if (source === "preboard") return "Preboard";
  if (source === "agent_proposal") return "Agent";
  if (source === "empty") return "";
  if (isPolishedSource(source)) {
    const curator = polishedCuratorOf(source);
    if (!curator) return "";
    return curator.charAt(0).toUpperCase() + curator.slice(1).toLowerCase();
  }
  return "";
}

/** True when ``s`` represents a specific curator's polished Design
 *  (i.e. carries one human's accept/reject decisions). */
function isCuratorPolished(s: Source): boolean {
  return isPolishedSource(s);
}

/** Build the synthetic report. Returns ``null`` when there's
 *  nothing to diff (empty / null inputs).
 *
 *  Curator-auditing framing (design review 2026-05-29): whenever ONE slot
 *  holds a curator's polished view, the diff reads as that curator's
 *  accept/reject/modify decisions relative to the other slot — and
 *  the synthesised report includes ``dispositions`` so the existing
 *  AuditDot ✓/✗ path renders, not just the plain pending ``□``.
 *
 *  Two configurations:
 *
 *  1. ``baseline = curator's polished, comparator = agent_proposal``
 *     (the original curator-audits-agent path). Curator is in the
 *     baseline; comparator items are what was proposed.
 *      - in cmp ∩ base → curator accepted
 *      - in cmp \ base → curator dismissed (didn't keep agent's item)
 *      - in base \ cmp → curator added solo (beyond agent's proposal)
 *
 *  2. ``comparator = curator's polished, baseline = anything else``
 *     (cross-curator review, preboard-vs-curator review, etc.).
 *     Curator is in the comparator; baseline items are the reference.
 *      - in cmp ∩ base → curator accepted (kept what was in baseline)
 *      - in cmp \ base → curator added (beyond baseline)
 *      - in base \ cmp → curator dismissed (dropped from baseline)
 *
 *  If neither slot is a curator's polished, we fall back to the plain
 *  symmetric diff (no synthesised dispositions; cards stay open).
 */
export function diffDesignsToAuditReport(args: {
  baseline: Design | null | undefined;
  comparator: Design | null | undefined;
  baselineSource: Source;
  comparatorSource: Source;
  experimentId: number | string;
  experimentShortName: string;
}): AuditReport | null {
  const { baseline, comparator, comparatorSource } = args;
  if (!baseline || !comparator) return null;

  const baselineIsCurator = isCuratorPolished(args.baselineSource);
  const comparatorIsCurator = isCuratorPolished(args.comparatorSource);

  // ``curatorInComparator`` (new path) takes precedence: if both slots
  // are curators (cross-curator review), we treat the comparator as
  // the "proposal being inspected against the baseline gold". The
  // comparator's curator is the actor whose decisions we render.
  const curatorInComparator = comparatorIsCurator;
  const curatorInBaseline =
    !curatorInComparator
    && baselineIsCurator
    && args.comparatorSource === "agent_proposal";
  const curatorAuditing = curatorInComparator || curatorInBaseline;
  const curatorActor = curatorInComparator
    ? actor(args.comparatorSource)
    : actor(args.baselineSource);
  const cmpActor = actor(comparatorSource);
  const findings: AuditFinding[] = [];

  // Factors — match by category URI/label.
  const baseFactors = baseline.factors ?? [];
  const cmpFactors = comparator.factors ?? [];
  const baseByFactor = new Map(baseFactors.map((f) => [factorKey(f), f]));
  const cmpByFactor = new Map(cmpFactors.map((f) => [factorKey(f), f]));

  for (const [k, cmp] of cmpByFactor) {
    const base = baseByFactor.get(k);
    if (!base) {
      // In cmp not in baseline.
      //  - curator-in-comparator (new): curator ADDED it (beyond baseline)
      //  - curator-in-baseline (existing): curator DISMISSED what cmp proposed
      //  - no-curator: plain "added" structural diff
      const kind: DiffKind = curatorInComparator
        ? "added_solo"
        : curatorInBaseline
          ? "dismissed"
          : "added";
      findings.push(makeFactorFinding({
        kind,
        factor: cmp,
        actor: curatorAuditing ? curatorActor : cmpActor,
        key: k,
      }));
    } else if (factorChanged(base, cmp)) {
      findings.push(makeFactorFinding({
        kind: "modified",
        factor: cmp,
        before: base,
        actor: curatorAuditing ? curatorActor : cmpActor,
        key: k,
      }));
    } else if (curatorAuditing) {
      // Match — curator kept the baseline item (curator-in-comparator)
      // OR accepted the comparator's proposed item (curator-in-baseline).
      // Either way, ``accepted`` is the right verb.
      findings.push(makeFactorFinding({
        kind: "accepted",
        factor: cmp,
        actor: curatorActor,
        key: k,
      }));
    }
  }
  for (const [k, base] of baseByFactor) {
    if (!cmpByFactor.has(k)) {
      // In baseline not in cmp.
      //  - curator-in-comparator (new): curator DROPPED it from baseline
      //  - curator-in-baseline (existing): curator ADDED solo beyond agent
      //  - no-curator: plain "removed" structural diff
      const kind: DiffKind = curatorInComparator
        ? "dismissed"
        : curatorInBaseline
          ? "added_solo"
          : "removed";
      findings.push(makeFactorFinding({
        kind,
        factor: base,
        actor: curatorAuditing ? curatorActor : cmpActor,
        key: k,
      }));
    }
  }

  // Tags.
  const baseTags = baseline.tags ?? [];
  const cmpTags = comparator.tags ?? [];
  const baseByTag = new Map(baseTags.map((t) => [tagKey(t), t]));
  const cmpByTag = new Map(cmpTags.map((t) => [tagKey(t), t]));

  for (const [k, cmp] of cmpByTag) {
    const base = baseByTag.get(k);
    if (!base) {
      const kind: DiffKind = curatorInComparator
        ? "added_solo"
        : curatorInBaseline
          ? "dismissed"
          : "added";
      findings.push(makeTagFinding({
        kind,
        tag: cmp,
        actor: curatorAuditing ? curatorActor : cmpActor,
        key: k,
      }));
    } else if (curatorAuditing) {
      findings.push(makeTagFinding({
        kind: "accepted", tag: cmp, actor: curatorActor, key: k,
      }));
    }
  }
  for (const [k, base] of baseByTag) {
    if (!cmpByTag.has(k)) {
      const kind: DiffKind = curatorInComparator
        ? "dismissed"
        : curatorInBaseline
          ? "added_solo"
          : "removed";
      findings.push(makeTagFinding({
        kind,
        tag: base,
        actor: curatorAuditing ? curatorActor : cmpActor,
        key: k,
      }));
    }
  }

  // Synthesise dispositions so the existing ``AuditDot`` ✓/✗ path
  // renders — without these, every chip-diff card shows the
  // open/pending ``□`` regardless of kind. The mapping is driven by
  // the finding's ``issue_code`` suffix (set in ``makeFactorFinding``
  // / ``makeTagFinding`` via the ``DiffKind``).
  const dispositions: AuditFindingDisposition[] = [];
  if (curatorAuditing) {
    const stampedAt = new Date().toISOString();
    for (const f of findings) {
      const code = f.issue_code;
      let status: DispositionStatus = "pending";
      if (
        code.endsWith("_accepted")
        || code.endsWith("_added_solo")
        || code.endsWith("_modified")
      ) {
        status = "accepted";
      } else if (code.endsWith("_dismissed")) {
        status = "dismissed";
      }
      if (status === "pending") continue;
      dispositions.push({
        target_id: f.target_id,
        status,
        reviewer: curatorActor,
        reviewed_at: stampedAt,
        notes: "",
      });
    }
  }

  return {
    audit_id: null,
    experiment_id: args.experimentId,
    experiment_short_name: args.experimentShortName,
    kind: "audit",
    audited_at: new Date().toISOString(),
    model: `chip-diff:${args.baselineSource}->${args.comparatorSource}`,
    scope: { include: ["factors", "tags"] },
    findings,
    evidence: {
      preboarding_excerpt: "",
      paper_source: null,
      paper_excerpt: "",
      comparison_proposal: null,
    },
    summary: {
      n_blocker: 0,
      n_major: 0,
      n_minor: findings.length,
      n_ok: 0,
      overall_verdict: findings.length > 0 ? "minor_issues" : "clean",
    },
    dispositions,
  };
}

function factorChanged(a: Factor, b: Factor): boolean {
  if ((a.name ?? "") !== (b.name ?? "")) return true;
  if ((a.description ?? "") !== (b.description ?? "")) return true;
  if ((a.type ?? "") !== (b.type ?? "")) return true;
  // factor_values structural diff handled separately if we ever
  // surface it — for now, count factor "modified" only on the
  // factor-level fields. FV-level deltas can come in a later pass.
  return false;
}

type DiffKind = "added" | "removed" | "modified" | "accepted" | "dismissed" | "added_solo";

function makeFactorFinding(args: {
  kind: DiffKind;
  factor: Factor;
  before?: Factor;
  actor: string;
  key: string;
}): AuditFinding {
  const { kind, factor, before, actor, key } = args;
  const target_id = `chipdiff:factor:${kind}:${key}`;
  const desc =
    kind === "modified" && before
      ? factorModifiedDescription(before, factor)
      : factorDescription(factor);
  // Rationale reads from the active actor's perspective: a curator
  // auditing an agent's proposal gets "Cy accepted / dismissed";
  // structural diffs (no agent involved) get "added / dropped /
  // changed". See ``DiffKind`` for the full kind set.
  const rationale = `${actor} ${verbFor(kind)} factor — ${desc}`;
  // ``ok`` severity tells the existing audit-card renderer to default
  // the card to "resolved-looking" — green check, expanded label —
  // which is what we want for accepted items. Everything else stays
  // ``minor`` so it surfaces as a normal review card.
  const severity = kind === "accepted" ? "ok" : "minor";
  return {
    target_kind: "factor" as AuditTargetKind,
    target_id,
    severity,
    issue_code: `chipdiff_factor_${kind}`,
    rationale,
    citation: "",
    citation_url: "",
    suggested_fix: "",
    proposer_suggestion: "",
    proposer_term: factor.category ? termCopy(factor.category) : null,
  };
}

function makeTagFinding(args: {
  kind: DiffKind;
  tag: Tag;
  actor: string;
  key: string;
}): AuditFinding {
  const { kind, tag, actor, key } = args;
  const target_id = `chipdiff:tag:${kind}:${key}`;
  const desc = tagDescription(tag);
  const severity = kind === "accepted" ? "ok" : "minor";
  // Backtick the ``category: value`` so the existing tag-card
  // renderer's ``firstBacktick`` fallback (AuditSidebarPanel.tsx
  // line ~3460) picks up the labels and renders them as Term chips.
  // Our synthetic ``chipdiff:`` target_ids aren't recognised by
  // ``parseTargetId``, so this is the simplest hook into the
  // existing tag-rendering path without forking it.
  return {
    target_kind: "tag" as AuditTargetKind,
    target_id,
    severity,
    issue_code: `chipdiff_tag_${kind}`,
    rationale: `${actor} ${verbFor(kind)} tag — \`${desc}\``,
    citation: "",
    citation_url: "",
    suggested_fix: "",
    proposer_suggestion: "",
    proposer_term: tag.value ? termCopy(tag.value) : null,
  };
}

function verbFor(kind: DiffKind): string {
  switch (kind) {
    case "added":
      return "added";
    case "removed":
      return "dropped";
    case "modified":
      return "modified";
    case "accepted":
      return "accepted";
    case "dismissed":
      return "dismissed";
    case "added_solo":
      // Curator added something the baseline doesn't have. Reads as
      // "Am added X (not in cy_polished)" via the rationale below.
      return "added (not in baseline),";
  }
}

