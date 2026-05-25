/**
 * Top-level workflow management page. Left rail: typed group navigator.
 * Main content: experiment queue (pipeline/review groups + "all") or
 * candidate screening queue (screening groups).
 *
 * Route: #/workflow  or  #/workflow/{groupId}
 *
 * Renders the shared AppHeader on top so the curator always has a
 * way back to the dashboard — earlier versions of this page dropped
 * the header entirely, leaving deep links stranded (Paul
 * 2026-05-25).
 */
import { useGroup } from "@/api/workflow";
import { ExperimentQueue } from "./ExperimentQueue";
import { GroupsSidebar } from "./GroupsSidebar";
import { ScreeningQueue } from "./ScreeningQueue";
import { AppHeader } from "@/components/ui/AppHeader";

export function WorkflowPage({
  groupId,
  reviewer,
}: {
  groupId?: string;
  reviewer: string;
}) {
  const { data: group } = useGroup(groupId ?? null);

  const isScreening = group?.type === "screening";

  return (
    <div className="flex flex-col h-screen bg-slate-50 dark:bg-slate-950">
      <AppHeader reviewer={reviewer}>
        <span className="text-xs text-slate-400" aria-hidden>
          /
        </span>
        <span className="text-sm text-slate-600 dark:text-slate-300">
          Workflow
        </span>
        {group ? (
          <>
            <span className="text-xs text-slate-400" aria-hidden>
              /
            </span>
            <span
              className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate"
              title={group.name}
            >
              {group.name}
            </span>
          </>
        ) : null}
      </AppHeader>
      <div className="flex flex-1 min-h-0">
        <GroupsSidebar selectedGroupId={groupId} />
        <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
          {isScreening && groupId ? (
            <ScreeningQueue groupId={groupId} reviewer={reviewer} />
          ) : (
            <ExperimentQueue groupId={groupId} />
          )}
        </main>
      </div>
    </div>
  );
}
