# Audit UI: surface the factor-defender's verdict on each factor finding

Filed 2026-05-14. Companion to `AUDIT_DEFENDER_VERDICT_HANDOFF.md`
(the tag-side analogue, already shipped) and
`DESIGN_COMPARISON_HANDOFF.md`.

## Backstory

Tag-defender verdicts have surfaced in the audit UI since 2026-05-09
(commit 5b1f811). Factor-level findings (`calibration_factor_extra`,
`calibration_factor_gold_only_miss`) didn't carry a defender verdict
because no factor defender existed yet.

That gap closed 2026-05-14 in `gemma-curation-agents`:

1. `subtasks/factor_defender.py` — new LLM subtask with eight
   verdicts (four per side; see "Verdict enum" below).
2. `scripts/run_factor_defender_pass.py` — sibling of
   `run_defender_pass.py`. Reads `design_proposals.jsonl`, computes
   agent×agent crosstabs for the confounding signal, writes
   `factor_defenses.jsonl`.
3. `scripts/build_calibration_batch.py` — now consumes
   `factor_defenses.jsonl` (alongside `defenses.jsonl`) and attaches
   `AttachedDefenderVerdict` to both factor-side findings.
4. `DefenderVerdictRecord` schema migrated:
   `tag_category` / `tag_value` / `tag_uri` →
   `target_category` / `target_value` / `target_uri`, plus a new
   `target_kind: "tag" | "factor"` discriminator. Wire back-compat:
   the model validator accepts the legacy `tag_*` keys on input
   (snake or camelCase), so a UI that's still shipping pre-migration
   payloads continues to work.

## Wire shape (no change to the existing surface)

`AttachedDefenderVerdict` on the finding is exactly the same shape
as today:

```ts
interface AttachedDefenderVerdict {
  side: "agent_extra" | "agent_missed_gold";
  verdict: string;            // see verdict enum below
  strength?: "weak" | "moderate" | "strong";   // producer-side
  rationale: string;
  citation: string;
}
```

The `strength` field is **producer-side** for factor verdicts (the
backend's verdict-strength map was extended to cover all 8 factor
verdicts). UI can keep keying off `strength` and won't need a
fallback to a TypeScript `verdictStrength()` for factor strings.

## Verdict enum

### Extra side (`side === "agent_extra"`)

Cued action = "Add the agent-proposed factor to the curation."

| verdict | strength | meaning | curator action the verdict cues |
| --- | --- | --- | --- |
| `extra_genuine_new` | strong | Real, well-evidenced factor the curator missed. | Accept (Agree). |
| `extra_confounded` | weak | The factor's per-sample assignment is correct, but it co-varies 1:1 with another factor already in the design. The crosstab shows it. The curator deliberately collapsed the confound. | Dismiss (the agent's pick is real but redundant). |
| `extra_unsupported` | weak | Bookkeeping (batch, library prep), sample-applicability failure, or paper-speculation-only. | Dismiss. |
| `extra_borderline` | moderate | Defensible either way. | Curator's call. |

### Miss side (`side === "agent_missed_gold"`)

Cued action = "Remove the gold factor from the curation (agent's
omission is correct)."

| verdict | strength | meaning | curator action the verdict cues |
| --- | --- | --- | --- |
| `miss_genuine` | weak | Curator's factor is well-supported and the agent should have proposed it. | Override the dismiss — keep the gold factor. |
| `miss_inherited_from_design` | strong | Captured by the agent under another name / via a baseline-only contrast. | Accept the agent's omission. |
| `miss_overzealous_gold` | strong | Curator's factor isn't well-supported / is bookkeeping. | Accept the agent's omission. |
| `miss_borderline` | moderate | Defensible either way. | Curator's call. |

## UI work standing

### 1. `verdictStrength()` fallback for factor verdicts (cosmetic)

`src/features/audit/AuditSidebarPanel.tsx` defines a TypeScript
`verdictStrength()` that maps the original six tag verdicts to
strength. The fallback is `null` for unknown verdicts — so a
factor verdict with no producer-side `strength` would return `null`.

