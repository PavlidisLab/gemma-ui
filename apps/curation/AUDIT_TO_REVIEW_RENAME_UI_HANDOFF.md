# Handoff — Proposal panel feature parity with Audit panel

> **Decisions locked 2026-05-24** (post cross-team review):
> - Wire `kind` is **lowercase** (`"audit"` / `"proposal"`).
> - `CurationReviewReport.kind` is a **required field** on the wire;
>   server hydrates from the DB column. Legacy payloads default to
>   `"audit"`.
> - Disposition routes live under
>   **`/curation-reviews/{review_id}/dispositions/...`**
>   (kind-agnostic prefix).
> - `EVALUATION` is reserved in the enum, not yet emitted.
> - `POST /audits` with `kind=proposal` body → 400 (and vice versa).
> - Legacy `ProposalSidebarPanel` stays visible on a separate
>   "Legacy proposals" tab during the transition; do NOT hide it.
> - New rich-proposal component name: `ProposalReviewSidebarPanel.tsx`.
> - New hook query key: `["curation-reviews", "proposal", experimentId]`.
> - Soak runs against staging local-api ONLY; production curators
>   keep the existing UI surface until Gemma 2.0 mirrors the shape.
> - `AuditReport` deprecated alias removal target: gemma-curation-agents 0.12.0.

**Filed:** 2026-05-24 (Paul + Claude, gemma-curation-agents-eval session).
**For:** UI side (`gemma-curation-ui/apps/curation`).
**Pairs with:**
- `gemma-curation-agents` local-api refactor (landing first; backend
  is shipping `kind` discriminator + new `/proposals` endpoint).
- `eclipseworkspace/Gemma/handoffs/AUDIT_TO_REVIEW_RENAME_HANDOFF.md`
  (the Gemma 2.0 backend mirror).

## Why

Today the UI has two panels for agent output:

- **Audit panel** (`features/audit/AuditSidebarPanel.tsx`) — reads
  `/datasets/{id}/audits`, renders rich per-finding chips,
  disposition flow, finalize step, side-by-side "agent vs curator"
  compare view.
- **Proposal panel** (`features/proposal/ProposalSidebarPanel.tsx`) —
  reads `/datasets/{id}/curation-proposals`, renders a thin proposal
  card from `agent_proposal.payload_json`. No per-finding chips, no
  dispositions, no finalize. Effectively a "raw JSON dump" view.

