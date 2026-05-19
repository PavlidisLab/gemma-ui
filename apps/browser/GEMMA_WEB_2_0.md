# Gemma Web 2.0 — frontend alignment brief

Filed 2026-05-19. Branch: `feat/gemma-web-2.0` in `gemma-ui`.

## What "Gemma 2.0" means for the frontend

The backend (`~/Dev/eclipseworkspace/Gemma`, branch `phase2-acl-migrate`) has
completed Phase 2: Spring 6, Hibernate 6, Jersey 3, Jakarta namespaces.
It's at version `1.32.7-SNAPSHOT` heading for `2.0.0`. Gate 3 (merge to
`development`) requires a clean `mvn verify` against gemdtest. The REST API
**stays at `/rest/v2/`** — no URL change. Changes are mostly additive.

The UI renovation goals from `RENOVATIONS.md` §Frontend:
> One app going forward. Built on the curation-ui (React + TS) foundation.
> Home page → Browser → Experiment pages.

The `apps/browser/` workspace is already that foundation. The `apps/curation/`
workspace is the curator-workflow layer that sits on top of the same shell.

## Repos and their dev modes

| Repo | Dev target | Port | Must stay working |
|---|---|---|---|
| `apps/browser/` (this app) | `GEMMA_BASE_URL` (staging by default) | 5183 | Yes — prod proxy |
| `apps/curation/` | mock server (`run_mock.sh`) | 8080 (mock REST) | **Yes — mock must not break** |
| Proposer / audit agents | `run_mock.sh` + proposer service | 8090 (proposer) | Yes — offline curation |

**Port conflict rule**: if you run the Gemma 2.0 Java server locally for
browser development, set its Tomcat port to **9080** (not 8080) so it
doesn't collide with the curation mock. Override via:
```sh
GEMMA_BASE_URL=http://localhost:9080 npm run dev:browser
```
The curation app's proxy is never touched.

## Mock system — preservation contract

The curation app (`apps/curation/vite.config.ts`) proxies:
- `/rest` → `http://localhost:8080` (mock REST, `dev-token-123`)
- `/propose|/audit|/find-publication|/find-term` → `http://localhost:8090` (proposer)

**Do not change these.** The mock is the primary dev environment for
curation work and offline testing. All new curation features must continue
to work against the mock before requiring a real Gemma 2.0 server.

## Work items — browser app (`apps/browser/`)

### P0 — needs a decision (block on Paul)

- **Home page variant** — 14 variants exist. Paul likes Bloom, Cosmos,
  Tidepool, Brutalist-v2. Need to pick one as the shipping default. The
  `?v=<key>` + localStorage switcher lets Paul flip between them at
  `http://localhost:5183/`. Decision gates the "base website" ship.

### P1 — Gemma 2.0 API alignment

- **`q=` search param** — Issue #1651 §9: cleaner free-text dataset search.
  When the backend lands `/datasets?q=<text>`, wire it into `BrowserPage`
  and the search box. Today the browser sends the query through the `filter`
  param; the new `q=` is a first-class text search.
- **`/users/me` auth** — The AppBar already calls this; it works today on
  staging. Verify it works against the Gemma 2.0 server's updated
  `LegacyAwareDaoAuthenticationProvider` (BCrypt migration). Should be
  transparent; just smoke-test once a local 2.0 server is up.
- **`originalPlatform` bug** (§19) — `BioAssayValueObject.originalPlatform`
  echoes `arrayDesign` for GENELIST stand-ins. Backend fix; frontend just
  needs to stop hiding behind the bug once it's patched.

### P2 — AppBar / navigation for Gemma 2.0

- **"Legacy browser" link** — Currently links to the old ExtJS page. As
  Gemma 2.0 ships, this becomes a dead link. Plan: keep it transitionally,
  then remove once React browser is confirmed feature-complete. Add a
  `legacyGemmaUrl` flag in `gemmaConfig.ts` to make the link conditional
  on whether the old UI is still up.
- **Nav items** — Current: Datasets, Platforms, Summary. Consider adding
  "Analysis" (DEA / diff-expression results browser) and "Tools" (code
  snippets, API links) as Gemma 2.0 features land.
- **Login / logout** — The AppBar shows the username when signed in, but no
  login CTA when anonymous. For Gemma 2.0, add a "Sign in" link that points
  to the Gemma login endpoint (or the new Spring Security form). Needed
  for curators to access restricted datasets in the public browser.

### P3 — Backend gaps to file against Gemma 2.0

These live in `src/api/endpoints.ts` but need backend work. File when
my brother's backend session opens on Gemma 2.0:

1. **Manufacturer field on Platform** — today derived by regex heuristic.
   Want a structured `manufacturer` field on `ArrayDesignValueObject`.
2. **Gene symbol search on platform elements** — filter by gene symbol/alias,
   not just probe name. Needs a `/platforms/{id}/elements?gene=BRCA1` param.
3. **Bulk element list with inline gene info** — opt-in `include=genes` to
   avoid N+1 calls per row.
4. **Summary endpoint** — per-taxon dataset counts + "new this week" delta.
   The DWR-only predecessor is gone; needs a real `/rest/v2/stats/summary`
   or similar. Blocked `home/useGemmaSummary.ts`.
5. **Probe sequence + alignment** — for platform detail page gene explorer.

## Work items — curation app (`apps/curation/`)

The curation app's Gemma 2.0 alignment is mostly about wiring the new Ticket
layer (which replaces the mock's write queue) and structured audit events.
These depend on my brother landing Ticket REST write endpoints in `gemma-rest`.
Until they land, all curation work continues against the mock unchanged.

Key upcoming wiring (for when the backend is ready):
- **Ticket endpoints** — `POST/GET/PATCH /rest/v2/tickets` = curation proposals
  (Issue #1651 §5). Will replace the proposer service's mock write path.
- **Structured audit events** — `audit_event.payload` column (§18) = typed
  action records. Will replace mock's synthetic audit trail.
- **Design endpoint** — `GET/PUT /rest/v2/datasets/{id}/design` (§4).
  Wire when landed; the design draft stays client-side until PUT is available.

## Gemma 2.0 Java server — local dev setup (when ready)

Once `phase2-acl-migrate` is at Gate 3 and a local build exists:

```sh
# In ~/Dev/eclipseworkspace/Gemma:
mvn -P fast install -DskipTests   # fast build, skip tests
# Run gemma-web WAR or gemma-rest on port 9080:
# (exact startup command TBD once deployment story is set;
#  see CONTAINER_CONFIG.md + CONTAINER_RECCE.md in that repo)

# In apps/browser:
GEMMA_BASE_URL=http://localhost:9080 npm run dev:browser
```

The staging server (`staging-gemma.msl.ubc.ca`) remains the default dev
target for the browser app until a local Gemma 2.0 build is stable.

## Branch strategy

- `feat/gemma-web-2.0` (current) — all Gemma 2.0 frontend alignment work.
  Merges to `main` when Gemma 2.0 is at Gate 3.
- `main` — shipping curation UI + working browser. Stays green.
- Do not merge Gemma 2.0 frontend changes to `main` before the backend
  Gate 3 merge. Keep the UI branch ahead of the backend, not behind it.
