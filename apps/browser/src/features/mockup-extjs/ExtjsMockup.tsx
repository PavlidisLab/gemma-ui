import { useState } from "react";
import "./extjs-skin.css";
import { OntologyTermChip } from "@/components/OntologyTermChip";

/**
 * ExtJS-classic skin mockup. Not wired to the real API — uses static
 * data and inline-styled chrome to show how Gemma 1.x's ExtJS look
 * would translate onto our new surfaces.
 *
 * Routes covered:
 *   - Home (the landing dashboard / search box)
 *   - Browse (search-results grid)
 *   - Dataset detail (Overview / Design / Samples tabs)
 *
 * The skin lives in `extjs-skin.css` and is scoped to a wrapper
 * class `.ext-skin`; nothing leaks out of this folder. Ontology
 * term chips deliberately keep their current emerald/CURIE
 * convention so the contrast against the ExtJS chrome is visible.
 */
type View = "home" | "browse" | "dataset";

export function ExtjsMockup() {
  const [view, setView] = useState<View>("home");
  return (
    <div className="ext-skin">
      <div className="ext-titlebar">
        <span>Gemma</span>
        <span style={{ opacity: 0.5 }}>— ExtJS-skin mockup</span>
        <a
          className={view === "home" ? "active" : ""}
          onClick={(e) => {
            e.preventDefault();
            setView("home");
          }}
          href="#home"
        >
          Home
        </a>
        <a
          className={view === "browse" ? "active" : ""}
          onClick={(e) => {
            e.preventDefault();
            setView("browse");
          }}
          href="#browse"
        >
          Browse
        </a>
        <a
          className={view === "dataset" ? "active" : ""}
          onClick={(e) => {
            e.preventDefault();
            setView("dataset");
          }}
          href="#dataset"
        >
          Dataset
        </a>
        <span style={{ marginLeft: "auto", opacity: 0.7, fontSize: 11 }}>
          read-only · static data
        </span>
      </div>
      <div className="ext-page">
        {view === "home" && <HomeMock />}
        {view === "browse" && <BrowseMock />}
        {view === "dataset" && <DatasetMock />}
      </div>
      <div className="ext-statusbar">
        <span>Ready</span>
        <span>·</span>
        <span>1 user(s) online</span>
        <span style={{ marginLeft: "auto" }}>v2.9.4 · mock</span>
      </div>
    </div>
  );
}

// ─── Home ─────────────────────────────────────────────────────────────────────

function HomeMock() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Panel title="Welcome to Gemma">
        <div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
          <div style={{ flex: 1 }}>
            <p style={{ marginTop: 0 }}>
              Gemma is a database for the meta-analysis, re-use and
              sharing of genomics data. We currently hold over 24,000
              re-annotated curated transcriptomic and epigenomic
              datasets, covering more than 30 organisms.
            </p>
            <div className="ext-toolbar" style={{ marginTop: 6 }}>
              <label className="ext-label" htmlFor="q">
                Search datasets:
              </label>
              <input
                id="q"
                className="ext-input"
                style={{ width: 320 }}
                placeholder="e.g. parkinson, GSE12345, brain"
              />
              <select className="ext-select">
                <option>any taxon</option>
                <option>human</option>
                <option>mouse</option>
                <option>rat</option>
              </select>
              <button type="button" className="ext-btn primary">
                Search
              </button>
              <button type="button" className="ext-btn">
                Advanced…
              </button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <Stat v="24,318" k="datasets" />
            <Stat v="2.3M" k="samples" />
            <Stat v="9,121" k="DE analyses" />
            <Stat v="34" k="organisms" />
          </div>
        </div>
      </Panel>

      <div style={{ display: "flex", gap: 6 }}>
        <div style={{ flex: 1 }}>
          <Panel title="Datasets recently updated">
            <table className="ext-grid">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Accession</th>
                  <th>Title</th>
                  <th style={{ width: 60 }}>Taxon</th>
                  <th style={{ width: 70 }}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {RECENT_DATASETS.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <a
                        className="ext-link"
                        href="#dataset"
                        onClick={(e) => e.preventDefault()}
                      >
                        {d.shortName}
                      </a>
                    </td>
                    <td>{d.name}</td>
                    <td>{d.taxon}</td>
                    <td>{d.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
        <div style={{ width: 320 }}>
          <Panel title="Quick links">
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: "18px" }}>
              <li>
                <a className="ext-link" href="#">
                  Browse all datasets
                </a>
              </li>
              <li>
                <a className="ext-link" href="#">
                  Platform catalogue (1,840 platforms)
                </a>
              </li>
              <li>
                <a className="ext-link" href="#">
                  Gene search
                </a>
              </li>
              <li>
                <a className="ext-link" href="#">
                  Differential expression query
                </a>
              </li>
              <li>
                <a className="ext-link" href="#">
                  REST API docs
                </a>
              </li>
              <li>
                <a className="ext-link" href="#">
                  Citing Gemma
                </a>
              </li>
            </ul>
          </Panel>
          <Panel title="News">
            <div style={{ marginBottom: 4 }}>
              <strong>2026-05-22 — </strong>Single-cell DE pipeline
              now ships per-cell-type result sets.
            </div>
            <div>
              <strong>2026-05-10 — </strong>Gemma 2.0 staging is open
              for testing; report issues via the wiki.
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Stat({ v, k }: { v: string; k: string }) {
  return (
    <div className="ext-stat">
      <div className="v">{v}</div>
      <div className="k">{k}</div>
    </div>
  );
}

