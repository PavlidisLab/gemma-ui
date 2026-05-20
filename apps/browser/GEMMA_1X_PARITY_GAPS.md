# Gemma 1.x parity gaps — React browser app

Filed 2026-05-19. Reference branch: `feat/gemma-web-2.0`.

Work items split by type:

- **[BE]** Backend (Java/REST) work needed before the frontend can wire this
- **[FE]** Frontend wiring — endpoint already exists, React app has a placeholder

---

## 1. Home page

### [BE] Summary stats endpoint

The legacy Gemma home page shows:
- Total datasets, platforms, and samples/bioassays (overall)
- Per-taxon breakdown: Human, Mouse, Rat, Other (dataset count + sample count per row)
- "Updated in last 7 days" delta per row
- "New in last 7 days" delta per row

None of this is available from REST. The old ExtJS page called a DWR
endpoint (now gone). The React app (`home/useGemmaSummary.ts`) derives
dataset and platform totals via `?limit=1` tricks and renders all other
rows as "—".

**Ask**: a new endpoint, e.g. `GET /rest/v2/summary`, returning:

```json
{
  "datasetTotal": 25341,
  "platformTotal": 671,
  "bioAssayTotal": 1823456,
  "byTaxon": [
    { "taxonId": 9606, "commonName": "human", "datasetCount": 12000, "bioAssayCount": 900000,
      "updatedLastWeek": 14, "newLastWeek": 3 },
    ...
  ],
  "updatedLastWeek": 31,
  "newLastWeek": 8
}
```

`bioAssayTotal` is the expensive number; could be omitted or cached.
`updatedLastWeek` / `newLastWeek` require a date-windowed query on
`AuditEvent` (class `ExpressionExperimentAnalyzedEvent` or similar).

---

## 2. Browser / search

### [BE] Free-text `query=` search on datasets — SearchService is stubbed

