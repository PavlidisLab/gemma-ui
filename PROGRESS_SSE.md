# Progress streaming for `/propose` (SSE)

The agent server (`gemma-curation-agents`, `proposer_service.py`)
exposes a Server-Sent Events variant of the propose endpoint:

```
POST /propose/{accession}/stream
```

Same JSON request body as the existing `POST /propose/{accession}`.
Response is `Content-Type: text/event-stream`. Each `data:` line
carries one structured `ProgressEvent` JSON blob. The stream closes
after a terminal event (`stream.result` on success, `error.terminal`
on failure).

Cancellation is **not implemented** in this iteration — the field is
reserved server-side but ignored. If the client closes the connection
mid-run the worker keeps going and the next call for the same
accession will 409 until it finishes.

---

## ProgressEvent shape

```ts
type Level = "debug" | "info" | "warn" | "error";

interface ProgressEvent {
  schema_version: 1;          // bump on breaking changes; reject higher
  run_id: string;             // uuid4; stable across the run's events
  timestamp: string;          // ISO8601 UTC
  event: string;              // dotted machine name, see taxonomy below
  level: Level;               // log styling hint
  message: string;            // one-line human readable, render verbatim
  progress: number;           // 0.0–1.0, monotonic non-decreasing
  payload: Record<string, unknown>;
                              // event-specific structured fields
}
```

**The progress field is monotonic non-decreasing.** Events between
phase milestones (the `subtask.*` events) carry the previous phase's
progress unchanged — the bar holds while log lines stream. The UI
should defensively clamp with `Math.max(prev, ev.progress)` in case
events ever arrive out of order.

---

## Event taxonomy

Events fall into three groups:

* **`phase.*`** — pipeline milestones; advance the progress bar.
* **`subtask.*`** — per-factor / per-decision events; carry the current
  phase's progress unchanged. Useful for log feed; ignored by a
  progress-bar-only consumer.
* **`stream.*` / `error.*`** — stream lifecycle events synthesised by
  the SSE endpoint itself, not the pipeline.

### Phase events (drive progress bar)

| event                          | progress | level | sample message                                                | payload keys |
|--------------------------------|----------|-------|---------------------------------------------------------------|--------------|
| `phase.run.started`            | 0.00     | info  | `Run started for GSE12654`                                    | `accession, tag_model, design_model` |
| `phase.skeleton.fetching`      | 0.02     | debug | `Fetching skeleton…`                                          | — |
| `phase.skeleton.fetched`       | 0.08     | info  | `Skeleton: 50 samples, 50 BMs`                                | `n_samples, n_biomaterials, n_pubs` |
| `phase.cache.hit`              | 0.95     | info  | `Cache hit at GSE12654__sonnet.json — submitting cached…`     | `cache_path` |
| `phase.cache.miss`             | 0.10     | debug | `Cache miss — fresh run`                                      | `cache_path` |
| `phase.biolit.fetching`        | 0.10     | debug | `Fetching paper context via biolit…`                          | — |
| `phase.biolit.fetched`         | 0.15     | info  | `Paper context: PubMed:12345 (3,200 chars)`                   | `source, excerpt_len` |
| `phase.design.proposing`       | 0.30     | info  | `Design proposer running…`                                    | — |
| `phase.design.completed`       | 0.55     | info  | `Design: 3 factor(s) — genotype, treatment, …`                | `n_factors, categories` |
| `phase.validators.completed`   | 0.72     | info  | `Validators: 2 warning(s), 0 predicate strip(s)`              | `n_warnings, n_predicate_strips` |
| `phase.tags.proposing`         | 0.75     | info  | `Tag proposer running…`                                       | — |
| `phase.tags.completed`         | 0.88     | info  | `Tags: 5 proposed — disease: …, organism part: …, …`          | `n_tags` |
| `phase.submitting`             | 0.95–0.97| debug | `Submitting proposal to curation API…`                        | `target?` |
| `phase.completed`              | 1.00     | info  | `Run completed (proposal_id=42, 3 factors, 5 tags)`           | `proposal_id, n_factors, n_tags, skipped, skip_reason, cached?` |

### Subtask events (log-only; progress carried)

| event                         | level (default) | sample message                                                  | payload keys |
|-------------------------------|-----------------|-----------------------------------------------------------------|--------------|
| `subtask.s1.completed`        | info            | `S1: should_split=False`                                        | `proceed_with_design, skip_reason, subset_verdict` |
| `subtask.s1.errored`          | warn            | `S1 errored: ConnectionTimeout: …`                              | `error` |
| `subtask.s3.completed`        | info            | `S3: 4 candidate factor(s) — genotype, treatment, …`            | `n_candidates, categories` |
| `subtask.assignment.factor`   | info            | `Assigned 12/12 samples to factor "genotype"`                   | `factor, n_assigned, n_total` |
| `subtask.s7.evaluated`        | info / **warn** | `S7: 0/50 samples assigned (0%) — proposer found no per-sample mapping…` | `factor, tier, n_assigned, n_total` |
| `subtask.s10.completed`       | warn            | `S10: 3 term issue(s) flagged`                                  | `n_invalid_terms` |

