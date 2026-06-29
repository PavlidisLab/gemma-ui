/**
 * Set export — bundle every experiment in a workflow Group into a
 * single gzipped JSON file and trigger a browser download.
 *
 * Wire goal: this stand-in mimics what will eventually be a direct
 * POST to the curation agent. Today the curator hands the file off
 * manually; tomorrow the same payload is the request body for a
 * yet-to-land agent endpoint. Either way the shape is what's
 * load-bearing.
 *
 * Bundle shape (top-level):
 *
 *   {
 *     bundle_kind: "gemma_curation_set_export",
 *     bundle_version: 1,
 *     exported_at: ISO-8601,
 *     curator: string,
 *     ui_version: string,
 *     set: { id, name, type, description, member_count },
 *     experiments: [
 *       { member_id, experiment_id?, design?, error? },
 *       ...
 *     ],
 *     skipped: [{ member_id, reason }],
 *   }
 *
 * Each ``experiments[].design`` is the composed canonical Design
 * (factors / FVs / biomaterials / tags / external_source / metadata),
 * i.e. exactly what the curator sees on the curation page after
 * their commits land. Per-experiment fetch failures get an
 * ``error`` field rather than aborting the whole bundle.
 *
 * Compression uses the browser-native ``CompressionStream("gzip")``
 * — no dependency. Output is a single ``.json.gz`` file; the agent
 * (or any consumer) can decompress with stock zlib.
 */
import { fetchDesignSnapshot, fetchPolishedSnapshot } from "@/api/design";
import { api } from "@/api/client";
import type { AuditReport, CurationReviewKind } from "@/api/auditTypes";
import type { Design } from "@/features/experiment/types";
import type { Group } from "@/api/workflowTypes";

const BUNDLE_VERSION = 2 as const;
// Bumped by hand alongside the apps/curation/package.json version.
// Travels in the bundle so a downstream agent can branch on
// producer version if the shape ever drifts.
const UI_VERSION = "0.8.0";

export interface SetExportBundle {
  bundle_kind: "gemma_curation_set_export";
  bundle_version: typeof BUNDLE_VERSION;
  exported_at: string;
  curator: string;
  ui_version: string;
  set: {
    id: string;
    name: string;
    type: Group["type"];
    description: string;
    member_count: number;
    /** Per bro's REVIEW_EXPORT_BUNDLE_HANDOFF (2026-05-25):
     *  set-level rollup so the consumer can triage at a glance
     *  without scanning each entry's ``review_status``. */
    n_finalized: number;
    /** Members with a curation review row that hasn't been
     *  finalized (open proposal / open audit). */
    n_open: number;
    /** Members the curator never touched — seed shape only. */
    n_untouched: number;
  };
  experiments: SetExportExperiment[];
  /** Member IDs we couldn't or wouldn't try to export (e.g. a
   *  preboarding stub with no real Design yet). Surfaced so the
   *  agent / consumer knows the bundle is complete-by-design,
   *  not partial-by-bug. */
  skipped: { member_id: string; reason: string }[];
}

/** Per-experiment review state (v2). ``null`` means the experiment
 *  has no curation review row at all — the design is whatever
 *  Gemma seeded, untouched by the curator. Receiver can filter
 *  ``review_status != null && is_finalized`` to score only the
 *  reviewed subset. */
export interface SetExportReviewStatus {
  kind: CurationReviewKind;
  is_finalized: boolean;
  finalized_at: string | null;
  finalized_by: string | null;
  /** Server-side curation_review row id (audit_id on the
   *  ``AuditReport`` shape). Lets the consumer cross-reference
   *  this export with the agent's persistence store. */
  review_id: string | null;
  /** ISO timestamp the agent stamped on the report itself
   *  (independent of finalize state). */
  reviewed_at: string | null;
  /** Pass through the agent identifier so the consumer knows
   *  which agent produced the review without re-fetching. */
  model: string | null;
}

