/**
 * Ticket export — bundle every ``EXPRESSION_EXPERIMENT`` target on a
 * ticket into a single gzipped JSON file and trigger a browser
 * download.
 *
 * Mirrors ``exportSet.ts`` in shape (same per-experiment payload, same
 * compression + download path) but scopes by ticket targets rather
 * than a workflow Group's member_ids. The bundle records the ticket's
 * identifying fields (id, type, title, state) so a downstream consumer
 * can attribute the export back to the ticket that produced it.
 *
 * Non-EE targets (``GEO_ACCESSION`` triage candidates, ``ARRAY_DESIGN``
 * etc.) are listed under ``skipped`` with a reason — the bundle is
 * complete-by-design rather than partial-by-bug.
 */
import { fetchDesignSnapshot, fetchPolishedSnapshot } from "@/api/design";
import type { Design } from "@/features/experiment/types";
import type { Ticket, TicketTarget } from "@/api/tickets";
import {
  gzipJson,
  slugify,
  triggerDownload,
  type SetExportReviewStatus,
} from "@/features/workflow/exportSet";
import { api } from "@/api/client";
import type { AuditReport } from "@/api/auditTypes";

const BUNDLE_VERSION = 1 as const;
const UI_VERSION = "0.8.0";

export interface TicketExportBundle {
  bundle_kind: "gemma_curation_ticket_export";
  bundle_version: typeof BUNDLE_VERSION;
  exported_at: string;
  curator: string;
  ui_version: string;
  ticket: {
    id: number;
    type: Ticket["type"];
    state: Ticket["state"];
    title: string;
    body: string;
    priority: Ticket["priority"];
    target_count: number;
  };
  experiments: TicketExportExperiment[];
  /** Targets we couldn't or wouldn't export — non-EE target types,
   *  or per-fetch errors. Lets the consumer see what was dropped. */
  skipped: { target_type: string; target_id: number; reason: string }[];
}

export interface TicketExportExperiment {
  experiment_id: number | string | null;
  /** Composed canonical curation Design. Null when the per-experiment
   *  fetch failed; pair with ``error``. */
  design: Design | null;
  /** Latest curation-review row for this experiment. Same shape as
   *  the set-export bundle so downstream consumers can use one
   *  reader. */
  review_status: SetExportReviewStatus | null;
  error: string | null;
}

/** Same merge-from-/audits-and-/proposals dance as exportSet — kept
 *  local so this file doesn't reach into exportSet's privates. */
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

/** EE targets on the ticket whose experiment currently has uncommitted
 *  design edits cached in localStorage (``readDirtyExperimentIds``).
 *
 *  Both the ticket export and the per-experiment finalize read the
 *  PERSISTED design (``fetchPolishedSnapshot`` → ``fetchDesignSnapshot``),
 *  so an uncommitted draft is silently OMITTED from the bundle and
 *  STRANDED when the ticket closes — the freehand-edit residual the
 *  backend materialize-on-finalize net can't reconstruct (a hand-edited
 *  focus-only card has no structured ``apply_action`` to replay). The
 *  ticket header warns the curator before export / close using this list.
 *
 *  Pure over the dirty-id set so it's unit-testable without touching
 *  localStorage; callers pass ``readDirtyExperimentIds()``. Keys compare
 *  as strings — the draft cache is keyed by the route experiment id,
 *  which equals the EE target's numeric ``target_id`` (the same value
 *  ``buildTicketExport`` fetches), stringified. */
export function dirtyExperimentTargets(
  ticket: Ticket,
  dirtyExperimentIds: ReadonlySet<string>,
): TicketTarget[] {
  return ticket.targets.filter(
    (t) =>
      t.target_type === "EXPRESSION_EXPERIMENT" &&
      dirtyExperimentIds.has(String(t.target_id)),
  );
}

/** Build the bundle. Each EE target is fetched in parallel; per-target
 *  errors get captured into ``error`` rather than failing the whole
 *  batch. */
export async function buildTicketExport(
  ticket: Ticket,
  curator: string,
): Promise<TicketExportBundle> {
  const exportable: { experimentId: number }[] = [];
  const skipped: TicketExportBundle["skipped"] = [];

  for (const t of ticket.targets) {
    if (t.target_type !== "EXPRESSION_EXPERIMENT") {
      skipped.push({
        target_type: t.target_type,
        target_id: t.target_id,
        reason: `non-EE target type (${t.target_type})`,
      });
      continue;
    }
    exportable.push({ experimentId: t.target_id });
  }

  const experiments = await Promise.all(
    exportable.map(
      async ({ experimentId }): Promise<TicketExportExperiment> => {
        const [designResult, reviewResult] = await Promise.allSettled([
          (async () => {
            const polished = await fetchPolishedSnapshot(experimentId, curator);
            return polished ?? (await fetchDesignSnapshot(experimentId));
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
          experiment_id: design?.experiment_id ?? experimentId,
          design,
          review_status,
          error,
        };
      },
    ),
  );

  return {
    bundle_kind: "gemma_curation_ticket_export",
    bundle_version: BUNDLE_VERSION,
    exported_at: new Date().toISOString(),
    curator,
    ui_version: UI_VERSION,
    ticket: {
      id: ticket.id,
      type: ticket.type,
      state: ticket.state,
      title: ticket.title,
      body: ticket.body,
      priority: ticket.priority,
      target_count: ticket.targets.length,
    },
    experiments,
    skipped,
  };
}

/** Build, gzip, and trigger a download. Returns the built bundle so
 *  the caller can show a "exported N experiments" toast. */
export async function exportTicketAsGzip(
  ticket: Ticket,
  curator: string,
): Promise<TicketExportBundle> {
  const bundle = await buildTicketExport(ticket, curator);
  const text = JSON.stringify(bundle, null, 2);
  const blob = await gzipJson(text);
  const stamp = bundle.exported_at.replace(/[:.]/gu, "-");
  const stem = slugify(ticket.title) || `ticket-${ticket.id}`;
  // Curator + full timestamp → self-identifying, collision-proof name
  // (see exportSet.ts for the rationale).
  const filename =
    `gemma-ticket-${ticket.id}-${stem}-${slugify(curator)}-${stamp}.json.gz`;
  triggerDownload(blob, filename);
  return bundle;
}
