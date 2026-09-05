/**
 * The provenance join, run in the browser.
 *
 * 🛑 **This is a PORT, not a second design.** The store answers
 * `POST /curation/v1/datasets/{id}/provenance/lookup` by matching every
 * ref against every stored finding and folding the matches into one
 * trace per ref — `local_api/provenance.py::assemble_traces`, which
 * stays canonical. Gemma serves no such route (no path on the live
 * gemma2 OpenAPI matches `provenance`, re-checked 2026-09-04), so
 * remote mode does the same join here over the reviews it already
 * reads. Every tier, veto and silence below mirrors that module; when
 * one side changes, change both.
 *
 * The inputs are the same two halves the store joins, reached a
 * different way:
 *
 *   - the AGENT half — findings, their `supporting_evidence` and the
 *     report's `run_provenance` — from each annotation set's payload;
 *   - the HUMAN half — who ruled what, when, and why — from the
 *     `dispositions` Gemma serves on the same row.
 *
 * `fetchReviewsForExperiment` hands both over as `AuditReport[]` in
 * either mode, so this function never learns which backend it is on.
 *
 * 🛑 **Sparse is the design.** A ref that matches nothing is OMITTED
 * rather than returned empty — the panel's tally is asked-vs-answered,
 * and both spellings read the same on screen.
 */

import type {
  AuditFinding,
  AuditFindingDisposition,
  AuditReport,
} from "@/api/auditTypes";
import type {
  ProvenanceEvent,
  ProvenanceEventKind,
  ProvenanceRef,
  ProvenanceReviewState,
  ProvenanceTrace,
} from "@/api/provenance";
import { uriComparisonKey } from "@/lib/curie";

// --- matching ---------------------------------------------------------------
// Tiers, strongest first. The number IS the policy — see `matchTier`.
const T_GEMMA_FACTOR_ID = 0;
const T_LOCAL_FACTOR_ID = 1;
const T_TAG_URI_PAIR = 2;
const T_TAG_VALUE_URI = 3;
const T_SLUG = 4;
const T_FACTOR_CATEGORY = 5;

/** Tiers that are IDENTITIES. Disagreement at one of these is a veto.
 *  The two below the line are surface strings, consulted only when no
 *  identity is shared. */
const STRONG_TIERS: ReadonlySet<number> = new Set([
  T_GEMMA_FACTOR_ID,
  T_LOCAL_FACTOR_ID,
  T_TAG_URI_PAIR,
  T_TAG_VALUE_URI,
]);

/** Prefixes findings and dispositions actually use, LONGEST FIRST so
 *  `calibration:factor_extra:` is stripped before `factor:` can match
 *  a prefix of it. */
const SLUG_PREFIXES = [
  "calibration:factor_extra:",
  "calibration:extra:",
  "factor:",
  "tag:",
  "fv:",
] as const;

const LOCAL_FACTOR_ID_RE = /^local-[0-9a-f]{12}$/;

/** The three apply-action fields this join reads, off a union whose
 *  arms do not all declare them.
 *
 *  🛑 A duck-typed read on purpose, mirroring the store's
 *  `getattr(act, "new_value_uri", None)`. Narrowing on `kind` instead
 *  would make the matcher silently stop seeing a NEW arm that carries a
 *  value URI — the failure mode is a tag losing its trace, with nothing
 *  on screen to say so. */
