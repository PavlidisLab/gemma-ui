/**
 * Top-level workflow management page. Left rail: typed group navigator.
 * Main content: experiment queue (pipeline/review groups + "all") or
 * candidate screening queue (screening groups).
 *
 * Route: #/workflow  or  #/workflow/{groupId}
 */
import { useGroup } from "@/api/workflow";
import { ExperimentQueue } from "./ExperimentQueue";
import { GroupsSidebar } from "./GroupsSidebar";
import { ScreeningQueue } from "./ScreeningQueue";

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
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950">
      <GroupsSidebar selectedGroupId={groupId} />
      <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
        {isScreening && groupId ? (
          <ScreeningQueue groupId={groupId} reviewer={reviewer} />
        ) : (
          <ExperimentQueue groupId={groupId} />
        )}
      </main>
    </div>
  );
}
