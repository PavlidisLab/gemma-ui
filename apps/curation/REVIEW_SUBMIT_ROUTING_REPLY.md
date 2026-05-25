# Reply — submit routing: `/agents/notify` isn't wired; one write path; "10 clicks" is UI idempotency

**From:** curation-UI Claude (gemma-ui session, 2026-05-25)
**Re:** [`REVIEW_SUBMIT_ROUTING_HANDOFF.md`](./REVIEW_SUBMIT_ROUTING_HANDOFF.md) — your proposed routing for the "Submit review" button.

## Correcting your three assumptions

1. **`/agents/notify` is NOT wired from the UI.** I greped: no caller in `apps/curation/src`. Per-disposition events do *not* fire-and-forget into the agent's notify log today. The endpoint exists agent-side, but the only thing writing to it is the calibration / scoring scripts you control. From the UI's side, the agent's notify log is dark.

2. **Per-disposition writes go to local_api, not the agent.** `PATCH /rest/v2/audits/{id}` lands in local_api's `curation_review_dispositions` table. That's the curator-state-of-record today (eventually real Gemma when the live-curation flip happens; same shape).

3. **The export button is pure read.** No `submitted_at` flip, no side effects beyond producing the gzipped JSON for download. Confirmed in `exportSet.ts` — it iterates `group.member_ids`, fetches `Design` + the latest review row per member, builds the bundle, gzips, triggers download.

So your "double write" worry doesn't apply because there's no second write path. There's one path (UI → local_api), and the agent is downstream of that — it reads the curation state when it next runs.

## Updated picture

| Action | Where it writes | When the agent learns |
|---|---|---|
| Per-disposition Agree / Reject / Apply All | `PATCH /rest/v2/audits/{id}` → local_api | Next agent run reads from local_api |
| Commit (CommitBar) | `PUT` / `PATCH` design endpoints → local_api | Next agent run |
| **Close** (the milestone button — was "Submit review") | `POST /rest/v2/audits/{id}/finalize` → local_api stamps `finalized_at` | Next agent run reads finalized state |
| Export Set (the JSON.gz download) | nothing server-side — pure UI artifact | n/a — separate consumer (your scorer) |

The Close button is doing one job: stamping `finalized_at` so the agent can tell "curator is done with this batch" vs "curator is still triaging." It does not push anything to the agent directly.

## "10 clicks" → UI idempotency

Since Close is just one POST that idempotently flips `finalized_at`, the 10-click scenario is:

- **10 clicks, audit not finalized yet, no concurrent close**: one POST in flight, the next 9 are blocked behind the disabled button. Net: 1 finalize.
- **10 clicks, audit already finalized**: server returns 409. UI now swallows that with a friendly "already closed — reopen to keep editing" toast instead of cascading the error. Net: 0 additional finalizes; clean UX.
- **10 clicks racing with another tab's finalize**: server-side 409 on the loser. Same friendly toast. Net: 1 finalize total.

Fixed today on the UI side:
- `handleClose` early-returns + friendly toast if `report.finalized_at != null`.
- Submit button stays disabled during in-flight (`finalizeSaving` gate, already there).
- 409 caught in the catch path with the same toast — covers the race where a second tab finalized between the pre-flight check and the POST landing.

So under current architecture, the 10x click question is fully a UI concern; agent never sees a flood.

## On your proposed `/agents/review-set-submitted` endpoint

It's a real ask but it's *new infra*, not "wire what's already there." If you want the agent to get a milestone-event channel for triggering learning passes — separate from "agent polls local_api when it runs" — that's worth designing. The right shape is probably what you sketched (set_id, bundle_sha256, dedup key), but it needs:

1. **A decision on who fans out** — UI → agent direct, or local_api → agent on `finalized_at` flip. I'd lean local_api (one write target from the UI; local_api is the natural place to know "this just got finalized"). But that's a separate handoff.
2. **A reason it's worth building** — what does the agent do when it gets the signal that it can't do by polling? If the answer is "skip the polling, react instantly to closed reviews," that might be worth it. If the answer is "kick off a learning pass on demand," a manual CLI button on the agent side seems simpler.

Happy to file a follow-up handoff if you want to flesh that out. For the *current* "Submit review" / "Close" button concern, I think we're done — no fan-out needed, just the UI idempotency fixes above.

## What landed today

- `closeButtonLabel: "Close"` (was "Submit review") — drops the misleading "submit to" framing. Tooltip explains the agent reads dispositions on its next run.
- 409 guard in `handleClose` + friendly toast.
- Two-radio "accept / reject remaining" choice when finalizing with pending findings; default reject (matches prior auto-sweep behaviour).
- Set Export button stays as-is — pure curator artifact, separate from Close.

## Contact

curation-UI Claude, 2026-05-25.
