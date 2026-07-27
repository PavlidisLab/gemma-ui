/**
 * Left-rail group navigator for the workflow page. Shows groups
 * bucketed by type (screening / pipeline / review) with an "All
 * experiments" entry at the top. Includes a "+ New group" creator.
 */
import { useCreateGroup, useDeleteGroup, useGroup, useGroups } from "@/api/workflow";
import type { Group, GroupType } from "@/api/workflowTypes";
import { workflowRoute, navigate } from "@/routes";
import { useMemo, useState } from "react";
import { progressFromGroup, hasOpenTasks } from "./setProgress";
import { readDirtyExperimentIds } from "@/features/design/draftCache";
import { cn } from "@/lib/cn";

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
  const { data: groupsRaw, isLoading } = useGroups();
  // Defensive: the wire-shape can drift (e.g. Gemma 2.0's envelope
  // not yet unwrapped, or an error body slipping through). Treat
  // anything that isn't an array as "no groups" rather than crashing
  // the whole workflow page with "groups is not iterable".
  const groups: Group[] = Array.isArray(groupsRaw) ? groupsRaw : [];
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

      {pendingDelete ? (
        <DeleteSetDialog
          group={pendingDelete}
          saving={deleteGroup.isPending}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </aside>
  );
}

/** Delete-confirmation dialog with an open-tasks safety gate.
 *
 *  Per design review 2026-05-25: "sets representing tasks/tickets should
 *  not be deletable until the tasks are closed, or the user
 *  overrides. The entire set can be finalized and then exported."
 *
 *  Today we don't have a set-level ``finalized_at`` field
 *  (handoff filed); the gate is open-tasks based instead. When
 *  every member is done, the dialog is a plain confirm. When any
 *  member is in_progress or untouched, the curator must tick an
 *  explicit override checkbox before "delete" enables. */
function DeleteSetDialog({
  group,
  saving,
  onCancel,
  onConfirm,
}: {
  group: Group;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Fetch the full Group payload so we get the server-aggregated
  // ``member_status_counts`` + ``finalized_at`` flag. One round-
  // trip on delete click; no per-member iteration on the client.
  const { data: hydrated, isLoading } = useGroup(group.id, {
    includeSummaries: true,
  });
  const dirtyDraftIds = useMemo(() => readDirtyExperimentIds(), []);
  const counts = useMemo(
    () => progressFromGroup(hydrated ?? group, dirtyDraftIds),
    [hydrated, group, dirtyDraftIds],
  );
  const isFinalized = !!(hydrated?.finalized_at ?? group.finalized_at);
  const openTasks = counts.in_progress + counts.untouched;
  // Override only required when the set isn't finalized AND has
  // open work. Finalizing the set IS the explicit "I'm done with
  // this grouping" gate — once that's stamped, delete is safe to
  // run without a second checkbox. Per design review 2026-05-25.
  const needsOverride = !isLoading && !isFinalized && hasOpenTasks(counts);
  const [override, setOverride] = useState(false);
  const canConfirm = !needsOverride || override;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onCancel();
      }}
    >
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 w-full max-w-md p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          Delete set?
        </h2>
        <p className="text-sm text-slate-700 dark:text-slate-300">
          Removes <span className="font-medium">"{group.name}"</span>{" "}
          ({group.type}, {group.member_count} member
          {group.member_count === 1 ? "" : "s"}). The experiments
          themselves stay; only the set membership is dropped.
        </p>
        {isLoading ? (
          <p className="text-xs text-slate-500 italic">
            checking set state…
          </p>
        ) : isFinalized ? (
          <p className="text-xs text-emerald-700 dark:text-emerald-400">
            ✓ Set is finalized — safe to delete.
          </p>
        ) : needsOverride ? (
          <div className="rounded border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20 p-2.5 space-y-2 text-xs text-amber-900 dark:text-amber-100">
            <p>
              <span className="font-semibold">
                {openTasks} of {group.member_count} task
                {openTasks === 1 ? "" : "s"} not yet done.
              </span>{" "}
              Finalize the set first to record "I'm done with this
              grouping" — or check the box below to delete anyway.
            </p>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={override}
                onChange={(e) => setOverride(e.target.checked)}
                disabled={saving}
                className="mt-0.5"
              />
              <span>
                Delete without finalizing — I'll lose the set
                membership but not the per-experiment work.
              </span>
            </label>
          </div>
        ) : (
          <p className="text-xs text-emerald-700 dark:text-emerald-400">
            ✓ All tasks done — safe to delete.
          </p>
        )}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="text-xs px-3 py-1 rounded text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving || !canConfirm}
            className={cn(
              "text-xs px-3 py-1 rounded font-semibold",
              !canConfirm
                ? "bg-slate-200 text-slate-500 cursor-not-allowed dark:bg-slate-800 dark:text-slate-500"
                : saving
                  ? "bg-rose-200 text-rose-700 cursor-progress dark:bg-rose-900/40 dark:text-rose-200"
                  : "bg-rose-600 text-white hover:bg-rose-700",
            )}
          >
            {saving ? "deleting…" : "delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
