# Set navigation — UI ↔ agent coordination

Filed 2026-05-08 to sync with my brother who's wiring the agent-side
support. UI ranges from "shipped today" to "needs schema". Update
this doc as decisions land on either side.

## What's shipped

**Agent (today):**
- `GET /rest/v2/datasets/{experiment_id}/groups` — list groups this
  experiment is a member of. Optional `?type=` filter. Response is
  `list[Group]`, including `member_ids` so the UI can compute
  prev/next.

**UI (today):**
- `useExperimentGroups(experimentId)` switched from client-side
  filter over `GET /rest/v2/groups` to the new endpoint.
- Banner action row renders one chip per group, linking to
  `#/workflow/{groupId}`. Chip tone follows the group type
  (screening = slate, pipeline = blue, review = emerald). Hover
  spells out the type + member count.

## What we want next — the navigator popup

Click on a Set chip should open a popover with:

1. **Header**: set name, type pill, member count, "Open in Workflow"
   link out to the full tab view.
2. **Position indicator**: "experiment N of M" relative to the
   curator's current accession. Index lookup is from
   `Group.member_ids`.
3. **Prev / Next arrows**: keyboard-accessible (`[` / `]`?), wraps
   at ends, navigates to `#/experiments/{nextId}` directly.
4. **Member list**: scrollable, shows experiment short_name + title
   + per-experiment status pill (publication state, troubled,
   needs-attention). Click → navigate to that experiment.
5. **Search input**: top of the list, filters by short_name / title.
   Required given the user's note "Sets could be large".

## Open questions / asks for the agent side

### 1. Per-experiment metadata for the member list

`Group.member_ids` is a flat list of dataset IDs. To render the
member list with short_name + title + status, the UI needs that
metadata.

Options:

- **(a)** Surface `member_summaries: list[ExperimentSummary]` on
  `Group`, where `ExperimentSummary = {experiment_id,
  short_name, title, taxon, troubled, needs_attention,
  is_public}`. Computed at read time on the membership join.
  Cheaper for the UI; one round trip.
- **(b)** UI fetches the existing `useDatasetsPaginated` /
  workflow-bulk endpoint with the member-id list filter. Two
  round trips; shape is already on the wire. May need a new
  `?ids=1,2,3,...` query parameter on the dataset listing.
- **(c)** UI fetches each member experiment's design (existing
  `GET /rest/v2/datasets/{id}/design`). N+1; only viable for
  ≤20-member sets.

Preferred: **(a)** for the navigator — one query, cheap, exactly
the data the popup needs. **(b)** as a fallback if (a) is messy
for the storage layer.

### 2. Stable ordering within the set

For prev/next to be meaningful, members need a deterministic
order. `Group.member_ids` should already be ordered (insertion
order? alphabetical?). Confirm:

- What order does `list_groups_for_member` / `Group.member_ids`
  return today? Insertion order is fine, but the UI assumes
  whatever the agent returns is *the* order.

### 3. Optional: `?include_members=true` flag

Today `Group.member_ids` always rides on the response. If the
member list grows large (> 1000), the chip-render path doesn't
need them — only the navigator does. Adding
`?include_members=false` (or making `member_ids` optional /
`null` when not requested) lets the chip query stay light. Not
blocking; file as nice-to-have if performance becomes an issue.

## UI work plan

Rough sequencing:

1. Wait for the per-member metadata decision (Q1 above) before
   coding the member-list cell — the cell shape depends on what
   the wire returns.
2. Build the popover scaffold using fixture data so visual
   review can happen in parallel.
3. Wire it once the agent side answers Q1.
4. Add prev/next keyboard shortcuts in the same pass.

## Compatibility

`GET /rest/v2/datasets/{id}/groups` is pure-additive on the agent
side. Older UIs ignore it; newer UIs use it as a primary lookup.
No `MIN_UI_VERSION` bump.

If member_summaries (Q1 option a) lands, that's also additive on
`Group`. UIs that don't recognise the field render the chip-only
view we have today.