The two were designed for different inputs (audit = there's existing
curation to compare; proposal = there isn't), so the UX diverged.
But the **per-element review affordances** (accept / dismiss /
needs-more-info chips, calibration verdicts, finalize) are needed
in both. Today calibration packages run on uncurated GSEs are
routed through the Audit panel only because that's where the chip
flow lives — even though semantically they're proposals.

The backend is now giving proposals their own first-class storage +
endpoints with the same finding-set shape as audits. The UI side
needs a Proposal panel with the same affordances as the Audit
panel — minus the parts that only make sense for audits.

## Backend contract (changing in lockstep)

Local-api refactor (landing first):
- `audits` table renamed `curation_review` with a `kind` column
  (`'audit' | 'proposal'`).
- `audit_dispositions` renamed `curation_review_disposition`, FK
  is `review_id`.
- TypeScript types: `AuditReport` → `CurationReviewReport`
  (preferred) with `AuditReport` kept as a deprecated alias for
  one transition cycle. `CurationAudit` / `CurationProposal` are
  fine for parameter / variable naming when you want the kind to
  be explicit.
- `GET /rest/v2/datasets/{id}/audits` keeps existing shape;
  filters `kind='audit'` server-side.
- **New:** `GET /rest/v2/datasets/{id}/proposals` returns the
  same shape (an array of `CurationReviewReport`-shaped reviews)
  filtered to `kind='proposal'`.
- Disposition + finalize endpoints accept either kind
  transparently.

Gemma 2.0 backend will mirror this shape — handoff sibling in the
Java repo. UI work targets the local-api side first (faster to
iterate); the same client code talks to Gemma 2.0 unchanged once
the Java rename ships.

## What changes UI-side

### 1. New API client

Create `apps/curation/src/api/proposals.ts` mirroring `audits.ts`:

```typescript
// Wire shape is `CurationReviewReport` (alias of the previous
// `AuditReport` type for one transition cycle, removed in
// gemma-curation-agents 0.12.0). Every row carries `kind: "audit" |
// "proposal" | "evaluation"`; this endpoint returns kind="proposal"
// only.
import type { CurationReviewReport } from "./curationReviews";

export function useProposalsForExperiment(experimentId: number | string) {
  return useQuery({
    queryKey: ["curation-reviews", "proposal", experimentId],
    queryFn: async () => {
      const r = await fetch(
        `/rest/v2/datasets/${encodeURIComponent(String(experimentId))}/proposals`,
        { headers: authHeaders() },
      );
      if (!r.ok) throw new Error(`proposals fetch ${r.status}`);
      return (await r.json()) as CurationReviewReport[];
    },
    enabled: Boolean(experimentId),
  });
}
```

The disposition + finalize mutations from `audits.ts` move to the
kind-agnostic `/curation-reviews/{review_id}/dispositions/...`
routes. Add a new `apps/curation/src/api/curationReviews.ts`
carrying the shared `CurationReviewReport` type and the
disposition / finalize hooks; both `audits.ts` and `proposals.ts`
re-export from there. The old `/audits/{audit_id}/dispositions/...`
path is aliased server-side for one release cycle (see GB V2);
new code talks to `/curation-reviews/...` directly.

### 2. New Proposal panel

Create `features/proposal/ProposalReviewSidebarPanel.tsx` — a
clone of `features/audit/AuditSidebarPanel.tsx` with the following
deltas:

| Audit panel | Proposal panel |
|---|---|
| "Existing curation" side-by-side column | **Omit.** No curator-side data to render. The `evidence.comparison_proposal` field IS the agent's proposal; render it as the primary content, not as a compare-against column. |
| Finding framing: "agent says X, curator has Y" | "agent proposes X". The disposition chip semantics are the same (accept = agree with the proposal; dismiss = don't apply it). |
| Calibration verdict text | "Proposal review" (cosmetic; keep the same chip set otherwise). |
| Title: "Audit findings" | "Proposed curation". |

The chip flow, disposition reasons (`accept` / `dismiss` /
`needs_more_info` / `agent_real_miss` / `missed_evidence`),
finalize button, finalize-notes UX — **all the same**. Reuse the
existing components (`<FindingChipRow>`, `<DispositionPicker>`,
`<FinalizeBar>`).

### 3. Rename the existing thin "Proposal" panel

The current `features/proposal/ProposalSidebarPanel.tsx` reads
`/curation-proposals` (the `agent_proposal` legacy table — thin
`payload_json` blobs, no dispositions). It serves preboarding
proposals from the live proposer service, which today doesn't
produce the rich finding shape.

**Decision (post-review):** rename it `LegacyProposalSidebarPanel`
and surface it on a **separate "Legacy proposals" tab** in the
experiment detail page — do NOT hide by default. The new
Proposal panel takes the primary "Proposal" tab slot; the legacy
tab stays accessible until the AgentProposal retirement
follow-up ships (which migrates the live proposer service to
emit rich `CurationReview(kind='proposal')` rows and lets us
retire the legacy panel + endpoint together).

### 4. Experiment detail page

`features/experiment/ExperimentDetailPage.tsx` (or wherever the
tab strip lives):

- Keep the **Audit** tab — `useAuditsForExperiment` unchanged,
  feeds `AuditSidebarPanel`. Renders only for already-curated GSEs
  (i.e. when there are `kind='audit'` reviews — empty state
  otherwise).
- Add a **Proposal** tab — `useProposalsForExperiment`, feeds
  `ProposalReviewPanel`. Renders only when there are
  `kind='proposal'` reviews.
- Both tabs can be present simultaneously for an experiment that's
  been both proposed-on (calibration) and audited (post-curation).

On uncurated / preboarding GSEs, expect: Proposal tab populated,
Audit tab empty. On already-curated GSEs reviewed by the agent:
Audit tab populated, Proposal tab usually empty (unless someone
explicitly re-runs the proposer for retrospective scoring).

### 5. Calibration UX

The Proposal tab is what calibration packages now surface. The
calibration-batch progress view (`features/calibration/...`) was
keyed on audit IDs; it should be kind-agnostic now — the
backend's progress endpoint joins on review_dispositions
regardless of kind. Verify the progress aggregator pulls
`kind='proposal'` reviews for calibration batches.

### 6. Tests

The UI's component / integration tests for the Audit panel cover
the chip flow + disposition affordances. Snapshot / interaction
tests for the new Proposal panel should mirror them. Use the
same fixture data with the comparison-side fields blanked out
(or the comparison-proposal-only shape that calibration packages
emit).

## Out of scope

- Live proposer service writing rich reviews (see option (b)
  above). Defer.
- Backend Gemma 2.0 endpoint shape — UI work targets local-api
  first; same code talks to Gemma 2.0 once the Java mirror ships.
- Calibration package import — already changing on the
  agents-repo side to emit `proposal.json` and route through the
  new wire.

## Sequencing

1. Local-api PR lands (gemma-curation-agents). New endpoints live
   on staging.
2. UI work starts against staging local-api. Land Proposal panel
   + tab.
3. Soak with curators on calibration packages (Gen3 / Gen4).
4. Gemma 2.0 Java mirror ships once the shape is validated.

## Contact

Paul Pavlidis + Claude (gemma-curation-agents-eval session,
2026-05-24). Sibling handoff:
`eclipseworkspace/Gemma/handoffs/AUDIT_TO_REVIEW_RENAME_HANDOFF.md`.
