import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type {
  Design,
  Factor,
  FactorValue,
  Statement,
  Tag,
} from "@/features/experiment/types";
import {
  summariseSemanticDiff,
  type SemanticDiffSummary,
} from "@/features/design/diff";
import { fetchDesignSnapshot, fetchPreboardSnapshot } from "../../api/design";
import { isPolishedSource, polishedCuratorOf, type Source } from "./sources";

// Wire shape served by ``GET /datasets/{id}/proposals``. The endpoint
// returns ``curation_review(kind='proposal')`` rows — i.e. the proposal
// payload AS LOADED INTO THE PACKAGE, including the package-version of
// the agent's tags + factors. This is what the curator saw when
// dispositioning; pinning the chip's agent_proposal source to this row
// (rather than the latest ``agent_proposal`` table row served by
// ``/curation-proposals``) keeps the cy_polished vs agent_proposal
// diff symmetric — both halves derive from the same calibration
// package, so disposition outcomes are the only delta.
//
// Snake-case keys here because the api client normalises camelCase
// wire → snake_case before the response reaches us
// (``snakeify`` in ``api/client.ts``).
interface CurationReviewListResponse {
  items?: CurationReviewRow[];
}

interface CurationReviewRow {
  audit_id?: string | null;
  kind?: string;
  evidence?: {
    comparison_proposal?: PackagedProposal | null;
  };
}

interface PackagedTermObject {
  label?: string | null;
  uri?: string | null;
}

interface PackagedProposalTag {
  category?: PackagedTermObject | null;
  value?: PackagedTermObject | null;
}

interface PackagedStatement {
  subject?: PackagedTermObject | null;
  predicate?: PackagedTermObject | null;
  object?: PackagedTermObject | null;
  category?: PackagedTermObject | null;
}

interface PackagedFactorValue {
  free_text_label?: string;
  is_baseline?: boolean;
  statements?: PackagedStatement[];
  biomaterial_short_names?: string[];
}

interface PackagedProposalFactor {
  name_in_design?: string;
  category?: PackagedTermObject | null;
  description?: string;
  factor_type?: string;
  factor_values?: PackagedFactorValue[];
}

interface PackagedProposal {
  tags?: PackagedProposalTag[];
  factors?: PackagedProposalFactor[];
}

/** Compose the agent's "wholesale-accepted" Design — preboard +
 *  every proposed tag + every proposed factor. Mirrors what the
 *  curator would see if they hit "Apply All" on the proposal
 *  sidebar. Uses negative synthetic IDs for the added items so
 *  they don't collide with Gemma-assigned preboard IDs.
 *
 *  Sourced from the **packaged** proposal (the version Curator B reviewed
 *  in the calibration package) — NOT the latest agent re-run. This
 *  keeps the cy_polished vs agent_proposal diff symmetric — both
 *  halves derive from the same package, so dispositions are the
 *  only signal. */
function applyAgentProposalToDesign(
  preboard: Design,
  payload: PackagedProposal,
): Design {
  const out: Design = JSON.parse(JSON.stringify(preboard));
  let nextTagId = -1;
  let nextFactorId = -1;
  let nextFvId = -1000;

  const termOf = (
    t: PackagedTermObject | null | undefined,
  ): { label: string; uri: string | null } => ({
    label: t?.label ?? "",
    uri: t?.uri ?? null,
  });

  for (const t of payload.tags ?? []) {
    const tag: Tag = {
      id: nextTagId--,
      category: termOf(t.category),
      value: termOf(t.value),
      inferred: false,
      inferred_source: "",
      evidence_code: "",
    };
    (out.tags ??= []).push(tag);
  }

  for (const f of payload.factors ?? []) {
    const fvs: FactorValue[] = (f.factor_values ?? []).map((fv) => {
      const statements: Statement[] = (fv.statements ?? []).map((s) => ({
        id: -1,
        category: s.category ? termOf(s.category) : null,
        subject: termOf(s.subject),
        predicate: s.predicate ? termOf(s.predicate) : null,
        object: s.object ? termOf(s.object) : null,
      }));
      return {
        id: nextFvId--,
        free_text_label: fv.free_text_label ?? "",
        is_baseline: Boolean(fv.is_baseline),
        statements,
        biomaterial_short_names: fv.biomaterial_short_names ?? [],
      };
    });
    const cat = termOf(f.category);
    const factor: Factor = {
      id: nextFactorId--,
      name: f.name_in_design || cat.label || "factor",
      category: cat,
      description: f.description ?? "",
      type: (f.factor_type as Factor["type"]) ?? "categorical",
      factor_values: fvs,
    };
    (out.factors ??= []).push(factor);
  }

  return out;
}

async function fetchAgentProposalPayload(
  experimentId: number | string,
): Promise<PackagedProposal | null> {
  try {
    const raw = await api.get<CurationReviewListResponse | CurationReviewRow[]>(
      `/curation/v1/datasets/${experimentId}/proposals?limit=1`,
    );
    const rows = Array.isArray(raw) ? raw : (raw?.items ?? []);
    if (rows.length === 0) return null;
    return rows[0]?.evidence?.comparison_proposal ?? null;
  } catch {
    return null;
  }
}