`GET /rest/v2/datasets?query=alzheimer` currently returns **zero results** on
the 2.0 branch. The `query` param and its full wiring through `DatasetArgService`
→ `SearchService.search()` already exist. But `SearchServiceImpl` is a complete
stub (class comment: "Stubbed search service for the post-Hibernate-Search era.
Returns empty results.") — Hibernate Search 5 / Lucene 5 was gutted in Phase 2
with no replacement yet.

The React browser app already sends `query=` correctly; the search box will work
the moment the stub is replaced. No frontend change needed.

**Note**: there are two separate Lucene-backed indexing paths, both stubbed. This
item is for entity search (datasets, genes, platforms) via `SearchServiceImpl`.
Ontology term indexing is a separate item — see §2b below.

**Decision: Hibernate Search 7 + Lucene 9** (2026-05-19).

Rationale:
- HS7 is the officially supported pair with Hibernate ORM 6 (what 2.0 runs).
- `SearchService` / `SearchSettings` / `SearchResult<T>` are already designed around the HS model; the stub was created explicitly to be replaced by HS7.
- No new ops dependency — Lucene index lives on disk.
- HS7 has a backend abstraction: swap one config property to target an OpenSearch cluster later without rewriting the search layer. OpenSearch is not foreclosed, just deferred.
- Old HS4/5 `SearchServiceImpl` lives in git history (renovations branch, pre-phase2) as a reference for indexed entity types and search settings.

**Work**: add `@Indexed` / `@FullTextField` / `@KeywordField` to entities
(EE, Gene, ArrayDesign, CompositeSequence, BibliographicReference), rewrite
`SearchServiceImpl` with the HS7 Search DSL, wire a mass indexer on first
startup. Estimated ~2–3 backend sessions.

### [BE] §2b — Ontology term indexing (`baseCode` `OntologyIndexer` stub)

Separate from `SearchServiceImpl`. The `OntologyIndexer` in
`~/Dev/eclipseworkspace/baseCode` (renovations branch) is also stubbed — its
factory methods return null. `AbstractOntologyService.findTerm()` checks for
null index and returns empty with a warning.

**Partial degradation, not total breakage.** `OntologyServiceImpl.findTermsInexact()`
has three sources: (1) database `Characteristic` table search — still works;
(2) database gene lookup — still works; (3) ontology index — returns empty.
So `GET /rest/v2/annotations/search` returns terms already used in the corpus
but misses terms in loaded ontologies (GO, DOID, UBERON, etc.) that haven't
been applied to any dataset yet. For browse/filter use this is acceptable;
for curation annotation proposal it's a gap.

**Decision needed** (two options from `OntologyIndexer` stub comment):
1. **Port `OntologyIndexer` to Lucene 9** — same design, direct Lucene API.
   Lucene 9 is already pulled in by HS7, so versions stay consistent. Keep
   owning a hand-rolled RDF→Lucene indexer.
2. **Migrate to Apache Jena `jena-text`** — Jena's own RDF/OWL search module,
   also Lucene-backed, purpose-built for this job. Cleaner long-term. Would
   also drive a `com.hp.hpl.jena` → `org.apache.jena` namespace migration
   (Jena 2.x → 4.x) in baseCode — a natural combined upgrade.

Option 2 is recommended: stops owning a bespoke RDF indexer, uses the
maintained Jena module, and forces the overdue Jena namespace upgrade.
Both options live in baseCode, not Gemma proper.

### [BE] `manufacturer` field on `ArrayDesignValueObject`

The Platforms catalogue groups by manufacturer (Affymetrix, Illumina, Agilent,
etc.). Today the React app derives the manufacturer by regex on the platform
name (`platforms/manufacturer.ts`), which misses any platform where the vendor
name doesn't appear at the start of the name.

**Ask**: expose a `manufacturer` (or `vendor`) String field on
`ArrayDesignValueObject`. The database likely already has this or can derive
it from the existing `ArrayDesign.manufacturer` association.

---

## 3. Dataset page

### [FE] Design tab — wire `GET /rest/v2/datasets/{id}/design`

Endpoint exists and returns a structured `ExperimentalDesignValueObject`
(factors, factor values with stable IDs, biomaterial-to-FV assignments).
React app has a placeholder: "Backend wire pending." Wire the endpoint and
render a compact factor × factor-value × sample-count table. The curation
app's `ExperimentalDesignPanel` is the model — port a read-only version.

### [FE] Samples tab — wire `GET /rest/v2/datasets/{id}/samples`

Endpoint exists and returns `List<BioAssayValueObject>` (biomaterial name,
GEO sample ID, factor-value assignments, characteristics). React app has a
placeholder. Wire it; render the same compact table the curation app uses in
`apps/curation/src/features/samples/`, read-only.

### [FE] Expression / DE tab — wire DE analysis endpoints

These endpoints all exist:
- `GET /rest/v2/datasets/{id}/analyses/differential` → list of `DifferentialExpressionAnalysisValueObject` (factor IDs, result-set IDs, number of probes tested)
- `GET /rest/v2/resultSets?datasets={id}` → result-set list (redirected via `/{id}/analyses/differential/resultSets`)
- `GET /rest/v2/resultSets/{rsId}` → single result set
- `GET /rest/v2/datasets/{id},{...}/expressions/differential?diffExSet={rsId}&threshold=0.05` → expression vectors for top DE genes

React app renders synthetic heatmap with a placeholder. Wire the real DE
analysis list and drive the heatmap from a real result set's top-gene
expression vectors.

### [FE] Publications section

Endpoint exists: `GET /rest/v2/datasets/{id}/publications` → `List<BibliographicReferenceValueObject>` (title, authors, journal, year, PubMed ID, DOI). Not surfaced on the dataset page at all — currently users have to go to the legacy Gemma link to find the publication.

**Ask (frontend)**: add a publications section under Overview (or its own tab). Most datasets have 1–2 publications; a compact card list is sufficient.

### [FE] Pipeline status section

Endpoint exists: `GET /rest/v2/datasets/{id}/pipelineStatus` → per-step
status object (`batchInfo`, `preprocess`, `pca`, `sampleCorrelation`,
`meanVariance`, `dea`, `missingValue`) with state (`ok`/`failed`/`notRun`)
and last-run timestamp. Also includes top-level `hasBatchInformation`,
`hasDifferentialExpressionAnalysis`, `troubled`, `needsAttention`.

Not surfaced on the dataset page. The legacy site showed this as a processing
summary. Useful for users to know whether DE results exist before navigating
to the Expression tab.

**Ask (frontend)**: show a compact pipeline status chip row in the banner or
Overview tab: a row of step pills (Preprocess / Batch / PCA / DEA) colored
by state. Also drives whether the Design/Expression tabs should show content
or a "not yet run" message.

### [FE] GEEQ details

The banner already shows the `publicQualityScore` as a small chip. The full
GEEQ object (sScorePublicationCuration, sScoreOutliers, sScoreSampleMeanCorrelation,
sScoreExperimentDesignProblems, etc.) is available via
`GET /rest/v2/datasets/{id}/geeq`. Not wired.

**Ask (frontend)**: expand the GEEQ chip into a popover or a row in the
Overview tab that shows the component scores. The legacy site had a GEEQ
tooltip.

### [BE] SVD / PCA QC plots

Endpoint exists: `GET /rest/v2/datasets/{id}/svd` → `SimpleSVDValueObject`
(variance explained per component, bioAssay scores on each component,
eigenvalues). This is the data behind the legacy "PCA/SVD" QC plot.

No endpoint for the **sample correlation heatmap** (the pairwise
sample-correlation matrix that is the most-used QC visualization).

**Ask (backend)**: `GET /rest/v2/datasets/{id}/sampleCorrelation` → the
correlation matrix as a JSON array-of-arrays (symmetric, N×N where N =
number of bioassays). The matrix is already computed by the pipeline
(`sampleCorrelation` pipeline step) and stored in
`ExpressionExperimentQCInformation`; it just isn't exposed as a REST
endpoint.

**Ask (frontend)**: once both endpoints exist, render:
- SVD variance-explained bar chart in the Expression tab
- Sample correlation heatmap (using the existing `HeatmapWidget`)

### [BE] Mean-variance plot

No REST endpoint. The legacy site shows this as a log(mean) × log(variance)
scatter of all probes — a standard QC check for RNA-seq. Computed by the
pipeline (`meanVariance` step) and stored in `MeanVariancePlotValueObject`.

**Ask**: `GET /rest/v2/datasets/{id}/meanVariance` → `{ mean: number[], variance: number[], isLog: boolean }`.

---

## 4. Platform page

### [FE] Annotations tab — wire `GET /rest/v2/platforms/{id}/annotations`

Endpoint exists and returns platform-level ontology annotations. Not wired
in the React platform detail page (`PlatformDetailPage.tsx`). A simple
grouped-chip display like the dataset annotations section would suffice.

### [BE] Gene symbol search on platform elements

Covered in `src/api/endpoints.ts` backend gaps. The element explorer on
`PlatformDetailPage` only matches probe names (`name like '%BRCA1%'`).
Biologists search by gene symbol. Needs a `gene=BRCA1` param (or `geneSymbol`)
on `GET /rest/v2/platforms/{id}/elements` that maps through the
`composite_sequence → gene` association.

### [BE] Bulk gene info on element list

Also in `endpoints.ts`. The element list returns `{id, name, description}`;
getting the mapped gene symbol requires a separate call per element. An
opt-in `include=genes` that embeds `{ officialSymbol, ncbiId }` on the bulk
response avoids the N+1 pattern.

---

## 5. Gene pages (not yet built)

The home page SURFACES list has "Genes" with `to: null`. The legacy
Gemma site has per-gene pages with:
- Gene overview (symbol, name, NCBI/Ensembl IDs, aliases, genomic location)
- GO terms
- Datasets this gene appears in
- Differential expression results across datasets

REST surface available for wiring:
- `GET /rest/v2/genes/{gene}` — basic info
- `GET /rest/v2/genes/{gene}/locations` — genomic coordinates
- `GET /rest/v2/genes/{gene}/goTerms` — GO annotations
- `GET /rest/v2/genes/{gene}/probes` — platform probes
- `GET /rest/v2/datasets/analyses/differential/results/genes/{gene}` — DE results across datasets
- `GET /rest/v2/datasets/expressions/genes/{gene}` — expression levels across datasets

No new backend endpoints needed for a basic gene page — it can be built
from what's there. This is purely a frontend build.

---

## 6. About / contact page (not yet built)

The home page SURFACES has "About" with `to: null`. Should cover:
- What Gemma is (pipeline description, curation approach)
- Citation / how to cite
- Contact / team (Pavlidis Lab, UBC)
- REST API links
- Client library links (gemma.R, gemmapy)
- Data use policy

Pure static content — no backend changes needed.

---

## Summary table

| Gap | Type | Blocked on |
|---|---|---|
| Summary stats endpoint (datasets/samples/platforms by taxon + deltas) | BE | New REST endpoint |
| Free-text `query=` dataset search | BE | Implement HS7+Lucene9 in `SearchServiceImpl`; decision made 2026-05-19 |
| Ontology term search (`/annotations/search` full results) | BE (baseCode) | `OntologyIndexer` stub; partial DB fallback works; recommend `jena-text` upgrade |
| `manufacturer` field on Platform | BE | Add to `ArrayDesignValueObject` |
| Dataset → Design tab | FE | endpoint exists |
| Dataset → Samples tab | FE | endpoint exists |
| Dataset → Expression tab (DE list + heatmap) | FE | endpoints exist |
| Dataset → Publications section | FE | endpoint exists |
| Dataset → Pipeline status chips | FE | endpoint exists |
| Dataset → GEEQ detail popover | FE | endpoint exists |
| Dataset → SVD chart | FE | endpoint exists |
| Dataset → Sample correlation heatmap | BE+FE | backend endpoint missing |
| Dataset → Mean-variance plot | BE+FE | backend endpoint missing |
| Platform → Annotations tab | FE | endpoint exists |
| Platform element → gene symbol search | BE | param missing on /elements |
| Platform element → inline gene info | BE | `include=genes` not implemented |
| Gene pages (per-gene overview, DE across datasets) | FE | endpoints exist |
| About / contact page | FE | static, no backend |
