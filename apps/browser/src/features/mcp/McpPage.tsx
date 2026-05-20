// gemma-mcp documentation page — /mcp
// MCP server wrapping gemmapy; lets Claude and other MCP clients
// search Gemma, fetch expression, and run precomputed DE.

export function McpPage() {
  return (
    <div className="h-full overflow-y-auto bg-gemma-bg">
      <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">
        <header>
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold tracking-tight text-gemma-ink">
              gemma-mcp
            </h1>
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 font-mono">
              v0.1
            </span>
            <a
              href="https://github.com/PavlidisLab/gemma-mcp"
              target="_blank"
              rel="noreferrer"
              className="text-sm text-gemma-accent hover:underline ml-auto"
            >
              GitHub ↗
            </a>
          </div>
          <p className="mt-2 text-sm text-gemma-subtle leading-relaxed">
            An{" "}
            <a
              href="https://modelcontextprotocol.io"
              target="_blank"
              rel="noreferrer"
              className="text-gemma-accent hover:underline"
            >
              MCP
            </a>{" "}
            server wrapping{" "}
            <a
              href="https://github.com/PavlidisLab/gemmapy"
              target="_blank"
              rel="noreferrer"
              className="text-gemma-accent hover:underline"
            >
              gemmapy
            </a>{" "}
            — lets Claude (or any MCP client) search Gemma, fetch expression values,
            and pull precomputed differential expression data for downstream analysis.
          </p>
        </header>

        <Section title="Installation">
          <p>Requires Python 3.10+.</p>
          <CodeBlock>{`git clone https://github.com/PavlidisLab/gemma-mcp
cd gemma-mcp
python3.10 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/pytest`}</CodeBlock>
        </Section>

        <Section title="Register with Claude Code">
          <p>
            Copy <code className="font-mono text-[12px]">.mcp.json.example</code> to{" "}
            <code className="font-mono text-[12px]">.mcp.json</code> in your project root and
            fill in the absolute paths:
          </p>
          <CodeBlock>{`{
  "mcpServers": {
    "gemma": {
      "command": "/ABS/PATH/gemma-mcp/.venv/bin/python",
      "args": ["-m", "gemma_mcp.server"],
      "env": { "GEMMA_CACHE_DIR": "/ABS/PATH/gemma-mcp/.gemma-cache" }
    }
  }
}`}</CodeBlock>
          <p>
            Skills under <code className="font-mono text-[12px]">.claude/skills/</code> are
            picked up automatically when this is your project root.
          </p>
        </Section>

        <Section title="Tools">
          <p>
            16 tools in 6 groups. Small responses (metadata, gene lookups, short lists)
            are returned inline; bulk data (expression matrices, full DE tables) are
            written to the cache dir as Parquet or h5ad and a stub is returned to keep
            large frames out of the model context.
          </p>
          <div className="space-y-5 mt-3">
            <ToolGroup
              label="Discovery"
              tools={[
                { name: "search_datasets", desc: "Free-text, GEO accession (GSE…), or ontology URI. Combine with uris=[…] for precise matching or filter= for structured filters." },
                { name: "search_annotations", desc: "Find ontology terms used in Gemma — returns URIs, labels, and categories." },
                { name: "resolve_ontology_term", desc: "Resolve plain-English terms to canonical Gemma ontology URIs." },
                { name: "filter_properties", desc: "List accepted filter field names/types before constructing structured filters." },
              ]}
            />
            <ToolGroup
              label="Dataset detail"
              tools={[
                { name: "get_dataset", desc: "Metadata, curation flags, and annotations for one dataset (GEO accession or Gemma ID)." },
                { name: "get_dataset_design", desc: "Experimental design (samples × factors) as a tidy sample table." },
              ]}
            />
            <ToolGroup
              label="Expression"
              tools={[
                { name: "get_expression_for_genes", desc: "Expression values for a gene list across one or more datasets. Returns a Parquet stub (long-form: dataset × gene × sample)." },
                { name: "get_dataset_object", desc: "Download one or more full datasets as AnnData (.h5ad): expression matrix + sample design + gene metadata." },
                { name: "expression_to_anndata", desc: "Convert a long-form expression Parquet into a single multi-dataset AnnData." },
              ]}
            />
            <ToolGroup
              label="Differential expression"
              tools={[
                { name: "list_de_analyses", desc: "List precomputed DE analyses (result sets + contrasts) for a dataset." },
                { name: "get_de_results", desc: "Full DE table for a dataset, all contrasts joined on probe/gene. Large result → Parquet stub." },
                { name: "get_de_for_gene", desc: "Cross-study DE for one gene across all Gemma datasets, optionally filtered by taxon." },
              ]}
            />
            <ToolGroup
              label="Gene / platform"
              tools={[
                { name: "resolve_gene", desc: "Resolve a gene symbol/ID to Gemma canonical records (one per taxon)." },
                { name: "get_gene_probes", desc: "Platforms and probe IDs for a gene." },
                { name: "list_taxa", desc: "All taxa (species) supported by Gemma." },
              ]}
            />
            <ToolGroup
              label="Feedback"
              tools={[
                { name: "request_dataset_coverage", desc: "Draft or file a GitHub issue requesting that curators add a dataset. Runs in dry-run mode unless confirm=True — always shows the draft first." },
              ]}
            />
          </div>
        </Section>

        <Section title="Claude skills">
          <p>
            Bundled in <code className="font-mono text-[12px]">.claude/skills/</code> — invoke
            with <code className="font-mono text-[12px]">/gemma-find</code>,{" "}
            <code className="font-mono text-[12px]">/gemma-explore-dataset</code>,{" "}
            <code className="font-mono text-[12px]">/gemma-expression</code>,{" "}
            <code className="font-mono text-[12px]">/gemma-de</code>,{" "}
            <code className="font-mono text-[12px]">/gemma-request</code>,{" "}
            <code className="font-mono text-[12px]">/gemma-setup</code>.
          </p>
        </Section>

        <Section title="Authentication">
          <p>
            Gemma is public — anonymous access works for all public studies. For private
            studies set <code className="font-mono text-[12px]">GEMMA_USERNAME</code> and{" "}
            <code className="font-mono text-[12px]">GEMMA_PASSWORD</code> before launching
            the server.
          </p>
        </Section>

        <Section title="License">
          <p>Apache 2.0.</p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-gemma-ink border-b border-gemma-grid pb-1">
        {title}
      </h2>
      <div className="text-sm text-gemma-ink leading-relaxed space-y-2">{children}</div>
    </section>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="text-[12px] font-mono bg-white border border-gemma-grid rounded p-3 overflow-x-auto text-gemma-ink leading-relaxed whitespace-pre">
      {children}
    </pre>
  );
}

function ToolGroup({
  label,
  tools,
}: {
  label: string;
  tools: { name: string; desc: string }[];
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide font-semibold text-gemma-subtle mb-1.5">
        {label}
      </div>
      <div className="bg-white border border-gemma-grid rounded divide-y divide-gemma-grid">
        {tools.map((t) => (
          <div key={t.name} className="px-3 py-2 flex gap-3">
            <code className="text-[11px] font-mono text-gemma-accent shrink-0 pt-0.5">
              {t.name}
            </code>
            <span className="text-[12px] text-gemma-subtle leading-snug">{t.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