`subtask.s7.evaluated` flips `level` to `warn` whenever
`payload.tier === "zero"` — that's the structured signal the eval
harness reads, and the UI should red-style the log line accordingly.

### Stream lifecycle events (synthesised by the SSE endpoint)

| event              | level | when                                              | payload keys |
|--------------------|-------|---------------------------------------------------|--------------|
| `stream.opened`    | debug | First event of every stream                       | `accession` |
| `stream.result`    | info  | Final event on success; carries the full Proposal | `proposal` (full Proposal JSON, same shape as the non-stream endpoint's response) |
| `error.terminal`   | error | Final event on failure                            | `type, error` |

**`stream.result` is the closing event on success** — the UI should
treat its `payload.proposal` as the canonical result and not re-call
the non-streaming endpoint.

---

## Reference React/TS client

The browser's `EventSource` doesn't support POST, so we open the
stream with `fetch` + a manual `ReadableStream` reader. ~40 lines:

```ts
import { useEffect, useState } from "react";

export type Level = "debug" | "info" | "warn" | "error";
export interface ProgressEvent {
  schema_version: 1;
  run_id: string;
  timestamp: string;
  event: string;
  level: Level;
  message: string;
  progress: number;
  payload: Record<string, unknown>;
}

interface UseProposeStreamOpts {
  accession: string;
  body?: Record<string, unknown>;
  baseUrl?: string;
}

export function useProposeStream({ accession, body, baseUrl = "" }: UseProposeStreamOpts) {
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [progress, setProgress] = useState(0);
  const [proposal, setProposal] = useState<unknown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");

  useEffect(() => {
    const ctl = new AbortController();
    setStatus("running");

    (async () => {
      const resp = await fetch(`${baseUrl}/propose/${accession}/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
        signal: ctl.signal,
      });
      if (!resp.ok || !resp.body) {
        setError(`HTTP ${resp.status}: ${await resp.text()}`);
        setStatus("error");
        return;
      }
      const reader = resp.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        // SSE events are separated by "\n\n".
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of block.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const ev = JSON.parse(line.slice(5).trim()) as ProgressEvent;
            setEvents((prev) => [...prev, ev]);
            setProgress((prev) => Math.max(prev, ev.progress));
            if (ev.event === "stream.result") {
              setProposal((ev.payload as { proposal: unknown }).proposal);
              setStatus("done");
            } else if (ev.event === "error.terminal") {
              setError(ev.message);
              setStatus("error");
            }
          }
        }
      }
    })().catch((e) => {
      if (ctl.signal.aborted) return;
      setError(String(e));
      setStatus("error");
    });

    return () => ctl.abort();
  }, [accession, JSON.stringify(body), baseUrl]);

  return { events, progress, proposal, error, status };
}
```

Render hint:

```tsx
const { events, progress, proposal, status, error } = useProposeStream({ accession });

return (
  <>
    <progress value={progress} max={1} />
    <ul className="font-mono text-xs">
      {events.map((ev, i) => (
        <li key={i} className={cn(
          ev.level === "warn" && "text-amber-600",
          ev.level === "error" && "text-red-600",
          ev.level === "debug" && "text-slate-400",
        )}>
          [{ev.level}] {ev.message}
        </li>
      ))}
    </ul>
    {status === "done" && proposal && <ProposalCard proposal={proposal} />}
    {error && <div className="text-red-600">{error}</div>}
  </>
);
```

---

## Notes on robustness

* **Reconnection is not supported.** If the network drops mid-stream
  the run keeps going server-side but the client has no way to
  reattach. Re-POST to start over (the new run will get a cache hit
  on identical inputs and complete instantly).
* **Out-of-order events.** Don't rely on event ordering for
  correctness — clamp progress with `Math.max(prev, ev.progress)` and
  drive UI state from the structured `payload`, not the message.
* **Schema versioning.** Reject events with `schema_version > 1`
  (server bump signals a breaking change). New event names within
  schema 1 are backwards-compatible — the UI can ignore unknown event
  names without versioning concerns.
* **CORS / dev proxy.** Vite's proxy fronts the agent server at the
  same origin, so no CORS layer is needed. Production deployment
  ships nginx + bearer auth; same-origin still holds.

---

## Server reference

* Endpoint definition: `proposer_service.py:propose_stream` in
  `gemma-curation-agents`.
* Event source of truth: `pipeline.py:propose_curation` — every
  `_emit(ctx, …)` call site corresponds to one row in the taxonomy
  above. Search the file for `_emit(ctx,` to enumerate.
* `RunContext` shape: `pipeline.py:RunContext`. The `cancel_event`
  field is currently a stub.
