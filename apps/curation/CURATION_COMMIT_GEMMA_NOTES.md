# Commit-to-Gemma + ontology-grounding gate — UI prep notes

**Status: ON HOLD (2026-07-18).** The Gemma server gate is LANDED + verified live
on frink; the UI build is deliberately deferred until the *commit-to-Gemma UX* is
scoped (there is no commit trigger in the UI today — see below). This file
captures the verified wire shapes as fixtures-in-waiting so the build, when it
happens, targets reality and not prose.

Contract: `~/Dev/Gemma/handoffs/ONTOLOGY_TERM_VALIDATION_HARD_REJECT_CONTRACT_2026_07_13.md`
+ the two follow-up handoffs (`..._LIVE_TEST_FOLLOWUPS_2026_07_18.md` and its
`..._RESPONSE_2026_07_18.md`). Memory: `reference_gemma_ontology_term_validation_400_contract`.

## Endpoints (Gemma REST, `phase2-acl-migrate`, live on frink)

- `PUT  /rest/v2/datasets/{dataset}/curation`            — real commit, all-or-none.
- `POST /rest/v2/datasets/{dataset}/curation/preflight`  — dry-run, **writes nothing**, same body + same validation.
- Body = `CurationDocument`: sections `basics`, `publications`, `design`
  (factors→factorValues→statements + per-sample assignments + baseline flags +
  split advice), `tags`, `sampleCharacteristics`, `curationDetails` (curationNote
  only). New entities carry a `clientRef` (echoed as `clientRef→newGemmaId` in the
  report `idMap`); deletions via each section's `deletedIds`.
- Optimistic concurrency: `baseline.lastModified` (the dataset `lastUpdated` the
  draft was built against) → **409** if stale. Omit baseline → no check.
- Commit needs `ACL_SECURABLE_EDIT` (shortName change → admin). **Grounding
  validation throws BEFORE the permission-gated service commit**, so a hallucinated
  term 400s even without edit rights; preflight on a public dataset is safe to run.

## The grounding gate (what the UI must handle)

Every URI-bearing slot on NEW/CHANGED items only (carry-forward-by-gemmaId not
re-checked). Slots — tag / sampleCharacteristic: `category`, `value`; statement:
`category`, `subject`, `predicate`, `object`, `secondObject`. Resolves Gemma's
ontologies first, OLS fallback. Free text (no `uri`) always allowed.

- **400 reject**, short reason codes (branch on these): `URI_UNRESOLVED` (fabricated /
  resolves nowhere), `LABEL_MISMATCH` (URI resolves, label ≠ term's label),
  `UNVERIFIED_OLS_UNAVAILABLE` (OLS down, fail-closed). All offending slots
  collected at once. Each `errors[]` entry: `reason`, `message`, `location`
  (path + `clientRef=…`), `locationType:"BODY"`.
- **200 + `canonicalizations[]`** when a term was accepted-and-rewritten
  (case/whitespace-only label near-match, OR a wrong-base TGEMO id normalized).
  Per entry: `{location, clientRef, submittedLabel, canonicalLabel, submittedUri,
  canonicalUri}`. Only tags + sampleCharacteristics emit these (design gate is
  rejection-only). `submittedLabel` null when a URI arrived label-less.
- TGEMO wrong-base ids are rescued server-side (normalized onto `gemma.msl.ubc.ca/ont/`
  before resolution) — but the UI should still send canonical (`curieToUrl`) URIs;
  the server normalization is a backstop, not a licence to send OBO-base TGEMO.

## UI obligations (build when the commit trigger lands)

1. On a 400 from commit/preflight, surface each `errors[]` against its chip via
   `location`/`clientRef`.
2. `LABEL_MISMATCH` → offer the canonical label (parse it from `message` — it's the
   quoted "resolves to …" term; the server does NOT name a correct URI) as a
   one-click fix.
3. On `canonicalizations[]`, silently update the chip's label→`canonicalLabel`
   (and URI→`canonicalUri` when they differ); no error styling.

The CuriePopover "Gemma doesn't know this term" cue (`useGemmaTerm` 404) is already
live and is the pre-commit client-side warning for the same unresolved condition —
keep it.

## Verified fixtures-in-waiting (captured live off frink, GSE84876 preflight)

Lift these into `src/api/__fixtures__/` when the build starts; assert the parser
against them.

`400` — `ResponseErrorObject` (apiVersion + buildInfo omitted here; they wrap every response):
```json
{"error":{"code":400,"message":"1 ontology term(s) failed grounding validation.","errors":[{"reason":"LABEL_MISMATCH","message":"value URI http://gemma.msl.ubc.ca/ont/TGEMO_00166 resolves to \"delivered at dose\", not the submitted label \"has_genotype\"","location":"tags[clientRef=t7].value","locationType":"BODY"}]}}
```
```json
{"error":{"code":400,"message":"1 ontology term(s) failed grounding validation.","errors":[{"reason":"URI_UNRESOLVED","message":"value URI http://gemma.msl.ubc.ca/ont/TGEMO_99999 (label \"Heterozygous\") resolves in neither Gemma nor OLS; the term is not grounded","location":"tags[clientRef=t7].value","locationType":"BODY"}]}}
```

`200` — `ResponseDataObject<CurationCommitReport>`:
```json
{"data":{"applied":false,"idMap":{},"changes":{"tags":{"created":1,"updated":0,"deleted":0,"unchanged":0}},"auditEventIds":[],"canonicalizations":[{"location":"tags[clientRef=t7].value","clientRef":"t7","submittedLabel":"Delivered At Dose","canonicalLabel":"delivered at dose","submittedUri":"http://gemma.msl.ubc.ca/ont/TGEMO_00166","canonicalUri":"http://gemma.msl.ubc.ca/ont/TGEMO_00166"}],"error":""}}
```
base-normalization variant — `submittedUri` ≠ `canonicalUri`:
```json
{"data":{"applied":false,"idMap":{},"changes":{"tags":{"created":1,"updated":0,"deleted":0,"unchanged":0}},"auditEventIds":[],"canonicalizations":[{"location":"tags[clientRef=t7].value","clientRef":"t7","submittedLabel":"delivered at dose","canonicalLabel":"delivered at dose","submittedUri":"http://purl.obolibrary.org/obo/TGEMO_00166","canonicalUri":"http://gemma.msl.ubc.ca/ont/TGEMO_00166"}],"error":""}}
```
clean pass (exact match, nothing rewritten) — `canonicalizations` absent:
```json
{"data":{"applied":false,"idMap":{},"changes":{"tags":{"created":1,"updated":0,"deleted":0,"unchanged":0}},"auditEventIds":[],"error":""}}
```

## Where a commit trigger would live (open — decide before building)

Today the UI writes only to the local curation store (`:8095`, `applyDraft`).
There is no path that PUTs a `CurationDocument` to Gemma. Open product questions
before wiring any of the above:
- **What action commits?** A curator "Publish / Commit to Gemma" button? An
  automatic write on some workflow-stage transition? Remote-mode only?
- **Preflight-first UX?** Run `preflight` on the draft and show the diff
  (`changes` counts + any 400 per-chip) before the real `PUT`. The report is built
  for this (`applied:false`).
- **Draft → CurationDocument mapping** (the real request-side work): compose from
  `useDesignDraft()` (factors/FVs/statements/tags/sampleCharacteristics), assign
  `clientRef`s to new entities, thread `deletedIds`, capture `baseline.lastModified`
  from the loaded dataset. This is where design-draft internals couple in — do it
  once the trigger + UX are settled, to avoid building parallel to spec.
