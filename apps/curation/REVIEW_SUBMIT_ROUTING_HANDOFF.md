# Handoff — "Submit Review" routing: should it hit the agent, Gemma, or both?

**From:** eval-side Claude (gemma-curation-agents-eval session, 2026-05-25)
**Re:** Follow-up to [`REVIEW_EXPORT_BUNDLE_HANDOFF.md`](./REVIEW_EXPORT_BUNDLE_HANDOFF.md) — the same "Export Set" button uib shipped is presumably what curators will click to declare a batch "submitted."
**Open question** from Paul: *"is the agent getting hits when the curation-ui has a 'submit review' — and what happens if they do that 10 times? with or without changes? should that come to you or to gemma-REST?"*

This handoff lays out my read of the current flow and a proposed routing. Asking uib for the contract they'd want from the agent side, then I'll match.

## What I'm pretty sure of

- **Per-finding dispositions already flow to the agent in real time.** The proposer service has `/agents/notify` (per the docstring at `gemma_curation_agents/proposer_service.py:343-345`: *"Where /agents/notify persists incoming curator-disposition events. JSONL, append-only, single shared file under the cache dir. The learning-pass / prompt-tuning consumer reads from here."*). Each accept/reject is fire-and-forget into the append log. So the agent doesn't need "submit review" to learn what the curator decided — that signal is already arriving event-by-event.
- **"Submit review" today is just a download.** The button you shipped is a UI-only bundling action — queries the local-api, produces the gzipped JSON, downloads. No write-back to the agent. No "submission state" stamped anywhere.
- **Gemma REST is the system of record for curator state** (per-disposition state, finalized reviews, polished gold). The agent's `/agents/notify` log is a side-channel for learning, not authoritative.

## What I'm assuming (please confirm/correct)

1. **Is the UI actually calling `/agents/notify` on every disposition click?** The endpoint exists agent-side. Whether the UI is wired to it is something I'd grep but figured I'd ask first.
2. **Is the export button a pure read today?** I'm assuming no `submitted_at` / `finalized_by_curator_at` is written anywhere on click — but tell me if there's already a side effect.
3. **What does the agent's notify-log consumer do today?** If it acts on every event as it arrives, a milestone signal is redundant. If it's batch-triggered manually, a milestone signal is the natural trigger.

## Three distinct semantics that "Submit" could carry

Easy to conflate, so naming them:

1. **"Give me a file"** — pure curator-side artifact. *What it does today.*
2. **"Batch is done — no more changes expected"** — a milestone signal. Useful to the agent because it knows *when* to run a learning pass / cross-experiment analysis rather than firing on every event.
3. **"Sync my current state authoritatively"** — like a save button. Only useful if the per-disposition stream is unreliable (it shouldn't be).

(3) is a smell — implies the event stream is lossy. Skip it. (1) is the current state. (2) is the missing piece.

## 10 consecutive clicks — desired idempotency

| Scenario | What's right | Current behaviour (per my assumptions) |
|---|---|---|
| 10 submits, **no changes between** | Idempotent — same bundle, no server state change | ✅ matches (just 10 identical downloads) |
| 10 submits, **changes between** | Each is a legitimate new snapshot; agent should see them as a versioned series | ⚠️ agent never receives the bundle; only the per-disposition firehose, which it's already getting anyway |

The "10 submits" question only becomes interesting if submit *itself* carries a signal beyond the per-event stream the agent already has.

## Proposed routing

- **Per-disposition events** → keep flowing to `/agents/notify` as they happen (already does, per my assumption). Real-time learning input. Idempotent at the row level via `(review_id, target_id, status, reviewer)` key.
- **Submit-Review bulk action** → two small effects:
  - **To Gemma (system of record):** `PATCH /curation-reviews/{id}` or a `/calibration-batches/{id}/finalize` flips a `submitted_at` timestamp. The set's milestone state lives where curator state already lives.
  - **To agent (learning trigger):** lightweight `POST /agents/review-set-submitted` carrying `{set_id, exported_at, bundle_sha256, download_url}` — **no full bundle**, just a pointer. Agent dedups by `bundle_sha256` (10 identical clicks → 1 stored event; a new event only when content actually changed). If the agent wants the polished gold it pulls via the bundle URL.
- **The download** → keep as a side effect of submit for the human curator. It's a curator-facing artifact, not the machine handoff.

Net effect on 10x clicks under this routing:

- **Gemma:** 1 row updated (idempotent `submitted_at` flip) — or 10 entries in an append-only `submission_log` if you want history (cheap).
- **Agent:** 1 stored event (dedup by bundle hash), 9 ignored. New stored event only when content changed.
- **Local disk:** 10 download files (the only "spam" is on the curator's machine).

## What I'd want from uib

If the routing above looks roughly right, the contract I'd implement agent-side is:

```http
POST /agents/review-set-submitted
{
  "set_id": "92078d80-...",
  "exported_at": "2026-05-25T14:19:33Z",
  "bundle_sha256": "<hex>",
  "bundle_url": "https://.../gemma-set-0066-...json.gz" | null,
  "curator": "amaximo-ubc",
  "submitted_via": "ui_button"        // distinguish from CLI-driven submits
}
→ 200 {"stored": true,  "duplicate": false}
→ 200 {"stored": false, "duplicate": true,  "first_seen_at": "..."}
```

Three things from your side that would unblock this:

1. **Confirm or correct my three assumptions above** (notify wiring, side effects of the current button, what the notify consumer does today).
2. **Sketch what the click actually does today** in `apps/curation/src/features/workflow/exportSet.ts` — does it write anywhere besides the download, or is it strictly a download generator?
3. **Tell me whether you'd rather POST the bundle pointer to the agent from the UI directly, or have Gemma fan out** to the agent when `submitted_at` flips. Either is fine; preference depends on how you want to handle the local-mode case where Gemma may not be reachable.

If the proposed routing is wrong-headed, push back — happy to redo. Mostly trying to make sure we don't quietly grow a "submit = mail-merge-to-three-systems" footgun.

## Contact

eval-side Claude, 2026-05-25.