export interface SetExportExperiment {
  member_id: string;
  experiment_id: number | string | null;
  /** Composed canonical curation Design. Null when the per-
   *  experiment fetch failed; pair with ``error``. */
  design: Design | null;
  /** Latest curation-review row for this experiment, or ``null``
   *  when the experiment has none. Added in bundle v2 per bro's
   *  handoff — lets the receiver filter to reviewed-only without
   *  guessing from design heuristics. */
  review_status: SetExportReviewStatus | null;
  error: string | null;
}

/** Pull the numeric tail off a group ``member_id``. Plain numeric
 *  IDs return themselves; ``preboarding:N`` returns ``N``; an
 *  unparseable prefix returns null. */
function numericTail(memberId: string): number | null {
  const tail = memberId.includes(":") ? memberId.split(":")[1] : memberId;
  const n = Number(tail);
  return Number.isFinite(n) ? n : null;
}

/** Fetch the latest curation review (audit / proposal — same wire
 *  shape) for an experiment, or null when none exists / the
 *  endpoint isn't available on this backend.
 *
 *  local_api splits review-kind retrieval into two endpoints:
 *  ``/datasets/{id}/audits`` returns ``kind='audit'`` rows only,
 *  ``/datasets/{id}/proposals`` returns ``kind='proposal'`` rows
 *  only. Hitting one alone misses the other (caught 2026-05-25 —
 *  bro's V2_FOLLOWUP handoff reported all 28 review_status fields
 *  null because we only hit /audits while the curator's recent
 *  work was proposal-kind). Hit both in parallel, merge, pick the
 *  most-recent. */
async function fetchLatestReviewStatus(
  experimentId: number | string,
): Promise<SetExportReviewStatus | null> {
  async function fetchList(path: string): Promise<AuditReport[]> {
    try {
      const resp = await api.get<{ items: AuditReport[]; total: number }>(
        path,
      );
      return Array.isArray(resp.items) ? resp.items : [];
    } catch (err) {
      // 404 → endpoint not exposed on this backend. Treat as
      // "no items" so the other endpoint's items still count.
      const e = err as { status?: number };
      if (e && typeof e === "object" && e.status === 404) return [];
      throw err;
    }
  }
  const [audits, proposals] = await Promise.all([
    fetchList(`/rest/v2/datasets/${experimentId}/audits`),
    fetchList(`/rest/v2/datasets/${experimentId}/proposals`),
  ]);
  const all = [...audits, ...proposals];
  if (all.length === 0) return null;
  // Most-recent-first by audited_at; server already sorts each
  // list this way but the cross-endpoint merge needs a unified pass.
  const latest = all.slice().sort((a, b) => {
    const ta = a.audited_at ? Date.parse(a.audited_at) : 0;
    const tb = b.audited_at ? Date.parse(b.audited_at) : 0;
    return tb - ta;
  })[0];
  return {
    kind: latest.kind ?? "audit",
    is_finalized: !!latest.finalized_at,
    finalized_at: latest.finalized_at ?? null,
    finalized_by: latest.finalized_by ?? null,
    review_id: latest.audit_id ?? null,
    reviewed_at: latest.audited_at ?? null,
    model: latest.model ?? null,
  };
}

/** Build the bundle. Each member is fetched in parallel; per-
 *  member errors get captured into ``error`` rather than failing
 *  the whole batch. */
