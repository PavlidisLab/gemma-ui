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
 * tag URI / label) per
 * ``[[feedback-obvious-match-only]]``. Non-matches become
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
  AuditReport,
  AuditTargetKind,
} from "@/api/auditTypes";
import type { OntologyTerm } from "@/api/types";
import { SOURCE_LABEL, type Source } from "./sources";

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
  // matches the diff signal. Same matching by obvious key
  // ([[feedback-obvious-match-only]]) means we don't drift across
  // semantically-equivalent rewordings.
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
  switch (source) {
    case "cy_polished":
      return "Cy";
    case "am_polished":
      return "Am";
    case "preboard":
      return "Preboard";
    case "agent_proposal":
      return "Agent";
    case "empty":
      return "";
  }
}

/** Build the synthetic report. Returns ``null`` when there's
 *  nothing to diff (empty / null inputs). */
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
      findings.push(makeFactorFinding({
        kind: "added",
        factor: cmp,
        actor: cmpActor,
        key: k,
      }));
    } else if (factorChanged(base, cmp)) {
      findings.push(makeFactorFinding({
        kind: "modified",
        factor: cmp,
        before: base,
        actor: cmpActor,
        key: k,
      }));
    }
  }
  for (const [k, base] of baseByFactor) {
    if (!cmpByFactor.has(k)) {
      findings.push(makeFactorFinding({
        kind: "removed",
        factor: base,
        actor: cmpActor,
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
      findings.push(makeTagFinding({
        kind: "added", tag: cmp, actor: cmpActor, key: k,
      }));
    }
    // tags match → no "modified" case for tags (the key IS the tag identity)
  }
  for (const [k, base] of baseByTag) {
    if (!cmpByTag.has(k)) {
      findings.push(makeTagFinding({
        kind: "removed", tag: base, actor: cmpActor, key: k,
      }));
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
    dispositions: [],
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

function makeFactorFinding(args: {
  kind: "added" | "removed" | "modified";
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
  // Rationale reads as a sentence. Actor leads (matches the spec's
  // "who's saying what" framing in the panel-header table); verb
  // matches the diff kind; the description carries the structural
  // detail.
  const rationale = `${actor} ${verbFor(kind)} factor — ${desc}`;
  return {
    target_kind: "factor" as AuditTargetKind,
    target_id,
    severity: "minor",
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
  kind: "added" | "removed";
  tag: Tag;
  actor: string;
  key: string;
}): AuditFinding {
  const { kind, tag, actor, key } = args;
  const target_id = `chipdiff:tag:${kind}:${key}`;
  const desc = tagDescription(tag);
  return {
    target_kind: "tag" as AuditTargetKind,
    target_id,
    severity: "minor",
    issue_code: `chipdiff_tag_${kind}`,
    rationale: `${actor} ${verbFor(kind)} tag — ${desc}`,
    citation: "",
    citation_url: "",
    suggested_fix: "",
    proposer_suggestion: "",
    proposer_term: tag.value ? termCopy(tag.value) : null,
  };
}

function verbFor(kind: "added" | "removed" | "modified"): string {
  switch (kind) {
    case "added":
      return "added";
    case "removed":
      return "dropped";
    case "modified":
      return "changed";
  }
}

/** Convenience for the chip strip's mode-tag — "Cy's audit of
 *  preboard" / "Am's audit of Cy" / etc. Used for the sidebar
 *  header when the override report is mounted. */
export function diffPanelTitle(
  baselineSource: Source,
  comparatorSource: Source,
): string {
  if (baselineSource === "empty") {
    return `${SOURCE_LABEL[comparatorSource]} (proposal)`;
  }
  if (baselineSource === comparatorSource) {
    return `${SOURCE_LABEL[baselineSource]} vs itself (regression check)`;
  }
  return `${SOURCE_LABEL[comparatorSource]} vs ${SOURCE_LABEL[baselineSource]}`;
}
