# Cross-repo compatibility — gemma-curation-ui ↔ gemma-curation-agents

This UI is one half of a two-repo system. The other half is
[`gemma-curation-agents`](https://github.com/PavlidisLab/gemma-curation-agents)
— Pydantic models, mock REST API, agent service, audit pipeline.
The UI is a separate process that talks to the agent service over
HTTP / SSE; there's no build-time dependency between the two
codebases.

What couples them is the **wire contract** — the REST shapes, SSE
event taxonomy, and persisted schema. When my brother (the
agent-side Claude) ships a wire change, the matching UI version
follows; the **compatibility matrix** below pins which versions
were tested together so deployers can pair them.

## Compatibility matrix

| UI version | Tested against agent version | Notes |
|---|---|---|
| v0.3.0 | v0.2.0 | Audit feature surfaces A/B/C, dispositions feedback loop, samples overhaul, atomic revert. Requires agent endpoints `POST /audit/{accession}` + `/stream`, `POST /rest/v2/audits/{id}/finalize` + `/reopen`, snapshot columns on `audit_dispositions` table. |
| v0.2.0 | v0.1.0 | View persistence + modal Esc + banner cleanup. Pre-audit. |
| v0.1.0 | v0.1.0 | Initial release. |

When a row is added: bump version on whichever side ships the wire
change first; the other side's next release lists the new pair.
Older agent / UI versions usually still work for any non-touched
surface — the wire is mostly additive — but the matrix documents
what's been **verified** to work end-to-end.

## Cross-repo wire-contract surfaces

What the UI consumes from the agent (and so what counts as a
breaking change):

- **REST endpoints under `/rest/v2/...`** — the mock curation API.
  Read paths drive every panel in the UI; write paths drive
  CommitBar, dispositions, audits.
- **REST endpoints under `/propose/...` and `/audit/...`** — the
  agent service (proposer + audit pipeline). Synchronous +
  SSE-stream variants both used.
- **Pydantic models** in `agents/audit/schemas.py`,
  `agents/proposer/schemas.py`, etc. — TS mirrors live in
  `src/api/*.ts`. Lag is normal; canonical shape is Python.
- **SSE event taxonomy** — see `PROGRESS_SSE.md`. UI parses
  `schema_version` + `event` + `payload`.
- **`target_id` slug format** — `agents/audit/target_ids.py` is
  canonical; UI mirror at `src/features/audit/targetIds.ts`.
  Divergence breaks inline severity dots silently.
- **SQLite tables** the mock owns (`audits`, `audit_dispositions`,
  `audit_events`, etc.) — the UI never touches them directly but
  they shape what the read endpoints can return, so additive-only.

Per-feature handoff docs at the repo root carry the detailed
contract for whatever's in flight: `AUDIT_FEATURE.md`,
`AUDIT_DISPOSITIONS.md`, `PROGRESS_SSE.md`. When my brother changes
a field, the doc updates first; the UI follows.

## Runtime version surface — open ask for the agent side

Today there's no programmatic way for the UI to confirm it's
talking to a compatible agent. `/health` returns
`{ status, max_concurrency, active_slots, in_flight,
audit_in_flight, cache_dir }` — no version. FastAPI's app `version`
field is hard-coded to "0.1.0" and stale.

What the UI would do with a version field on `/health`:

- Read `agent_version` and `agent_min_ui` on app startup.
- If the running UI version is below `agent_min_ui` OR the agent
  version is below the UI's hard-coded `MIN_AGENT_VERSION`, surface
  a yellow banner: "Agent vX.Y.Z; this UI vA.B.C expects ≥ vP.Q.R.
  Some features may misbehave."
- Don't refuse to load — the banner is informational. Most
  mismatches are non-fatal (additive wire changes), and a deployer
  with a one-version skew shouldn't be locked out.

The ask for my brother:

```python
# In proposer_service.py /health
return {
    "status": "ok",
    "agent_version": "0.2.0",          # NEW — read from package metadata
    "agent_min_ui": "0.3.0",           # NEW — minimum UI version this
                                       # agent expects (UI versions older
                                       # than this may hit removed
                                       # endpoints / shapes)
    "max_concurrency": max_concurrency,
    "active_slots": ...,
    "in_flight": [...],
    "audit_in_flight": [...],
    "cache_dir": ...,
}
```

When this lands, the UI side adds:

- A `MIN_AGENT_VERSION` constant in `src/api/version.ts`.
- A startup `useHealth()` hook + a `<CompatBanner />` component in
  the Shell (or the LoginPage as a fall-through).
- A short README mention so deployers know to upgrade in pairs.

Tracked in this doc until shipped on either side.

## Process

When the UI ships a release that pairs with a new agent version:

1. Bump `package.json`.
2. Add a row to the matrix above.
3. Mention the agent version in the annotated tag message.
4. Update the README "Compatibility" section.

Same on the agent side, mutatis mutandis. The matrix should match
on both sides — if it doesn't, one of us forgot to update.
