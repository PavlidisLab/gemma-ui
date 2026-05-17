/**
 * Left-rail group navigator for the workflow page. Shows groups
 * bucketed by type (screening / pipeline / review) with an "All
 * experiments" entry at the top. Includes a "+ New group" creator.
 */
import { useCreateGroup, useDeleteGroup, useGroups } from "@/api/workflow";
import type { Group, GroupType } from "@/api/workflowTypes";
import { workflowRoute, navigate } from "@/routes";
import { useState } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

const TYPE_ORDER: GroupType[] = ["screening", "pipeline", "review"];

const TYPE_LABELS: Record<GroupType, string> = {
  screening: "Screening",
  pipeline:  "Pipeline",
  review:    "Review",
};

const TYPE_COLORS: Record<GroupType, string> = {
  screening: "text-violet-600 dark:text-violet-400",
  pipeline:  "text-sky-600 dark:text-sky-400",
  review:    "text-emerald-600 dark:text-emerald-400",
};

function NewGroupForm({
  onDone,
}: {
  onDone: () => void;
}) {
  const create = useCreateGroup();
  const [name, setName] = useState("");
  const [type, setType] = useState<GroupType>("pipeline");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      { name: name.trim(), type },
      {
        onSuccess: (g) => {
          onDone();
          navigate(workflowRoute(g.id));
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="px-3 py-2 space-y-2 border-t border-slate-200 dark:border-slate-700">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Group name"
        className="w-full text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      <select
        value={type}
        onChange={(e) => setType(e.target.value as GroupType)}
        className="w-full text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 focus:outline-none"
      >
        {TYPE_ORDER.map((t) => (
          <option key={t} value={t}>{TYPE_LABELS[t]}</option>
        ))}
      </select>
      <div className="flex gap-1">
        <button
          type="submit"
          disabled={!name.trim() || create.isPending}
          className="flex-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded px-2 py-1"
        >
          {create.isPending ? "Creating…" : "Create"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 px-2 py-1"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function GroupItem({
  group,
  selected,
  onAskDelete,
}: {
  group: Group;
  selected: boolean;
  /** Bubble the delete-trigger up so the parent can mount a single
   *  confirmation modal (vs N modals nested inside each row). */
  onAskDelete: (g: Group) => void;
}) {
  return (
    <div
      className={`group relative flex items-stretch ${
        selected ? "" : ""
      }`}
    >
      <button
        onClick={() => navigate(workflowRoute(group.id))}
        className={`flex-1 min-w-0 text-left px-3 py-1.5 text-xs rounded-l flex items-center justify-between gap-1 transition-colors ${
          selected
            ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium"
            : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50"
        }`}
      >
        <span className="truncate">{group.name}</span>
        <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
          {group.member_count}
        </span>
      </button>
      {/* Delete affordance — visible on hover only so the rail stays
          uncluttered. The full confirmation lives in the parent's
          ConfirmModal; this button just signals intent.
          Future: when groups become "tasks" with completion criteria,
          this likely splits into archive / delete depending on whether
          the task has finalised work attached — for now just a flat
          delete since groups are mutable scratchpads. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAskDelete(group);
        }}
        className={`opacity-0 group-hover:opacity-100 focus-visible:opacity-100 px-2 text-slate-400 hover:text-rose-600 dark:text-slate-500 dark:hover:text-rose-400 rounded-r transition-opacity text-[14px] leading-none ${
          selected
            ? "bg-blue-50 dark:bg-blue-900/30"
            : "hover:bg-slate-100 dark:hover:bg-slate-700/50"
        }`}
        title={`Delete "${group.name}"`}
        aria-label={`Delete group ${group.name}`}
      >
        ×
      </button>
    </div>
  );
}

export function GroupsSidebar({ selectedGroupId }: { selectedGroupId?: string }) {
  const { data: groups = [], isLoading } = useGroups();
  const [creating, setCreating] = useState(false);
  // Single confirmation-modal slot at the rail level rather than a
  // modal-per-row. ``pending`` is the group the curator clicked the
  // delete affordance on; ``null`` means no confirmation in flight.
  const [pendingDelete, setPendingDelete] = useState<Group | null>(null);
  const deleteGroup = useDeleteGroup();

  const byType = TYPE_ORDER.reduce<Record<GroupType, Group[]>>(
    (acc, t) => ({ ...acc, [t]: [] }),
    {} as Record<GroupType, Group[]>,
  );
  for (const g of groups) byType[g.type]?.push(g);

  function confirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    deleteGroup.mutate(target.id, {
      onSuccess: () => {
        setPendingDelete(null);
        // If the deleted group was the active selection, navigate
        // back to the all-experiments view so the URL doesn't keep
        // pointing at a 404 group_id.
        if (selectedGroupId === target.id) {
          navigate(workflowRoute());
        }
      },
    });
  }

  return (
    <aside className="w-52 shrink-0 border-r border-slate-200 dark:border-slate-700 flex flex-col h-full bg-white dark:bg-slate-900">
      {/* All experiments entry */}
      <div className="p-2 border-b border-slate-100 dark:border-slate-800">
        <button
          onClick={() => navigate(workflowRoute())}
          className={`w-full text-left px-3 py-1.5 text-xs rounded transition-colors font-medium ${
            !selectedGroupId
              ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
              : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50"
          }`}
        >
          All experiments
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-2 space-y-3">
        {isLoading && (
          <p className="px-3 text-xs text-slate-400 dark:text-slate-600">Loading…</p>
        )}
        {TYPE_ORDER.map((type) => {
          const items = byType[type];
          if (items.length === 0) return null;
          return (
            <div key={type}>
              <p className={`px-3 pb-0.5 text-[10px] font-semibold uppercase tracking-wide ${TYPE_COLORS[type]}`}>
                {TYPE_LABELS[type]}
              </p>
              {items.map((g) => (
                <GroupItem
                  key={g.id}
                  group={g}
                  selected={g.id === selectedGroupId}
                  onAskDelete={setPendingDelete}
                />
              ))}
            </div>
          );
        })}
      </div>

      {creating ? (
        <NewGroupForm onDone={() => setCreating(false)} />
      ) : (
        <div className="p-2 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={() => setCreating(true)}
            className="w-full text-xs text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 px-3 py-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left"
          >
            + New group
          </button>
        </div>
      )}

      <ConfirmModal
        open={!!pendingDelete}
        title="Delete group?"
        body={
          pendingDelete
            ? `Removes "${pendingDelete.name}" (${pendingDelete.type}, ` +
              `${pendingDelete.member_count} member` +
              `${pendingDelete.member_count === 1 ? "" : "s"}). The ` +
              `experiments themselves stay; only the membership is dropped.`
            : ""
        }
        confirmLabel={deleteGroup.isPending ? "deleting…" : "delete"}
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </aside>
  );
}
