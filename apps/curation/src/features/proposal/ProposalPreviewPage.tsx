import { ToastProvider } from "@/components/ui/Toast";
import { ProposalSidebarPanel } from "./ProposalSidebarPanel";
import type { Proposal } from "@/api/types";

/**
 * Dev preview surface for the new per-element proposal-review panel.
 * Hard-coded fixture; no server calls. Navigate to
 * ``#/proposal-preview``. Mirrors ``AuditPreviewPage`` — temporary
 * side door so the reviewer can iterate on the panel layout without needing
 * a live proposal in the mock DB.
 *
 * Removed once the real proposal-review flow lands and the
 * ``CurationWorkspace`` entity is the source of truth.
 */

// Cast through unknown — OntologyTerm requires `resolver` + `score`
// on every chip, which would balloon the fixture for zero render
// value. Same strategy AuditPreviewPage uses.
const FAKE_PROPOSAL_RAW = {
  proposal_id: "fake-proposal-2026-05-21",
  experiment_id: 99999,
  experiment_short_name: "GSE99999",
  submitted_by: "agent",
  submitted_at: "2026-05-21T16:00:00Z",
  model: "S2j Opus pipeline — agents 7a57b3a",
  status: "pending",
  factors: [
    {
      category: {
        label: "genotype",
        uri: "http://www.ebi.ac.uk/efo/EFO_0000513",
      },
      name_in_design: "genotype",
      factor_type: "categorical",
      baseline_relevance: "required",
      baseline_relevance_reason: "",
      factor_values: [
        {
          free_text_label: "wild type genotype",
          is_baseline: true,
          biomaterial_short_names: [
            "GSM1", "GSM2", "GSM3", "GSM4", "GSM5", "GSM6", "GSM7", "GSM8",
          ],
          statements: [
            {
              category: null,
              subject: {
                label: "wild type genotype",
                uri: "http://www.ebi.ac.uk/efo/EFO_0005168",
              },
              predicate: null,
              object: null,
            },
          ],
        },
        {
          free_text_label: "C5aR1 knockout",
          is_baseline: false,
          biomaterial_short_names: [
            "GSM9", "GSM10", "GSM11", "GSM12", "GSM13", "GSM14", "GSM15", "GSM16",
          ],
          statements: [
            {
              category: null,
              subject: {
                label: "C5aR1",
                uri: "http://identifiers.org/ncbigene/12273",
              },
              predicate: {
                label: "has-genotype",
                uri: "http://purl.obolibrary.org/obo/RO_0002200",
              },
              object: {
                label: "knockout",
                uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00007",
              },
            },
          ],
        },
      ],
    },
    {
      category: {
        label: "developmental stage",
        uri: "http://www.ebi.ac.uk/efo/EFO_0000399",
      },
      name_in_design: "developmental stage",
      factor_type: "categorical",
      baseline_relevance: "uncertain",
      baseline_relevance_reason:
        "No canonical reference timepoint; baseline picker punted.",
      factor_values: [
        {
          free_text_label: "2 month",
          is_baseline: true,
          biomaterial_short_names: ["GSM1", "GSM2", "GSM3", "GSM4"],
          statements: [],
        },
        {
          free_text_label: "5 month",
          is_baseline: false,
          biomaterial_short_names: ["GSM5", "GSM6", "GSM7", "GSM8"],
          statements: [],
        },
        {
          free_text_label: "7 month",
          is_baseline: false,
          biomaterial_short_names: ["GSM9", "GSM10", "GSM11", "GSM12"],
          statements: [],
        },
        {
          free_text_label: "10-11 month",
          is_baseline: false,
          biomaterial_short_names: ["GSM13", "GSM14", "GSM15", "GSM16"],
          statements: [],
        },
      ],
    },
    {
      category: {
        label: "treatment",
        uri: "http://www.ebi.ac.uk/efo/EFO_0000727",
      },
      name_in_design: "treatment",
      factor_type: "continuous",
      baseline_relevance: "not_applicable",
      baseline_relevance_reason: "Continuous factor.",
      factor_values: [
        {
          free_text_label: "0.5",
          is_baseline: false,
          biomaterial_short_names: ["GSM1", "GSM5"],
          statements: [],
        },
        {
          free_text_label: "1.0",
          is_baseline: false,
          biomaterial_short_names: ["GSM2", "GSM6"],
          statements: [],
        },
        {
          free_text_label: "2.0",
          is_baseline: false,
          biomaterial_short_names: ["GSM3", "GSM7"],
          statements: [],
        },
        {
          free_text_label: "5.0",
          is_baseline: false,
          biomaterial_short_names: ["GSM4", "GSM8"],
          statements: [],
        },
      ],
    },
  ],
  tags: [
    {
      category: {
        label: "disease",
        uri: "http://purl.obolibrary.org/obo/MONDO_0000001",
      },
      value: {
        label: "Alzheimer disease",
        uri: "http://purl.obolibrary.org/obo/MONDO_0004975",
      },
      evidence_quote:
        "The study uses Arctic AD mouse models (APP knock-in) as the primary experimental system, making Alzheimer disease the central disease model being studied.",
      confidence: "high",
      badge: "gold",
    },
    {
      category: {
        label: "cell type",
        uri: "http://www.ebi.ac.uk/efo/EFO_0000324",
      },
      value: {
        label: "microglial cell",
        uri: "http://purl.obolibrary.org/obo/CL_0000129",
      },
      evidence_quote:
        "Role of microglial C5aR1 in the Arctic AD mouse model — microglia are the principal cell type studied.",
      confidence: "high",
      badge: "platinum",
    },
    {
      category: {
        label: "organism",
        uri: "http://purl.obolibrary.org/obo/NCBITaxon_1",
      },
      value: {
        label: "Mus musculus",
        uri: "http://purl.obolibrary.org/obo/NCBITaxon_10090",
      },
      evidence_quote: "mouse model",
      confidence: "high",
    },
  ],
  evidence: {
    paper_sources: [],
    subtask_decisions: [],
    debate_log: null,
  },
};
const FAKE_PROPOSAL = FAKE_PROPOSAL_RAW as unknown as Proposal;

export function ProposalPreviewPage() {
  return (
    <ToastProvider>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="border-b border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-700">
          <div className="mx-auto w-full max-w-[800px] px-4 py-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>
              <a href="#/" className="text-blue-700 hover:underline">
                ← back
              </a>
              <span className="mx-2 text-slate-300 dark:text-slate-600">
                /
              </span>
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                Proposal review preview
              </span>
              <span className="ml-2 italic">
                fixture-driven; no server calls
              </span>
            </span>
            <span>
              fixture:{" "}
              <code className="font-mono">
                GSE99999 — 3 factors, 3 tags
              </code>
            </span>
          </div>
        </div>
        <div className="mx-auto w-full max-w-[800px] px-4 py-4">
          <ProposalSidebarPanel proposal={FAKE_PROPOSAL} />
        </div>
      </div>
    </ToastProvider>
  );
}
