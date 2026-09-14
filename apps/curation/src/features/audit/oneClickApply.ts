/**
 * One-click Accept: the agent executes an audit finding's edit against
 * Gemma and records the ruling, in one call.
 *
 * Remote mode only. `POST /curation-apply/{set}/{finding}` plans the
 * finding's `apply_action` against the live design, commits it as
 * `gemmaAgent` on behalf of the curator, reads the dataset back, and
 * writes `accepted` — or `needs_more_info` with the reason when the
 * read-back does not show the edit. Local mode keeps the draft mutators
 * in `applyHandlers.ts`.
 *
 * Which kinds execute is read from the agents repo's export,
 * `apps/curation/generated/applyActionKinds.json`, never listed here: a
 * kind the agent learns to execute gets the button with no UI change.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { AuditFinding, AuditReport } from "@/api/auditTypes";
import { invalidateAuditCaches } from "@/api/audits";
import {
  applyFinding,
  applyRefusalOf,
  conflictOf,
  type FindingApplyResult,
} from "@/api/curationCommit";
import { invalidateAfterDesignCommit } from "@/api/design";
import { useToast } from "@/components/ui/Toast";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { useGemmaMode } from "@/lib/gemmaMode";
import kindList from "../../../generated/applyActionKinds.json";

import { useAudit } from "./AuditContext";

interface KindEntry {
  kind: string;
  executes: boolean;
}

/** Apply-action kinds the agent executes in one click. */
export const EXECUTING_KINDS: ReadonlySet<string> = new Set(
  (kindList as unknown as { kinds: KindEntry[] }).kinds
    .filter((k) => k.executes)
    .map((k) => k.kind),
);

/** The Gemma annotation-set id a report was read from, or null when it
 *  has none (a dev override, a synthetic chip-diff report). */
export function annotationSetIdOf(
  report: AuditReport | null | undefined,
): string | null {
  const id = report?.audit_id;
  return id && /^\d+$/.test(id) ? id : null;
}

/** Whether Accept on this finding goes to the agent's one-click route. */
export function oneClickEligible(
  finding: AuditFinding,
  report: AuditReport | null | undefined,
  mode: string,
): boolean {
  if (mode !== "remote") return false;
  const kind = finding.apply_action?.kind;
  if (!kind || !EXECUTING_KINDS.has(kind)) return false;
  return !!finding.finding_id && annotationSetIdOf(report) !== null;
}

export interface OneClickApply {
  eligible: boolean;
  /** Why a click would not run, stated before the click. */
  blockedReason: string | null;
  running: boolean;
  run: () => Promise<void>;
  /** The dry run, fetched on demand (`preview.refetch()`). */
  preview: ReturnType<typeof useQuery<FindingApplyResult>>;
}

export function useOneClickApply(finding: AuditFinding): OneClickApply {
  const { mode } = useGemmaMode();
  const { report, experimentId, reviewer } = useAudit();
  const { diff } = useDesignDraft();
  const qc = useQueryClient();
  const toast = useToast();
  const [running, setRunning] = useState(false);

  const eligible = oneClickEligible(finding, report, mode);
  const setId = annotationSetIdOf(report) ?? "";
  const findingId = finding.finding_id ?? "";
  // The draft must be clean. The apply commits to Gemma, and only a
  // clean draft follows the refetched design; a dirty one would sit on
  // top of a server state it was never diffed against.
  const blockedReason = !eligible
    ? null
    : !reviewer
      ? "Sign in first: the agent commits on behalf of a named curator."
      : diff?.isDirty
        ? "Commit or undo your design edits first: Accept writes to Gemma directly."
        : null;

  const previewKey = ["curation-apply-preview", setId, findingId] as const;
  const preview = useQuery<FindingApplyResult>({
    queryKey: previewKey,
    queryFn: () =>
      applyFinding(setId, findingId, { onBehalfOf: reviewer, dryRun: true }),
    enabled: false,
    retry: false,
    staleTime: 30_000,
  });

  async function run(): Promise<void> {
    if (!eligible || running) return;
    if (blockedReason) {
      toast.show(blockedReason, "warn", 6000);
      return;
    }
    setRunning(true);
    try {
      const res = await applyFinding(setId, findingId, {
        onBehalfOf: reviewer,
      });
      // 🛑 Refetch, never `reload()` the draft. `reload()` nulls the
      // draft until `saved` changes, and an apply that changes nothing
      // (`already_present`, or a read-back that shows no edit) refetches
      // an identical design, so the page sat on "loading overview…". The
      // clean draft follows a changed design through the ordinary
      // refetch sync.
      invalidateAfterDesignCommit(qc, experimentId);
      invalidateAuditCaches(qc, experimentId);
      qc.removeQueries({ queryKey: previewKey });
      if (res.status === "already_present") {
        toast.show("Already in Gemma; recorded as accepted.", "success", 4000);
      } else if (res.verified === false) {
        toast.show(
          `Committed, but reading it back did not show the edit${
            res.verify_detail ? `: ${res.verify_detail}` : ""
          }. Recorded as needs more info.`,
          "danger",
          9000,
        );
      } else {
        toast.show(
          res.detail ? `Applied in Gemma: ${res.detail}` : "Applied in Gemma.",
          "success",
          4000,
        );
      }
    } catch (err) {
      const refusal = applyRefusalOf(err);
      const conflict = conflictOf(err);
      if (refusal) {
        toast.show(`Not applied, nothing written: ${refusal}`, "danger", 9000);
      } else if (conflict) {
        toast.show(
          `Not applied: ${conflict.message} ${conflict.nextMove}`,
          "danger",
          9000,
        );
      } else {
        toast.show(
          `Accept failed: ${(err as Error)?.message ?? String(err)}`,
          "danger",
          9000,
        );
      }
    } finally {
      setRunning(false);
    }
  }

  return { eligible, blockedReason, running, run, preview };
}