// ─── Browse ───────────────────────────────────────────────────────────────────

function BrowseMock() {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
      <div style={{ width: 260 }}>
        <Panel title="Filters">
          <div className="ext-tree-row">
            <strong>Taxon</strong>
          </div>
          <FilterCheckbox label="human" count={11842} />
          <FilterCheckbox label="mouse" count={9038} checked />
          <FilterCheckbox label="rat" count={1981} />
          <FilterCheckbox label="zebrafish" count={341} />
          <FilterCheckbox label="C. elegans" count={273} />
          <FilterCheckbox label="more…" count={null} />
          <div style={{ height: 6 }} />
          <div className="ext-tree-row">
            <strong>Technology</strong>
          </div>
          <FilterCheckbox label="RNA-seq" count={14211} checked />
          <FilterCheckbox label="microarray" count={7822} />
          <FilterCheckbox label="single-cell" count={2071} />
          <div style={{ height: 6 }} />
          <div className="ext-tree-row">
            <strong>Annotations</strong>
          </div>
          <FilterCheckbox label="disease: parkinson disease" count={184} />
          <FilterCheckbox label="organism part: brain" count={1232} />
          <FilterCheckbox label="organism part: liver" count={641} />
        </Panel>
      </div>
      <div style={{ flex: 1 }}>
        <Panel
          title="Datasets — 247 results"
          tools={
            <>
              <button type="button" className="ext-btn">
                ☷ Group
              </button>
              <button type="button" className="ext-btn">
                ⇣ Export
              </button>
            </>
          }
        >
          <div className="ext-toolbar" style={{ marginBottom: 4 }}>
            <input
              className="ext-input"
              style={{ width: 220 }}
              placeholder="filter results…"
            />
            <select className="ext-select">
              <option>Sort: relevance</option>
              <option>Sort: date</option>
              <option>Sort: samples</option>
            </select>
            <span style={{ marginLeft: "auto" }}>
              Page <strong>1</strong> of 13 ·{" "}
              <a className="ext-link" href="#">
                next →
              </a>
            </span>
          </div>
          <table className="ext-grid">
            <thead>
              <tr>
                <th style={{ width: 90 }}>Accession</th>
                <th>Title</th>
                <th style={{ width: 60 }}>Taxon</th>
                <th style={{ width: 50 }}>n</th>
                <th style={{ width: 60 }}>Platform</th>
                <th style={{ width: 70 }}>Quality</th>
                <th style={{ width: 70 }}>Tags</th>
              </tr>
            </thead>
            <tbody>
              {BROWSE_ROWS.map((r) => (
                <tr key={r.id}>
                  <td>
                    <a
                      className="ext-link"
                      href="#dataset"
                      onClick={(e) => e.preventDefault()}
                    >
                      {r.shortName}
                    </a>
                  </td>
                  <td>{r.name}</td>
                  <td>{r.taxon}</td>
                  <td>{r.n}</td>
                  <td>{r.platform}</td>
                  <td>
                    <span className="ext-badge">GEEQ {r.geeq.toFixed(2)}</span>
                  </td>
                  <td>
                    {r.troubled ? (
                      <span className="ext-badge err">trbl</span>
                    ) : null}
                    {r.needsAttention ? (
                      <span className="ext-badge warn">needs</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}

function FilterCheckbox({
  label,
  count,
  checked = false,
}: {
  label: string;
  count: number | null;
  checked?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        lineHeight: "16px",
      }}
    >
      <input
        type="checkbox"
        defaultChecked={checked}
        style={{ margin: 0 }}
      />
      <span style={{ flex: 1 }}>{label}</span>
      {count != null ? (
        <span style={{ color: "var(--ext-muted)", fontSize: 10 }}>{count}</span>
      ) : null}
    </label>
  );
}

// ─── Dataset detail ──────────────────────────────────────────────────────────

function DatasetMock() {
  const [tab, setTab] = useState<"overview" | "design" | "samples">("overview");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Panel
        title={`GSE2866 — Donarum-3R01M dopaminergic neuron transcriptomes`}
        tools={
          <>
            <span className="ext-badge">GEEQ 0.43</span>
            <button type="button" className="ext-btn">
              ★ Watch
            </button>
            <button type="button" className="ext-btn">
              ↗ Cite
            </button>
          </>
        }
      >
        <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
          <div>
            <strong>Taxon:</strong> mouse
          </div>
          <div>
            <strong>Samples:</strong> 18
          </div>
          <div>
            <strong>Platform:</strong> Illumina MouseRef-8 v2
          </div>
          <div>
            <strong>Last updated:</strong> 2026-05-20
          </div>
          <a className="ext-link" href="#">
            GEO:GSE2866 ↗
          </a>
        </div>
      </Panel>

      <div className="ext-tabs">
        <div
          className={"ext-tab" + (tab === "overview" ? " active" : "")}
          onClick={() => setTab("overview")}
        >
          Overview
        </div>
        <div
          className={"ext-tab" + (tab === "design" ? " active" : "")}
          onClick={() => setTab("design")}
        >
          Experimental Design
        </div>
        <div
          className={"ext-tab" + (tab === "samples" ? " active" : "")}
          onClick={() => setTab("samples")}
        >
          Samples
        </div>
      </div>

      {tab === "overview" && <DatasetOverview />}
      {tab === "design" && <DatasetDesign />}
      {tab === "samples" && <DatasetSamples />}
    </div>
  );
}

function DatasetOverview() {
  return (
    <>
      <Panel title="Abstract">
        <p style={{ margin: 0 }}>
          We profiled dopaminergic neurons from Sox9-overexpression and
          wild-type mice across the hippocampus, retina, and pineal body
          to assess transcriptional changes associated with astrocyte
          phagocytic phenotypes in an Alzheimer&apos;s disease model.
          See associated publication for full context.
        </p>
      </Panel>
      <Panel title="Publication">
        <strong>
          Astrocytic Sox9 overexpression in Alzheimer&apos;s disease
          mouse models promotes Aβ plaque phagocytosis and preserves
          cognitive function.
        </strong>
        <div style={{ color: "var(--ext-muted)", marginTop: 2 }}>
          Choi DJ, Murali S, Kwon W, Woo J, Song E-AC, Ko Y, Sardar D,
          Lozzi B, Cheng Y-T, Williamson MR, Huang T-W et al.
          <em> Nat Neurosci </em>2026 Vol 29(1) pp.88–99 ·{" "}
          <a className="ext-link" href="#">
            PMID:41272323 ↗
          </a>
        </div>
      </Panel>
      <Panel title="Differential Expression Analyses">
        <div className="ext-toolbar" style={{ marginBottom: 4 }}>
          <span>4 analyses · 9 contrasts</span>
          <button type="button" className="ext-btn" style={{ marginLeft: "auto" }}>
            ⇣ Download all
          </button>
        </div>
        <table className="ext-grid">
          <thead>
            <tr>
              <th>Analysis</th>
              <th>Factor(s)</th>
              <th style={{ width: 80 }}>Baseline</th>
              <th style={{ width: 90 }}>n DE</th>
              <th style={{ width: 60 }}>↑/↓</th>
              <th style={{ width: 80 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={6} style={{ background: "#eaf0f8" }}>
                <strong>Subset: pineal body</strong> · tissue
              </td>
            </tr>
            <tr>
              <td style={{ paddingLeft: 18 }}>time × treatment</td>
              <td>time, treatment</td>
              <td>—</td>
              <td>
                <span className="ext-badge">376 (4.4%)</span>
              </td>
              <td>116 / 260</td>
              <td>
                <a className="ext-link" href="#">
                  heatmap
                </a>{" "}
                ·{" "}
                <a className="ext-link" href="#">
                  TSV
                </a>
              </td>
            </tr>
            <tr>
              <td style={{ paddingLeft: 18 }}>time</td>
              <td>time</td>
              <td>ZT6</td>
              <td>
                <span className="ext-badge">188 (2.2%)</span>
              </td>
              <td>74 / 114</td>
              <td>
                <a className="ext-link" href="#">
                  heatmap
                </a>{" "}
                ·{" "}
                <a className="ext-link" href="#">
                  TSV
                </a>
              </td>
            </tr>
            <tr>
              <td style={{ paddingLeft: 18 }}>treatment</td>
              <td>treatment</td>
              <td>light:dark</td>
              <td>
                <span className="ext-badge">132 (1.5%)</span>
              </td>
              <td>52 / 80</td>
              <td>
                <a className="ext-link" href="#">
                  heatmap
                </a>{" "}
                ·{" "}
                <a className="ext-link" href="#">
                  TSV
                </a>
              </td>
            </tr>
            <tr>
              <td colSpan={6} style={{ background: "#eaf0f8" }}>
                <strong>Subset: retina</strong> · tissue
              </td>
            </tr>
            <tr>
              <td style={{ paddingLeft: 18 }}>time</td>
              <td>time</td>
              <td>ZT6</td>
              <td>
                <span className="ext-badge">217 (2.5%)</span>
              </td>
              <td>88 / 129</td>
              <td>
                <a className="ext-link" href="#">
                  heatmap
                </a>{" "}
                ·{" "}
                <a className="ext-link" href="#">
                  TSV
                </a>
              </td>
            </tr>
            <tr>
              <td style={{ paddingLeft: 18 }}>treatment</td>
              <td>treatment</td>
              <td>light:dark</td>
              <td>
                <span className="ext-badge">11 (&lt;1%)</span>
              </td>
              <td>5 / 6</td>
              <td>
                <a className="ext-link" href="#">
                  heatmap
                </a>{" "}
                ·{" "}
                <a className="ext-link" href="#">
                  TSV
                </a>
              </td>
            </tr>
          </tbody>
        </table>
      </Panel>
    </>
  );
}

function DatasetDesign() {
  return (
    <Panel title="Experimental Factors (3)">
      {/* Bio factors first, batch last — matches the curation rule. */}
      <FactorCard
        name="genotype"
        category="genotype"
        categoryUri="http://www.ebi.ac.uk/efo/EFO_0000513"
        description="Sox9 overexpression vs. wild type"
        rows={[
          {
            baseline: true,
            statement: { subj: "wild type genotype", subjUri: "http://www.ebi.ac.uk/efo/EFO_0005168" },
          },
          {
            statement: {
              subj: "Sox9 [mouse] SRY (sex determining region Y)-box 9",
              subjUri: "http://purl.org/commons/record/ncbi_gene/20682",
              pred: "has_genotype",
              predUri: "http://purl.obolibrary.org/obo/GENO_0000222",
              obj: "Overexpression",
              objUri: "http://gemma.msl.ubc.ca/ont/TGEMO_00004",
            },
          },
        ]}
      />
      <FactorCard
        name="tissue"
        category="organism part"
        categoryUri="http://www.ebi.ac.uk/efo/EFO_0000635"
        description="anatomical site sampled"
        rows={[
          { statement: { subj: "hippocampus", subjUri: "http://purl.obolibrary.org/obo/UBERON_0002421" } },
          { statement: { subj: "pineal body", subjUri: "http://purl.obolibrary.org/obo/UBERON_0001905" } },
          { statement: { subj: "retina", subjUri: "http://purl.obolibrary.org/obo/UBERON_0000966" } },
          { statement: { subj: "cerebellum", subjUri: "http://purl.obolibrary.org/obo/UBERON_0002037" } },
          { statement: { subj: "cerebral cortex", subjUri: "http://purl.obolibrary.org/obo/UBERON_0000956" } },
        ]}
      />
      <NuisanceBanner />
      <FactorCard
        nuisance
        name="batch"
        category="block"
        categoryUri="http://www.ebi.ac.uk/efo/EFO_0005067"
        description="scan-date proxy from raw data files"
        rows={[
          { fallback: "Device=NB501771:Run=702:Flowcell=H2NWLBGXV:Lane=1" },
          { fallback: "Device=NB501771:Run=694:Flowcell=H2N3HBGXV:Lane=1" },
        ]}
      />
    </Panel>
  );
}

function NuisanceBanner() {
  return (
    <div
      style={{
        marginTop: 6,
        padding: "2px 6px",
        background: "#ededed",
        borderLeft: "3px solid #b5b8c8",
        color: "var(--ext-muted)",
        fontStyle: "italic",
      }}
    >
      Nuisance variables (excluded from biological factor count):
    </div>
  );
}

function FactorCard({
  name,
  category,
  categoryUri,
  description,
  rows,
  nuisance = false,
}: {
  name: string;
  category: string;
  categoryUri: string;
  description: string;
  nuisance?: boolean;
  rows: {
    baseline?: boolean;
    fallback?: string;
    statement?: {
      subj: string;
      subjUri?: string | null;
      pred?: string;
      predUri?: string | null;
      obj?: string;
      objUri?: string | null;
    };
  }[];
}) {
  return (
    <div
      style={{
        background: nuisance ? "#fafafa" : "#fcfdfe",
        border: "1px solid #c0d2e8",
        marginBottom: 4,
      }}
    >
      <div
        style={{
          background: nuisance
            ? "linear-gradient(to bottom,#ededed,#dcdcdc)"
            : "linear-gradient(to bottom,#ebf3fd,#c9daee)",
          padding: "2px 6px",
          borderBottom: "1px solid #c0d2e8",
          display: "flex",
          alignItems: "baseline",
          gap: 6,
        }}
      >
        <strong>{name}</strong>
        <OntologyTermChip uri={categoryUri}>{category}</OntologyTermChip>
        <span style={{ color: "var(--ext-muted)", fontSize: 11 }}>
          {rows.length} level{rows.length === 1 ? "" : "s"} — {description}
        </span>
      </div>
      <table className="ext-grid" style={{ border: 0 }}>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ width: 70 }}>
                {r.baseline ? (
                  <span className="ext-badge warn">baseline</span>
                ) : (
                  <span style={{ color: "var(--ext-muted)" }}>○</span>
                )}
              </td>
              <td>
                {r.statement ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    <OntologyTermChip uri={r.statement.subjUri}>
                      {r.statement.subj}
                    </OntologyTermChip>
                    {r.statement.pred ? (
                      <OntologyTermChip
                        uri={r.statement.predUri}
                        variant="predicate"
                      >
                        {r.statement.pred}
                      </OntologyTermChip>
                    ) : null}
                    {r.statement.obj ? (
                      <OntologyTermChip uri={r.statement.objUri}>
                        {r.statement.obj}
                      </OntologyTermChip>
                    ) : null}
                  </div>
                ) : (
                  <span style={{ color: "var(--ext-muted)" }}>
                    {r.fallback}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DatasetSamples() {
  return (
    <Panel title="Samples (18)">
      <div className="ext-toolbar" style={{ marginBottom: 4 }}>
        <input
          className="ext-input"
          style={{ width: 200 }}
          placeholder="filter samples…"
        />
        <select className="ext-select">
          <option>show: all</option>
          <option>show: outliers only</option>
        </select>
        <span style={{ marginLeft: "auto", color: "var(--ext-muted)" }}>
          2 outliers · 0 needs-attention
        </span>
      </div>
      <table className="ext-grid">
        <thead>
          <tr>
            <th style={{ width: 32 }}></th>
            <th>Name</th>
            <th style={{ width: 100 }}>GEO accession</th>
            <th style={{ width: 120 }}>genotype</th>
            <th style={{ width: 100 }}>tissue</th>
            <th style={{ width: 90 }}>batch</th>
            <th style={{ width: 50 }}>Flags</th>
          </tr>
        </thead>
        <tbody>
          {SAMPLE_ROWS.map((s, i) => (
            <tr key={i}>
              <td style={{ textAlign: "center", color: "var(--ext-muted)" }}>
                {s.outlier ? "⚠" : ""}
              </td>
              <td>{s.name}</td>
              <td>
                <a className="ext-link" href="#">
                  {s.acc}
                </a>
              </td>
              <td>{s.genotype}</td>
              <td>{s.tissue}</td>
              <td style={{ color: "var(--ext-muted)" }}>{s.batch}</td>
              <td>
                {s.outlier ? <span className="ext-badge err">out</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

// ─── Shared chrome ───────────────────────────────────────────────────────────

function Panel({
  title,
  children,
  tools,
}: {
  title: string;
  children: React.ReactNode;
  tools?: React.ReactNode;
}) {
  return (
    <div className="ext-panel">
      <div className="ext-panel-header">
        <span>{title}</span>
        {tools ? <span className="ext-tools">{tools}</span> : null}
      </div>
      <div className="ext-panel-body">{children}</div>
    </div>
  );
}

// ─── Static data ─────────────────────────────────────────────────────────────

const RECENT_DATASETS = [
  {
    id: 1,
    shortName: "GSE294900.3",
    name: "Astrocytic Sox9 overexpression in AD mouse models",
    taxon: "mouse",
    date: "2026-05-20",
  },
  {
    id: 2,
    shortName: "GSE201234",
    name: "Cortical interneuron development across postnatal stages",
    taxon: "mouse",
    date: "2026-05-19",
  },
  {
    id: 3,
    shortName: "GSE189211",
    name: "Microglial states in age-related cognitive decline",
    taxon: "human",
    date: "2026-05-18",
  },
  {
    id: 4,
    shortName: "GSE177345",
    name: "Hippocampal long-term potentiation transcriptome",
    taxon: "rat",
    date: "2026-05-17",
  },
];

const BROWSE_ROWS = [
  {
    id: 1,
    shortName: "GSE294900.3",
    name: "Astrocytic Sox9 overexpression in AD",
    taxon: "mouse",
    n: 18,
    platform: "GPL21626",
    geeq: 0.43,
    troubled: false,
    needsAttention: true,
  },
  {
    id: 2,
    shortName: "GSE201234",
    name: "Cortical interneuron development",
    taxon: "mouse",
    n: 24,
    platform: "GPL16791",
    geeq: 0.72,
    troubled: false,
    needsAttention: false,
  },
  {
    id: 3,
    shortName: "GSE189211",
    name: "Microglial states in cognitive decline",
    taxon: "human",
    n: 42,
    platform: "GPL18573",
    geeq: 0.66,
    troubled: false,
    needsAttention: false,
  },
  {
    id: 4,
    shortName: "GSE177345",
    name: "Hippocampal LTP transcriptome",
    taxon: "rat",
    n: 12,
    platform: "GPL19057",
    geeq: 0.51,
    troubled: false,
    needsAttention: false,
  },
  {
    id: 5,
    shortName: "GSE166512",
    name: "Cerebellar granule cell maturation",
    taxon: "mouse",
    n: 36,
    platform: "GPL21103",
    geeq: 0.39,
    troubled: true,
    needsAttention: false,
  },
  {
    id: 6,
    shortName: "GSE164021",
    name: "Stress response in pyramidal neurons",
    taxon: "rat",
    n: 16,
    platform: "GPL19057",
    geeq: 0.58,
    troubled: false,
    needsAttention: false,
  },
];

const SAMPLE_ROWS = [
  {
    name: "AD_control_Hippocampal_Astrocytes_1",
    acc: "GSM8928001",
    genotype: "wild type",
    tissue: "hippocampus",
    batch: "Lane=1",
  },
  {
    name: "AD_control_Hippocampal_Astrocytes_2",
    acc: "GSM8928002",
    genotype: "wild type",
    tissue: "hippocampus",
    batch: "Lane=1",
  },
  {
    name: "AD_control_Hippocampal_Astrocytes_3",
    acc: "GSM8928003",
    genotype: "wild type",
    tissue: "hippocampus",
    batch: "Lane=2",
    outlier: true,
  },
  {
    name: "AD_Sox9-Overexpression_Hippocampal_Astrocytes_1",
    acc: "GSM8928009",
    genotype: "Sox9 overexpression",
    tissue: "hippocampus",
    batch: "Lane=1",
  },
  {
    name: "AD_Sox9-Overexpression_Hippocampal_Astrocytes_2",
    acc: "GSM8928010",
    genotype: "Sox9 overexpression",
    tissue: "hippocampus",
    batch: "Lane=2",
  },
  {
    name: "AD_Sox9-Overexpression_Hippocampal_Astrocytes_3",
    acc: "GSM8928011",
    genotype: "Sox9 overexpression",
    tissue: "hippocampus",
    batch: "Lane=2",
  },
  {
    name: "AD_Sox9-Overexpression_Pineal_1",
    acc: "GSM8928012",
    genotype: "Sox9 overexpression",
    tissue: "pineal body",
    batch: "Lane=3",
  },
  {
    name: "AD_Sox9-Overexpression_Pineal_2",
    acc: "GSM8928013",
    genotype: "Sox9 overexpression",
    tissue: "pineal body",
    batch: "Lane=3",
    outlier: true,
  },
];