function applyFields(action: unknown): {
  new_value?: string;
  new_value_uri?: string;
  new_category_uri?: string;
} {
  const a = (action ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return {
    new_value: str(a.new_value),
    new_value_uri: str(a.new_value_uri),
    new_category_uri: str(a.new_category_uri),
  };
}

type Keys = Map<number, string>;

/** Lowercase, keep `/` as the category/value separator, everything else
 *  becomes a single hyphen. Makes `biological sex/male` (a finding) and
 *  `biological-sex/male` (a UI slug) the same token, which is the only
 *  reason this tier is usable at all. */
function slugify(text: string | null | undefined): string {
  return (text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The identifying part of a target slug, prefix and display suffix
 *  stripped. `factor:strain#3` → `strain`; the `#N` is the UI's
 *  de-duplication suffix for same-name siblings on one page and means
 *  nothing here. */
function slugRest(targetId: string | null | undefined): string {
  let t = (targetId ?? "").trim();
  const low = t.toLowerCase();
  for (const p of SLUG_PREFIXES) {
    if (low.startsWith(p)) {
      t = t.slice(p.length);
      break;
    }
  }
  return slugify(t.replace(/#\d+$/, ""));
}

function refKeys(
  ref: ProvenanceRef,
  uniqueCategories: ReadonlySet<string>,
  uniqueSlugs: ReadonlySet<string>,
): Keys {
  const keys: Keys = new Map();
  if (ref.gemma_factor_id != null) {
    keys.set(T_GEMMA_FACTOR_ID, String(ref.gemma_factor_id));
  }
  if (ref.local_factor_id) keys.set(T_LOCAL_FACTOR_ID, ref.local_factor_id);
  const cat = uriComparisonKey(ref.category_uri);
  const val = uriComparisonKey(ref.value_uri);
  if (ref.kind === "tag" && val) {
    keys.set(T_TAG_VALUE_URI, val);
    if (cat) keys.set(T_TAG_URI_PAIR, `${cat}/${val}`);
  }
  // 🛑 A slug shared by two annotations identifies NEITHER. Same-
  // category-same-name siblings are common (two `treatment` factors on
  // one experiment), and a finding cannot say which one it meant — so
  // neither gets the trace. An annotation showing its sibling's
  // rationale is a lie told confidently; silence is the honest answer.
  const rest = slugRest(ref.target_id);
  if (rest && uniqueSlugs.has(rest)) keys.set(T_SLUG, rest);
  // Category-only matching is how an "agent proposed this whole
  // factor" finding (keyed `{category}:{value}`, never `{category}`)
  // reaches the factor it became. Guarded by the same uniqueness, for
  // the same reason.
  if (ref.kind === "factor" && ref.category_label) {
    const cslug = slugify(ref.category_label);
    if (cslug && uniqueCategories.has(cslug)) {
      keys.set(T_FACTOR_CATEGORY, cslug);
    }
  }
  return keys;
}

/** Identity the curation UI stamped onto the disposition at click time.
 *
 *  🛑 **Knowledge, not inference** — everything in `findingKeys`
 *  reconstructs which annotation a finding was about after the fact,
 *  and only the UI knew it at the instant the curator clicked. So a
 *  stamp wins over a derived key on the same tier. It is also the only
 *  thing that rescues same-category-same-name siblings, which the
 *  matcher must otherwise refuse.
 *
 *  Gemma's `DispositionResponse` carries no stamp columns, so in remote
 *  mode this fires only for a ruling that rode in on the payload rather
 *  than the envelope. Absent means "fall through to the derived keys",
 *  never "no match". */
function stampKeys(d: AuditFindingDisposition | null | undefined): Keys {
  const keys: Keys = new Map();
  if (!d) return keys;
  const s = d as AuditFindingDisposition & {
    gemma_factor_id?: number | null;
    local_factor_id?: string | null;
    category_uri?: string | null;
    value_uri?: string | null;
  };
  if (s.gemma_factor_id != null) {
    keys.set(T_GEMMA_FACTOR_ID, String(s.gemma_factor_id));
  }
  if (s.local_factor_id) keys.set(T_LOCAL_FACTOR_ID, s.local_factor_id);
  const val = uriComparisonKey(s.value_uri);
  const cat = uriComparisonKey(s.category_uri);
  if (val) {
    keys.set(T_TAG_VALUE_URI, val);
    if (cat) keys.set(T_TAG_URI_PAIR, `${cat}/${val}`);
  }
  return keys;
}

function findingKeys(finding: AuditFinding): Keys {
  const keys: Keys = new Map();
  const target = finding.target_id ?? "";
  let rest = target;
  const low = target.toLowerCase();
  for (const p of SLUG_PREFIXES) {
    if (low.startsWith(p)) {
      rest = target.slice(p.length);
      break;
    }
  }

  if (finding.target_kind === "factor") {
    // `factor:13531` — the strongest key there is, and the one that
    // makes a relabel survivable.
    if (/^\d+$/.test(rest)) {
      keys.set(T_GEMMA_FACTOR_ID, rest);
    } else if (LOCAL_FACTOR_ID_RE.test(rest)) {
      // `factor:local-9f2c1a4b7e30`. Matched exactly, so the FV form
      // (`local-fv-…`) cannot be mistaken for a factor.
      keys.set(T_LOCAL_FACTOR_ID, rest);
    }
    // A rename / partition-mismatch payload names the factor on BOTH
    // sides; the gold side is the one the curator is looking at.
    for (const payload of [finding.rename, finding.partition_mismatch]) {
      const gid = payload?.gold?.gemma_factor_id;
      if (gid != null && !keys.has(T_GEMMA_FACTOR_ID)) {
        keys.set(T_GEMMA_FACTOR_ID, String(gid));
      }
    }
    const head = rest.split(/[:/]/, 1)[0] ?? "";
    const hslug = slugify(head);
    if (hslug) keys.set(T_FACTOR_CATEGORY, hslug);
  }

  if (finding.target_kind === "tag") {
    const act = applyFields(finding.apply_action);
    let val = uriComparisonKey(act.new_value_uri);
    const cat = uriComparisonKey(act.new_category_uri);
    if (!val && finding.proposer_term) {
      val = uriComparisonKey(finding.proposer_term.uri);
    }
    if (val) {
      keys.set(T_TAG_VALUE_URI, val);
      if (cat) keys.set(T_TAG_URI_PAIR, `${cat}/${val}`);
    }
  }

  const slugKey = slugify(rest.replace(/#\d+$/, ""));
  if (slugKey) keys.set(T_SLUG, slugKey);
  return keys;
}

/**
 * The tier these two match at, or `null`.
 *
 * 🛑 **The strongest IDENTITY both sides carry decides alone.** If the
 * ref and the finding both know a Gemma factor id and the ids differ
 * they are different factors, and no amount of slug agreement rescues
 * that — which is the point, because the slug is exactly what collides
 * for same-category siblings. Conversely a slug DISAGREEMENT never
 * vetoes an id agreement: labels move, ids don't.
 *
 * The two surface tiers carry no veto — a finding keyed
 * `genotype:trp53` and a factor slugged `genotype` disagree at the slug
 * tier and still legitimately match at the category tier.
 */
export function matchTier(refK: Keys, findK: Keys): number | null {
  const sharedStrong = [...refK.keys()]
    .filter((t) => findK.has(t) && STRONG_TIERS.has(t))
    .sort((a, b) => a - b);
  if (sharedStrong.length > 0) {
    const tier = sharedStrong[0];
    return refK.get(tier) === findK.get(tier) ? tier : null;
  }
  const shared = [...refK.keys()].filter((t) => findK.has(t)).sort((a, b) => a - b);
  for (const tier of shared) {
    if (refK.get(tier) === findK.get(tier)) return tier;
  }
  return null;
}

// --- event assembly ---------------------------------------------------------

function nonEmpty(s: string | null | undefined): string | null {
  const v = (s ?? "").trim();
  return v ? v : null;
}

function proposedEvent(
  finding: AuditFinding,
  report: AuditReport,
): ProvenanceEvent {
  const prov = report.run_provenance ?? null;
  let before: ProvenanceEvent["before"] = null;
  let after: ProvenanceEvent["after"] = null;
  if (finding.rename) {
    before = {
      label: nonEmpty(finding.rename.gold?.category?.label),
      uri: nonEmpty(finding.rename.gold?.category?.uri),
    };
    after = {
      label: nonEmpty(finding.rename.agent?.category?.label),
      uri: nonEmpty(finding.rename.agent?.category?.uri),
    };
  } else {
    const act = applyFields(finding.apply_action);
    if (act.new_value) {
      after = { label: act.new_value, uri: nonEmpty(act.new_value_uri) };
    }
  }
  // Only the three known buckets travel; anything else is dropped
  // rather than passed through, so a typo upstream cannot reach the
  // curator as a label. `confidence` stays null on purpose — findings
  // carry a WORD, and coercing `high` to 0.9 would invent a precision
  // nobody measured.
  const bucket = (finding.recommendation?.confidence ?? "").trim().toLowerCase();
  const summary =
    nonEmpty(finding.rationale_summary) ?? nonEmpty(finding.rationale);
  return {
    kind: "agent_proposed",
    at: nonEmpty(prov?.ran_at) ?? nonEmpty(report.audited_at),
    actor: {
      kind: "agent",
      name: nonEmpty(prov?.agent_identity),
      model: nonEmpty(prov?.model) ?? nonEmpty(report.model),
      head_sha: nonEmpty(prov?.run_sha),
    },
    run_id: nonEmpty(prov?.run_id),
    summary,
    confidence_bucket:
      bucket === "high" || bucket === "medium" || bucket === "low"
        ? bucket
        : null,
    evidence: finding.supporting_evidence ?? [],
    before,
    after,
  };
}

/** The human half. `pending` is the row written for every finding a
 *  curator has merely LOOKED at, so it is not an event — treating it as
 *  one would render "a human reviewed this" for a review nobody
 *  opened. */
function dispositionEvent(
  d: AuditFindingDisposition,
): ProvenanceEvent | null {
  let kind: ProvenanceEventKind;
  let reason: string | null;
  if (d.status === "accepted") {
    kind = "agent_applied";
    reason = nonEmpty(asText(d.accept_reason)) ?? nonEmpty(d.notes);
  } else if (d.status === "dismissed") {
    kind = "curator_rejected";
    reason = nonEmpty(asText(d.dismiss_reason)) ?? nonEmpty(d.notes);
  } else if (d.status === "needs_more_info") {
    kind = "curator_edited";
    reason = nonEmpty(asText(d.not_sure_reason)) ?? nonEmpty(d.notes);
  } else {
    return null;
  }
  return {
    kind,
    at: nonEmpty(d.reviewed_at),
    actor: { kind: "curator", name: nonEmpty(d.reviewer) },
    reason,
    summary: null,
  };
}

/** The structured reason chips are string enums on the wire; a
 *  non-string here would render as `[object Object]`, so it is dropped
 *  rather than stringified. */
function asText(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

const STATE_BY_STATUS: Record<string, ProvenanceReviewState> = {
  accepted: "accepted",
  dismissed: "rejected",
  needs_more_info: "unreviewed",
  pending: "unreviewed",
};

/**
 * Match every ref against every finding and fold the matches into one
 * trace per ref.
 *
 * Ambiguity is a property of the REQUEST, not of one ref, so both
 * uniqueness guards are computed once over the whole ref list — which
 * is the right scope, because it carries every annotation on the
 * experiment, exactly the population a slug has to be unique within to
 * identify anything.
 */
export function assembleTraces(
  refs: ProvenanceRef[],
  reports: AuditReport[],
): Map<string, ProvenanceTrace> {
  const catSeen = new Map<string, number>();
  const slugSeen = new Map<string, number>();
  for (const r of refs) {
    if (r.kind === "factor" && r.category_label) {
      const c = slugify(r.category_label);
      if (c) catSeen.set(c, (catSeen.get(c) ?? 0) + 1);
    }
    const s = slugRest(r.target_id);
    if (s) slugSeen.set(s, (slugSeen.get(s) ?? 0) + 1);
  }
  const uniqueCategories = new Set(
    [...catSeen].filter(([, n]) => n === 1).map(([c]) => c),
  );
  const uniqueSlugs = new Set(
    [...slugSeen].filter(([, n]) => n === 1).map(([s]) => s),
  );

  const keyed = refs.map(
    (r) => [r, refKeys(r, uniqueCategories, uniqueSlugs)] as const,
  );

  const out = new Map<string, ProvenanceTrace>();
  // (reviewed_at, status) for every disposition that touched a matched
  // finding. `review_state` is the LATEST of them, never "any accept
  // wins": a curator who accepted in July and dismissed in August has
  // dismissed it.
  const verdicts = new Map<string, Array<[string, string]>>();

  for (const report of reports) {
    const byTarget = new Map<string, AuditFindingDisposition>();
    for (const d of report.dispositions ?? []) {
      if (d?.target_id) byTarget.set(d.target_id, d);
    }
    for (const finding of report.findings ?? []) {
      const d = byTarget.get(finding.target_id ?? "") ?? null;
      // The stamp OVERRIDES the derived key on the same tier — it is
      // what the curator actually acted on, not what we inferred.
      const fkeys: Keys = new Map([
        ...findingKeys(finding),
        ...stampKeys(d),
      ]);
      if (fkeys.size === 0) continue;
      for (const [ref, rkeys] of keyed) {
        if (matchTier(rkeys, fkeys) === null) continue;
        let trace = out.get(ref.ref_id);
        if (!trace) {
          trace = { ref_id: ref.ref_id, events: [] };
          out.set(ref.ref_id, trace);
        }
        trace.events.push(proposedEvent(finding, report));
        if (!d) continue;
        const ev = dispositionEvent(d);
        if (ev) trace.events.push(ev);
        const rows = verdicts.get(ref.ref_id) ?? [];
        rows.push([d.reviewed_at ?? "", d.status]);
        verdicts.set(ref.ref_id, rows);
      }
    }
  }

  for (const [refId, trace] of out) {
    const rows = (verdicts.get(refId) ?? [])
      .slice()
      .sort((a, b) => (a[0] === b[0] ? cmp(a[1], b[1]) : cmp(a[0], b[0])));
    const last = rows[rows.length - 1];
    trace.review_state = last
      ? (STATE_BY_STATUS[last[1]] ?? "unreviewed")
      : "unreviewed";
    // Newest first — "what happened to this" is the usual question and
    // the origin is one scroll away at the bottom. Consumers render the
    // list in the order they get it, so the sort belongs here.
    trace.events.sort((a, b) => cmp(b.at ?? "", a.at ?? ""));
  }
  return out;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