/** Fetch the full calibration-package ``curation_review`` row — the
 *  same AuditReport the package import lands. Used by the chip-strip
 *  override path for ``polished-vs-agent`` comparisons: the report
 *  already carries the agent's findings (with rationale, defender
 *  verdicts, debate badges) AND the curator's dispositions (accept /
 *  dismiss reasons + notes), so the existing AuditSidebarPanel can
 *  render the full provenance trail without re-synthesis. Per design review
 *  2026-05-27: "we want all provenance and documentation we pick up
 *  along the way". */
export function useCalibrationAuditReport(experimentId: number | string) {
  return useQuery({
    enabled: Boolean(experimentId),
    queryKey: ["chip-calibration-report", experimentId] as const,
    staleTime: 30_000,
    queryFn: async () => {
      try {
        const raw = await api.get<{ items?: unknown[] } | unknown[]>(
          `/curation/v1/datasets/${experimentId}/proposals?limit=1`,
        );
        const rows = Array.isArray(raw)
          ? raw
          : ((raw as { items?: unknown[] })?.items ?? []);
        if (rows.length === 0) return null;
        return rows[0] as Record<string, unknown>;
      } catch {
        return null;
      }
    },
  });
}

/** Fetch one source's ``Design`` for the chip strip. ``empty`` and
 *  unfetchable sources return ``null`` rather than throw — the
 *  caller treats ``null`` baseline OR comparator as "no diff to
 *  compute". */
async function fetchSourceDesign(
  experimentId: number | string,
  source: Source,
): Promise<Design | null> {
  if (source === "empty") return null;
  if (source === "current") {
    // The BASE design — the row /design serves and commit() writes, not
    // a polished chip. Keeping these distinct is the point of the token.
    try {
      return await fetchDesignSnapshot(experimentId);
    } catch {
      return null;
    }
  }
  if (source === "preboard") {
    try {
      return await fetchPreboardSnapshot(experimentId);
    } catch {
      return null;
    }
  }
  if (isPolishedSource(source)) {
    const curator = polishedCuratorOf(source);
    try {
      return await api.get<Design>(
        `/curation/v1/datasets/${experimentId}/polished/${curator}`,
      );
    } catch {
      return null;
    }
  }
  if (source === "agent_proposal") {
    // "agent original proposal" = preboard + EVERY proposed tag +
    // EVERY proposed factor. Composed client-side from the
    // /curation-proposals payload + the /design/snapshot preboard.
    // The composeCurationDesign overlay path doesn't fold proposed
    // factors into the result (it only carries tags + per-FV
    // overlay), so we synthesise here directly. Synthetic
    // (negative) IDs for the added items.
    const [preboard, payload] = await Promise.all([
      fetchPreboardSnapshot(experimentId).catch(() => null),
      fetchAgentProposalPayload(experimentId),
    ]);
    if (!preboard) return null;
    if (!payload) return preboard;
    return applyAgentProposalToDesign(preboard, payload);
  }
  return null;
}

/** Fetch both Designs for the chip pair as react-query results.
 *  Exposed separately from ``useChipDiffSummary`` so consumers that
 *  need the underlying Designs (e.g. the sidebar override adapter)
 *  can read them without re-fetching. Query cache is shared via the
 *  ``["chip-design", eid, source]`` key. */
export function useChipDesignPair(
  experimentId: number | string,
  baseline: Source,
  comparator: Source,
): {
  baseline: Design | null;
  comparator: Design | null;
  isLoading: boolean;
} {
  const base = useQuery({
    enabled: Boolean(experimentId) && baseline !== "empty",
    queryKey: ["chip-design", experimentId, baseline] as const,
    queryFn: () => fetchSourceDesign(experimentId, baseline),
    staleTime: 30_000,
  });
  const cmp = useQuery({
    enabled: Boolean(experimentId) && comparator !== "empty",
    queryKey: ["chip-design", experimentId, comparator] as const,
    queryFn: () => fetchSourceDesign(experimentId, comparator),
    staleTime: 30_000,
  });
  return {
    baseline: base.data ?? null,
    comparator: cmp.data ?? null,
    isLoading: base.isLoading || cmp.isLoading,
  };
}

/** Compute the semantic-diff summary for the current chip pair.
 *  Returns ``null`` while either fetch is in flight or when one
 *  slot resolves to ``null`` (degenerate / bare modes). */
export function useChipDiffSummary(
  experimentId: number | string,
  baseline: Source,
  comparator: Source,
): { summary: SemanticDiffSummary | null; isLoading: boolean } {
  const pair = useChipDesignPair(experimentId, baseline, comparator);
  if (baseline === "empty" || comparator === "empty") {
    return { summary: null, isLoading: false };
  }
  if (!pair.baseline || !pair.comparator) {
    return { summary: null, isLoading: pair.isLoading };
  }
  return {
    summary: summariseSemanticDiff(pair.baseline, pair.comparator),
    isLoading: pair.isLoading,
  };
}
