import { useState } from "react";

import { ApiError } from "@/api/client";
import { useDatasetVisibility, usePublishExperiment } from "@/api/datasets";
import { useMe } from "@/api/session";
import { useDesignDraft } from "@/features/design/DesignDraftContext";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

/** Make-a-dataset-public affordance. Split out of `ExperimentBanner.tsx` 2026-09-01 — behaviour unchanged. */

/**
 * Publish button. Flipping an experiment public is destructive in
 * the "everyone can see this now" sense — gate behind a
 * ConfirmModal. The mutation hits ``POST /rest/v2/datasets/{id}/publish``
 * (same URL as the curation mock; real Gemma exposes the
 * read-side `isPublic` on the EE VO so the disabled-when-public
 * branch below works against either).
 *
 * Disabled when:
 *   - there are uncommitted draft changes (commit first),
 *   - the experiment is already public.
 */
export function PublishButton({ experimentId }: { experimentId: number | string }) {
  const { diff } = useDesignDraft();
  const me = useMe();
  const reviewer = me.data?.username ?? "";
  const visibility = useDatasetVisibility(experimentId);
  const publish = usePublishExperiment(experimentId, reviewer);
  const [confirming, setConfirming] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isPublic = visibility.data?.is_public ?? false;
  // Enabled 2026-08-26. It was force-disabled in 2026-05-25's review
  // because "the local POST works but the real Gemma side isn't
  // ready", and an active button that no-ops misleads curators.
  //
  // That reasoning was about PRODUCTION readiness, and it kept the one
  // step that ends the workflow untestable. Paul: "the whole point
  // here was to exercise the whole workcycle outside of production."
  // The stack now points at the sandbox throughout, so the cycle can
  // be walked end to end without touching production.
  //
  // 🛑 Know what this does today: it POSTs to the curation STORE's
  // `/publish`, flipping the visibility record the store keeps. It
  // does NOT change anything in Gemma — publishing there is a Gemma
  // write, which this app does not make. The confirm text says so
  // rather than letting the button imply more than it does.
  const dirty = diff.isDirty;
  const disabled = isPublic || dirty || publish.isPending;

  // 🛑 "coming soon" described the FEATURE and so read as "nothing is
  // expected of you". Publishing is a step the curator still owes —
  // this experiment is not finished until it happens — and a curator
  // who reads the button as a missing feature stops here thinking they
  // are done. Paul: "it should have some indication that this still
  // has to be done — otherwise curator will think they are done."
  //
  // Say both halves: the step is outstanding, AND it cannot be taken
  // from here yet. Publishing writes to Gemma, and this app is a
  // read-only client of Gemma — it has to go through the agent, which
  // has no publish route yet (preflight / commit / sign / draft / lock).
  const title = isPublic
    ? "already published"
    : dirty
      ? "commit your draft changes before publishing"
      : publish.isPending
        ? "publishing…"
        // Says what it does, not what the word implies. This records
        // the publish in the curation store; Gemma's own visibility is
        // unchanged, because this app does not write to Gemma.
        : "Record this experiment as published in the curation store. Does not change its visibility in Gemma.";

  return (
    <>
      <button
        type="button"
        className="btn text-xs !px-2 !py-1"
        disabled={disabled}
        onClick={() => setConfirming(true)}
        title={title}
      >
        {publish.isPending ? "publishing…" : isPublic ? "published" : "publish"}
      </button>
      <ConfirmModal
        open={confirming}
        title="Publish this experiment?"
        body="Records this experiment as published in the curation store. It does NOT change visibility in Gemma — that is a Gemma write, which this app does not make."
        confirmLabel="publish"
        cancelLabel="cancel"
        destructive={false}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          setErrorMsg(null);
          publish.mutate(undefined, {
            onError: (err) => {
              // Prefer the typed ApiError.detail (FastAPI's
              // ``{detail: "..."}`` payload — usually the actionable
              // bit, e.g. "missing required field X" or "already
              // published"). Fall back to the message for other
              // error shapes.
              const detail =
                err instanceof ApiError ? err.detail || err.message
                : err instanceof Error ? err.message
                : String(err);
              setErrorMsg(detail || "publish failed");
            },
          });
        }}
      />
      {errorMsg ? (
        <button
          type="button"
          className="text-xs text-rose-700 underline-offset-2 hover:underline max-w-md truncate text-left"
          title={errorMsg + " — click to dismiss"}
          onClick={() => setErrorMsg(null)}
        >
          publish failed: {errorMsg}
        </button>
      ) : null}
    </>
  );
}
