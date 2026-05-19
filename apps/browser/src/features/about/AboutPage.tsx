// Static About / contact page for the Gemma public browser.
// Content mirrors the existing gemma.msl.ubc.ca About dialog and
// the terms/conditions at https://pavlidislab.github.io/Gemma/terms.html

export function AboutPage() {
  return (
    <div className="h-full overflow-y-auto bg-gemma-bg">
      <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-gemma-ink">
            About Gemma
          </h1>
          <p className="mt-2 text-sm text-gemma-ink leading-relaxed">
            Gemma is a web site, database and a set of tools for the meta-analysis,
            re-use and sharing of gene expression profiling data. Gemma contains data
            from thousands of public studies, referencing thousands of published papers.
            Users can search, access and visualize the data and differential expression
            results. For more information, see the{" "}
            <a
              href="https://pavlidislab.github.io/Gemma/"
              target="_blank"
              rel="noreferrer"
              className="text-gemma-accent hover:underline"
            >
              help and documentation ↗
            </a>.
          </p>
          <p className="mt-2 text-sm text-gemma-ink">
            Gemma was developed by the Pavlidis group at UBC (
            <a
              href="https://pavlidislab.github.io/Gemma/credits.html"
              target="_blank"
              rel="noreferrer"
              className="text-gemma-accent hover:underline"
            >
              credits ↗
            </a>
            ).
          </p>
        </header>

        <Section title="How to cite">
          <p>To cite Gemma, please use:</p>
          <blockquote className="border-l-2 border-gemma-grid pl-4 text-gemma-ink text-sm">
            Lim N., et al., Curation of over 10,000 transcriptomic studies to enable data
            reuse. <em>Database</em>, 2021.{" "}
            <a
              href="https://doi.org/10.1093/database/baab006"
              target="_blank"
              rel="noreferrer"
              className="text-gemma-accent hover:underline"
            >
              link ↗
            </a>
          </blockquote>
        </Section>

        <Section title="Genome and annotation sources">
          <p>
            Gemma's expression platform and gene annotations are powered by:
          </p>
          <div className="space-y-4 mt-2">
            <GenomeSource
              id="hg38"
              label="Genome Reference Consortium Human GRCh38.p13 (GCA_000001405.28)"
              assemblyHref="https://www.ncbi.nlm.nih.gov/datasets/genome/GCF_000001405.39/"
              release="GRCh38.p13"
              releaseHref="https://www.ncbi.nlm.nih.gov/datasets/genome/GCF_000001405.39/"
              lastUpdated="6/30/2022"
              annotations={[
                { label: "hg38 annotations", version: "GRCh38.p13", versionHref: "https://ftp.ncbi.nlm.nih.gov/genomes/all/GCA/000/001/405/GCA_000001405.28_GRCh38.p13/", updated: "6/30/2022", linkHref: "https://ftp.ncbi.nlm.nih.gov/genomes/all/GCA/000/001/405/GCA_000001405.28_GRCh38.p13/" },
                { label: "hg38 RNA-Seq annotations", version: "110", versionHref: "https://ftp.ensembl.org/pub/release-110/", updated: "1/17/2023", linkHref: "https://ftp.ensembl.org/pub/release-110/" },
              ]}
            />
            <GenomeSource
              id="mm39"
              label="Genome Reference Consortium Mouse Build 39 (GCA_000001635.9) GRCm39"
              assemblyHref="https://www.ncbi.nlm.nih.gov/datasets/genome/GCF_000001635.9/"
              release="GRCm39"
              releaseHref="https://www.ncbi.nlm.nih.gov/datasets/genome/GCF_000001635.9/"
              lastUpdated="6/30/2022"
              annotations={[
                { label: "mm39 annotations", version: "GRCm39", versionHref: "https://ftp.ncbi.nlm.nih.gov/genomes/all/GCA/000/001/635/GCA_000001635.9_GRCm39/", updated: "6/30/2022", linkHref: "https://ftp.ncbi.nlm.nih.gov/genomes/all/GCA/000/001/635/GCA_000001635.9_GRCm39/" },
                { label: "mm39 RNA-Seq annotations", version: "109", versionHref: "https://ftp.ensembl.org/pub/release-109/", updated: "1/17/2023", linkHref: "https://ftp.ensembl.org/pub/release-109/" },
              ]}
            />
            <GenomeSource
              id="rn7"
              label="Wellcome Sanger Institute mRatBN7.2"
              assemblyHref="https://www.ncbi.nlm.nih.gov/datasets/genome/GCF_015227675.2/"
              release="mRatBN7.2"
              releaseHref="https://www.ncbi.nlm.nih.gov/datasets/genome/GCF_015227675.2/"
              lastUpdated="6/30/2022"
              annotations={[
                { label: "rn7 annotations", version: "mRatBN7.2", versionHref: "https://ftp.ncbi.nlm.nih.gov/genomes/all/GCF/015/227/675/GCF_015227675.2_mRatBN7.2/", updated: "6/30/2022", linkHref: "https://ftp.ncbi.nlm.nih.gov/genomes/all/GCF/015/227/675/GCF_015227675.2_mRatBN7.2/" },
                { label: "rn7 RNA-Seq annotations", version: "108", versionHref: "https://ftp.ensembl.org/pub/release-108/", updated: "1/13/2023", linkHref: "https://ftp.ensembl.org/pub/release-108/" },
              ]}
            />
            <OtherSource
              id="Gene"
              label="NCBI Gene"
              href="https://www.ncbi.nlm.nih.gov/gene"
              updated="9/28/2023"
            />
            <OtherSource
              id="Go"
              label="GO terms (from NCBI Gene)"
              href="https://geneontology.org"
              updated="5/4/2024"
            />
          </div>
        </Section>

        <Section title="Programmatic access">
          <p>
            Gemma exposes a full REST API at{" "}
            <code className="text-[12px] px-1 py-0.5 rounded bg-gemma-bg border border-gemma-grid font-mono text-gemma-ink">
              /rest/v2/
            </code>.
          </p>
          <div className="grid sm:grid-cols-2 gap-3 mt-3">
            <APICard
              name="REST API docs"
              blurb="Interactive Swagger UI for all endpoints."
              href="https://gemma.msl.ubc.ca/resources/restapidocs/"
            />
            <APICard
              name="gemma.R"
              blurb="Bioconductor R package for programmatic access."
              href="https://bioconductor.org/packages/gemma.R"
            />
            <APICard
              name="gemmapy"
              blurb="Python package wrapping the Gemma REST API."
              href="https://pypi.org/project/gemmapy/"
            />
            <APICard
              name="gemma-mcp"
              blurb="MCP server — lets Claude search Gemma, fetch expression, and run DE."
              href="https://github.com/PavlidisLab/gemma-mcp"
              internal="/mcp"
            />
          </div>
        </Section>

        <Section title="Licenses">
          <div className="space-y-2">
            <LicenseRow
              subject="Source code"
              license="Apache 2.0"
              href="https://www.apache.org/licenses/LICENSE-2.0"
            />
            <LicenseRow
              subject="Gene expression data"
              license="Original provider's license; GEO data is unrestricted by default. Otherwise CC BY."
              href="https://creativecommons.org/licenses/by/4.0/"
            />
            <LicenseRow
              subject="Annotations & analysis results"
              license="CC BY-NC. Commercial use requires contacting Gemma."
              href="https://creativecommons.org/licenses/by-nc/4.0/"
            />
          </div>
          <p className="text-xs text-gemma-subtle mt-3">
            Full terms:{" "}
            <a
              href="https://pavlidislab.github.io/Gemma/terms.html"
              target="_blank"
              rel="noreferrer"
              className="text-gemma-accent hover:underline"
            >
              pavlidislab.github.io/Gemma/terms.html ↗
            </a>
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Gemma is developed and maintained by the{" "}
            <a
              href="https://pavlab.msl.ubc.ca"
              target="_blank"
              rel="noreferrer"
              className="text-gemma-accent hover:underline"
            >
              Pavlidis Lab ↗
            </a>{" "}
            at the Michael Smith Laboratories and Department of Psychiatry,
            University of British Columbia, Vancouver, Canada.
          </p>
          <div className="flex flex-wrap gap-3 mt-3">
            <ContactLink label="Lab website" href="https://pavlab.msl.ubc.ca" />
            <ContactLink label="GitHub" href="https://github.com/PavlidisLab" />
            <ContactLink label="Email" href="mailto:pavlab-info@msl.ubc.ca" />
          </div>
        </Section>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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

function GenomeSource({
  id,
  label,
  assemblyHref,
  release,
  releaseHref,
  lastUpdated,
  annotations,
}: {
  id: string;
  label: string;
  assemblyHref: string;
  release: string;
  releaseHref: string;
  lastUpdated: string;
  annotations: { label: string; version: string; versionHref: string; updated: string; linkHref: string }[];
}) {
  return (
    <div className="bg-white border border-gemma-grid rounded p-3 space-y-1">
      <div className="font-semibold text-gemma-ink text-sm">
        {id}
      </div>
      <div className="text-[12px] text-gemma-subtle pl-3 space-y-0.5">
        <div>
          {label}{" "}
          <a href={assemblyHref} target="_blank" rel="noreferrer" className="text-gemma-accent hover:underline">
            link ↗
          </a>
        </div>
        <div>
          Release used:{" "}
          <a href={releaseHref} target="_blank" rel="noreferrer" className="text-gemma-accent hover:underline">
            {release}
          </a>
          .
        </div>
        <div>Last updated on {lastUpdated}.</div>
        {annotations.map((a) => (
          <div key={a.label}>
            {a.label}{" "}
            <a href={a.versionHref} target="_blank" rel="noreferrer" className="text-gemma-accent hover:underline">
              {a.version}
            </a>{" "}
            last updated on {a.updated}.{" "}
            <a href={a.linkHref} target="_blank" rel="noreferrer" className="text-gemma-accent hover:underline">
              link ↗
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}

function OtherSource({
  id,
  label,
  href,
  updated,
}: {
  id: string;
  label: string;
  href: string;
  updated: string;
}) {
  return (
    <div className="bg-white border border-gemma-grid rounded p-3 space-y-0.5">
      <div className="font-semibold text-gemma-ink text-sm">{id}</div>
      <div className="text-[12px] text-gemma-subtle pl-3">
        <a href={href} target="_blank" rel="noreferrer" className="text-gemma-accent hover:underline">
          {label} ↗
        </a>
        <span className="ml-2">Last updated on {updated}.</span>
      </div>
    </div>
  );
}

function LicenseRow({
  subject,
  license,
  href,
}: {
  subject: string;
  license: string;
  href: string;
}) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="text-gemma-subtle w-44 shrink-0">{subject}</span>
      <span>
        <a href={href} target="_blank" rel="noreferrer" className="text-gemma-accent hover:underline">
          {license} ↗
        </a>
      </span>
    </div>
  );
}

function APICard({
  name,
  blurb,
  href,
  internal,
}: {
  name: string;
  blurb: string;
  href: string;
  internal?: string;
}) {
  return (
    <a
      href={internal ?? href}
      target={internal ? undefined : "_blank"}
      rel={internal ? undefined : "noreferrer"}
      className="block bg-white border border-gemma-grid rounded-md p-4 hover:border-gemma-accent/50 transition-colors"
    >
      <div className="text-sm font-semibold text-gemma-ink">{name} ↗</div>
      <div className="text-xs text-gemma-subtle mt-0.5">{blurb}</div>
    </a>
  );
}

function ContactLink({ label, href }: { label: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-sm px-3 py-1.5 rounded border border-gemma-grid bg-white text-gemma-ink hover:border-gemma-accent/50 hover:text-gemma-accent transition-colors"
    >
      {label} ↗
    </a>
  );
}