**This is non-load-bearing today** — the producer always emits
`strength` for factor verdicts post-2026-05-14. But: if older
packages get reprocessed, or if a curator ever pulls an older
calibration through a newer UI, the factor rows would lose their
strength chip. Defense in depth says extend `verdictStrength()`:

```ts
function verdictStrength(v: string | undefined) {
  switch (v) {
    // existing tag cases ...
    // factor cases (mirror of the table above):
    case "extra_genuine_new":
    case "miss_inherited_from_design":
    case "miss_overzealous_gold":
      return "strong";
    case "extra_confounded":
    case "extra_unsupported":
    case "miss_genuine":
      return "weak";
    case "extra_borderline":
    case "miss_borderline":
      return "moderate";
    default:
      return null;
  }
}
```

(Note `extra_genuine_new` is shared between tag and factor enums —
same meaning, same strength.)

### 2. `shortFixForVerdict()` factor-specific copy

`shortFixForVerdict()` provides curator-facing override text for
weak verdicts. The generic fallback (`"Override the suggestion —
judge: low confidence."`) is technically correct but reads weakly.
Per-verdict copy reads better:

```ts
function shortFixForVerdict(dv) {
  if (!dv) return null;
  const strength = dv.strength ?? verdictStrength(dv.verdict);
  if (strength !== "weak") return null;
  switch (dv.verdict) {
    // existing tag cases ...

    // factor side
    case "extra_confounded":
      return "Dismiss — judge: factor is confounded with another in the design.";
    case "extra_unsupported":
      return "Dismiss — judge: factor isn't well-evidenced.";
    case "miss_genuine":
      return "Keep the existing factor — judge: it's well-supported.";

    default:
      return "Override the suggestion — judge: low confidence.";
  }
}
```

`extra_unsupported` already has tag-side copy; the factor case can
share it without harm (same human reading either way).

### 3. `auditTypes.ts` verdict union (optional)

`AttachedDefenderVerdict.verdict` is typed as the original six tag
strings ∪ `(string & {})`. Forward-compat catchall — factor verdicts
already compile without TypeScript errors. Adding the eight factor
literals to the union is purely a docs/autocomplete improvement.

## What's NOT changing

- The `defender_verdict` field on `AuditFinding` — same shape, same
  field name, same optional behaviour. Older finding payloads with
  `defender_verdict = null` keep working.
- The 2026-05-09 policy shift (curators ARE shown defender verdicts
  during review) still applies; this is the same surface.
- The `DefenderVerdictRecord` ride-along (curator-blind storage) was
  renamed server-side but the UI never read it — no change.

## How to verify the wiring

1. Run a calibration batch with both tag + factor defenses
   captured:

   ```
   .venv/bin/python scripts/run_defender_pass.py --source-run <run>
   .venv/bin/python scripts/run_factor_defender_pass.py --source-run <run>
   .venv/bin/python scripts/build_calibration_batch.py --source-run <run> ...
   ```

2. Open a `calibration_factor_extra` finding in the UI. Without the
   patches above the verdict chip will render via the generic
   fallback (still functional; just generic copy). After the patches,
   per-verdict copy + strength chip should match the tables in
   "Verdict enum".

3. Smoke a `calibration_factor_gold_only_miss` finding too — those
   sometimes carry `miss_inherited_from_design`, which should
   render as a strong-strength "accept the agent's omission" cue.

## References

- Backend module: `gemma_curation_agents/agents/curation_proposer/subtasks/factor_defender.py`
- Backend runner: `scripts/run_factor_defender_pass.py`
- Backend builder consumer: `scripts/build_calibration_batch.py`
  (`_factor_defender_for` + `_build_defender_records`)
- Schema migration: `gemma_curation_agents/mock_gemma_curation_api/calibration_batch_schemas.py` `DefenderVerdictRecord`
- Verdict-strength map: `scripts/build_calibration_batch.py` `_VERDICT_STRENGTH` (single source of truth — keep the UI fallback in sync)
