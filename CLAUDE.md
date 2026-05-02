# CLAUDE.md — gemma-curation-ui

Meta orientation for the Claude instance working this repo. Pairs with the Python agent / API repo at `../gemma-curation-agents`, where a sibling Claude instance handles backend work. Coordinate via the per-feature handoff docs in this repo (`AUDIT_FEATURE.md`, `PROGRESS_SSE.md`, etc.) — schema or contract changes from the agent side land in the relevant handoff doc in the same commit.

## Cross-repo collaboration

- **Agent / API side** lives in `../gemma-curation-agents`. Pydantic models in `gemma_curation_agents/agents/audit/schemas.py` and `gemma_curation_agents/proposer_service.py` are the source of truth for wire shapes.
- **Mock curation API** runs from the agent repo (`./run_mock.sh`) on `:8080`. `dev-token-123` is the mock auth token.
- Don't edit Python in the sibling repo. Read it for context, file questions back as comments in the relevant handoff doc.
- If you need a new endpoint or field, write the request into the handoff doc — the sibling will implement.

## Current open handoff: audit-dispositions feedback loop

The agent side wants to harvest curator dispositions (accept / dismiss / needs_more_info) from the audit inbox to drive prompt-quality analysis. Today the disposition write path exists; what's missing is signal we can aggregate without overreacting to in-flight triage.

See [AUDIT_DISPOSITIONS.md](./AUDIT_DISPOSITIONS.md) for the spec. Summary of UI work the agent side needs:

1. **"Close audit" button** on the audit detail surface — the most important addition. Without it, every disposition is ambiguous (deliberate or half-finished?).
2. **Structured `dismiss_reason` chips** in the dismiss dialog (small enum; free-text `notes` stays optional).
3. **Snapshot finding shape** on the disposition row at PATCH time so longitudinal analysis survives prompt revisions.
4. **Capture accept-with-edit** when curators tweak the suggested fix before applying.
5. **Optional**: triage time (`first_seen_at` → `reviewed_at` delta).

All five additions are additive — no existing wire shape changes. See the handoff doc for endpoint shapes and rationale.

## Doc conventions in this repo

- `*_FEATURE.md` (`AUDIT_FEATURE.md`, etc.) — one file per cross-cutting feature; lives at repo root; updated in the same commit as the code that satisfies it.
- `PROGRESS_SSE.md` — long-running protocol-style doc.
- `SCALE.md` — performance / scale notes.
- This file (`CLAUDE.md`) — meta-orientation. Keep it short; link to handoff docs rather than inlining.

## When in doubt

- Schema mismatch between UI and agent? Read the Pydantic model in `../gemma-curation-agents/gemma_curation_agents/agents/audit/schemas.py`, not the TypeScript copy. The TS copies in `src/api/*.ts` lag.
- Mock data behaving oddly? `sqlite3 ../gemma-curation-agents/mock_curation.sqlite` and inspect directly.
- Agent-side question that needs more than a doc read? File it as a comment in the relevant handoff doc; the sibling Claude will pick it up next session.