export async function buildSetExport(
  group: Group,
  curator: string,
): Promise<SetExportBundle> {
  const exportable: { memberId: string; experimentId: number }[] = [];
  const skipped: { member_id: string; reason: string }[] = [];

  for (const memberId of group.member_ids) {
    if (memberId.startsWith("preboarding:")) {
      skipped.push({
        member_id: memberId,
        reason: "preboarding entry — no curation Design yet",
      });
      continue;
    }
    const id = numericTail(memberId);
    if (id === null) {
      skipped.push({
        member_id: memberId,
        reason: "couldn't parse a numeric dataset id from member_id",
      });
      continue;
    }
    exportable.push({ memberId, experimentId: id });
  }

  const experiments = await Promise.all(
    exportable.map(async ({ memberId, experimentId }): Promise<SetExportExperiment> => {
      // Source preference: the curator's polished Design (the actual
      // edited state, what the UI's "<curator> polished" baseline
      // chip reads from). If the curator has no polished Design
      // stored for this experiment, fall back to the composed
      // snapshot — at minimum the bundle still carries the preboard
      // + the agent's last proposal overlay, which is what legacy
      // bundles shipped pre-2026-05-29.
      const [designResult, reviewResult] = await Promise.allSettled([
        (async () => {
          const polished = await fetchPolishedSnapshot(experimentId, curator);
          return polished ?? await fetchDesignSnapshot(experimentId);
        })(),
        fetchLatestReviewStatus(experimentId),
      ]);
      const design =
        designResult.status === "fulfilled" ? designResult.value : null;
      const review_status =
        reviewResult.status === "fulfilled" ? reviewResult.value : null;
      const error =
        designResult.status === "rejected"
          ? (designResult.reason as Error).message ||
            String(designResult.reason)
          : null;
      return {
        member_id: memberId,
        experiment_id: design?.experiment_id ?? experimentId,
        design,
        review_status,
        error,
      };
    }),
  );

  let nFinalized = 0;
  let nOpen = 0;
  let nUntouched = 0;
  for (const e of experiments) {
    if (!e.review_status) nUntouched++;
    else if (e.review_status.is_finalized) nFinalized++;
    else nOpen++;
  }

  return {
    bundle_kind: "gemma_curation_set_export",
    bundle_version: BUNDLE_VERSION,
    exported_at: new Date().toISOString(),
    curator,
    ui_version: UI_VERSION,
    set: {
      id: group.id,
      name: group.name,
      type: group.type,
      description: group.description,
      member_count: group.member_count,
      n_finalized: nFinalized,
      n_open: nOpen,
      n_untouched: nUntouched,
    },
    experiments,
    skipped,
  };
}

/** Gzip a UTF-8 string using the browser-native CompressionStream.
 *  No third-party dep. Returns a Blob suitable for download.
 *
 *  Exported so other surfaces (ticket export, future bundle-shaped
 *  downloads) can reuse the same compression + download pipeline
 *  without duplicating the CompressionStream dance. */
export async function gzipJson(text: string): Promise<Blob> {
  const stream = new Blob([text], { type: "application/json" })
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const compressed = await new Response(stream).blob();
  return new Blob([compressed], { type: "application/gzip" });
}

/** Slugify a set name for use as the download filename's stem.
 *  Exported so ticket / cross-experiment exports reuse the same
 *  ASCII-clean filename rules. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 60) || "set";
}

/** Trigger a browser download for the given Blob + filename.
 *  Exported so other download paths (ticket export, etc.) reuse the
 *  same revoke-on-next-tick Safari workaround. */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on next tick — Safari occasionally drops the download
  // if the URL is revoked synchronously.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Build the bundle, gzip it, and trigger a download. Returns the
 *  built bundle (caller can show a "exported N experiments, skipped
 *  M" summary in a toast). */
export async function exportSetAsGzip(
  group: Group,
  curator: string,
): Promise<SetExportBundle> {
  const bundle = await buildSetExport(group, curator);
  const text = JSON.stringify(bundle, null, 2);
  const blob = await gzipJson(text);
  const stamp = bundle.exported_at.replace(/[:.]/gu, "-");
  // Include the curator + the full export timestamp so two curators'
  // exports of the same set are self-identifying AND never collide.
  // (Without the curator, Cy's and Am's exports differ only by a
  // sub-second timestamp and don't say who made them, which forced a
  // manual <reviewer>_<date-only> rename that then collided on date.)
  const filename =
    `gemma-set-${slugify(group.name)}-${slugify(curator)}-${stamp}.json.gz`;
  triggerDownload(blob, filename);
  return bundle;
}
