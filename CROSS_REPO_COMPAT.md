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
| v0.3.0 | v0.2.1 | Adds `agent_version` / `agent_min_ui` on `/health` (proposer + mock). Same wire shapes as v0.2.0; `MIN_AGENT_VERSION = "0.2.1"` once UI's CompatBanner ships. |
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

## Runtime version surface

**Agent side: shipped in 0.2.1.** `/health` on both the proposer
service and the mock curation API now returns:

```jsonc
{
  "status": "ok",
  "agent_version": "0.2.1",      // read from importlib.metadata
  "agent_min_ui":  "0.3.0",      // pinned to the UI release that
                                 // ships dismiss_reason chips —
                                 // older UIs 422 on dismissal
                                 // under the new validator
  // ... proposer adds in_flight / audit_in_flight / cache_dir
}
```

The agent's FastAPI `version=` constructor field also resolves from
the same source (no more stale-hardcoded "0.1.0").

**UI side: still to wire.** When the next UI release lands:

- Add a `MIN_AGENT_VERSION` constant in `src/api/version.ts`. Set
  to `"0.2.1"` (the version where `agent_version` first appears on
  `/health`; older agents return undefined which the banner can
  treat as "unknown — flag yellow").
- Startup `useHealth()` hook + `<CompatBanner />` component in the
  Shell (or LoginPage as a fall-through). Compares both directions:
  - UI version < `body.agent_min_ui` → banner: "this UI is older
    than the agent expects; some actions (dismissal) may 422".
  - `body.agent_version` < `MIN_AGENT_VERSION` → banner: "agent is
    older than this UI expects; some features may misbehave".
- README mention so deployers know to upgrade in pairs.

Don't refuse to load on mismatch — the banner is informational. Most
skews are non-fatal (additive wire changes); a deployer with a
one-version skew shouldn't be locked out.

## Process

When the UI ships a release that pairs with a new agent version:

1. Bump `package.json`.
2. Add a row to the matrix above.
3. Mention the agent version in the annotated tag message.
4. Update the README "Compatibility" section.

Same on the agent side, mutatis mutandis. The matrix should match
on both sides — if it doesn't, one of us forgot to update.
