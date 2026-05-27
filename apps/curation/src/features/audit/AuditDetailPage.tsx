import { ToastProvider } from "@/components/ui/Toast";
import { useAuditDetail, usePatchDisposition } from "@/api/audits";
import { useMe } from "@/api/session";
import { experimentRoute, navigate } from "@/routes";
import { AuditReportView } from "./AuditReportView";
import { AppHeader } from "@/components/ui/AppHeader";

/**
 * Standalone full-page view for a single `AuditReport`, identified
 * by `audit_id`. Reachable from the audits inbox; lets a curator
 * read + disposition findings without the experiment-shell sidebar
 * narrowing the layout.
 *
 * Disposition controls PATCH the same endpoint the in-experiment
 * sidebar uses; on success the query cache for this audit_id is
 * refreshed and the buttons reflect the new state.
 *
 * "Open experiment" link drops the curator into the experiment
 * shell where the inline severity dots show — useful when they
 * want to act on a finding in-context (e.g. fix a forbidden EFC by
 * editing the factor).
 */
export function AuditDetailPage({
  auditId,
  reviewer,
}: {
  auditId: string;
  reviewer: string;
}) {
  return (
    <ToastProvider>
      <Body auditId={auditId} reviewer={reviewer} />
    </ToastProvider>
  );
}

function Body({ auditId, reviewer }: { auditId: string; reviewer: string }) {
  const { data: report, isLoading, error } = useAuditDetail(auditId);
  const me = useMe();
  const dispositionReviewer = me.data?.username ?? "";
  const patch = usePatchDisposition(report?.experiment_id ?? 0);

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50">
        <AppHeader reviewer={reviewer} />
        <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
          loading audit…
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50">
        <AppHeader reviewer={reviewer} />
        <div className="flex-1 flex items-center justify-center text-sm text-rose-700">
          couldn't load audit {auditId}: {(error as Error).message}
        </div>
      </div>
    );
  }
  if (!report) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50">
        <AppHeader reviewer={reviewer} />
        <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
          no audit at {auditId}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <AppHeader reviewer={reviewer}>
        <span className="text-xs text-slate-400 ml-2" aria-hidden>/</span>
        <a href="#/audits" className="text-sm text-slate-600 hover:text-slate-900 hover:underline">
          Audits
        </a>
        <span className="text-xs text-slate-400" aria-hidden>/</span>
        <span className="text-sm text-slate-700 font-medium">
          {report.experiment_short_name}
        </span>
        <span className="ml-1 font-mono text-[11px] text-slate-400">
          {report.audit_id}
        </span>
      </AppHeader>
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto w-full max-w-[1200px] px-4 py-1.5 flex items-center justify-end text-xs text-slate-500">
          <button
            type="button"
            className="text-blue-700 hover:underline"
            onClick={() => navigate(experimentRoute(report.experiment_id))}
            title="open this experiment with the audit sidebar visible"
          >
            open experiment →
          </button>
        </div>
      </div>
      <div className="mx-auto w-full max-w-[1200px] px-4 py-4">
        <AuditReportView
          report={report}
          onDispositionChange={async (targetId, status, notes) => {
            if (!report.audit_id) return;
            await patch.mutateAsync({
              auditId: report.audit_id,
              patch: { target_id: targetId, status, reviewer: dispositionReviewer, notes },
            });
          }}
        />
      </div>
    </div>
  );
}
