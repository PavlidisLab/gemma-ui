import { ToastProvider } from "@/components/ui/Toast";
import { AuditReportView } from "./AuditReportView";
import sampleReport from "./fixtures/sample_audit_report.json";
import type { AuditReport } from "@/api/auditTypes";

/**
 * Dev preview surface for the audit report view. Renders the bundled
 * fixture from `gemma-curation-agents/agents/audit/fixtures` so we
 * can iterate on the UI before `/audit/*` endpoints ship.
 *
 * Navigate to ``#/audit-preview``. Not linked from the landing page
 * — this is intentionally a side door for dev work, removed once the
 * real audit inbox lands.
 */
export function AuditPreviewPage() {
  // Cast through unknown — the fixture JSON has been validated against
  // the Pydantic schema in tests/unit/test_audit_schemas.py on the
  // agents side, so the wire shape matches our TS interfaces. If
  // anything drifts, drift will surface here as a render error.
  const report = sampleReport as unknown as AuditReport;
  return (
    <ToastProvider>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <div className="border-b border-slate-200 bg-white">
          <div className="mx-auto w-full max-w-[1200px] px-4 py-2 flex items-center justify-between text-xs text-slate-500">
            <span>
              <a href="#/" className="text-blue-700 hover:underline">
                ← back
              </a>
              <span className="mx-2 text-slate-300">/</span>
              <span className="font-semibold text-slate-700">
                Audit preview
              </span>
              <span className="ml-2 italic">
                fixture-driven; no server calls
              </span>
            </span>
            <span>
              fixture:{" "}
              <code className="font-mono">
                agents/audit/fixtures/sample_audit_report.json
              </code>
            </span>
          </div>
        </div>
        <div className="mx-auto w-full max-w-[1200px] px-4 py-4">
          <AuditReportView report={report} />
        </div>
      </div>
    </ToastProvider>
  );
}
