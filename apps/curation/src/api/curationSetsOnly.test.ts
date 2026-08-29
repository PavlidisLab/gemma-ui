/**
 * Gemma's own groups must never render as curation sets.
 *
 * `/rest/v2/groups` and `/rest/v2/datasets/{id}/groups` are real Gemma
 * routes serving USER groups and a dataset's ACL groups. Curation sets
 * answer the same paths on the store, so in remote mode Gemma's answer
 * arrives where a `Group[]` is expected. Both live shapes are pinned
 * here, verbatim off gemma2 on 2026-08-29.
 */
import { describe, expect, it } from "vitest";

import { curationSetsOnly } from "./workflow";

describe("curationSetsOnly", () => {
  it("drops the dataset ACL groups, which arrive as bare strings", () => {
    // GET /rest/v2/datasets/861/groups → {"data":["Agents","Administrators"]}
    // Rendered as sets, these produced a chip with no label and the
    // tooltip "undefined · undefined · undefined members".
    expect(curationSetsOnly(["Agents", "Administrators"])).toEqual([]);
  });

  it("🛑 drops Gemma's USER groups, which look like plausible sets", () => {
    // GET /rest/v2/groups → objects carrying id, name and memberCount.
    // `memberCount` snakeifies to `member_count`, so this would have
    // rendered as "Administrators · 14 members" — wrong, and with
    // nothing about it that looks wrong.
    expect(
      curationSetsOnly([
        {
          id: 1,
          name: "Administrators",
          description: "Users with administrative rights",
          member_count: 14,
        },
        { id: 3, name: "Agents", description: null, member_count: 1 },
      ]),
    ).toEqual([]);
  });

  it("keeps a real curation set", () => {
    const set = {
      id: "grp_01",
      name: "August triage",
      type: "triage",
      member_ids: ["1", "2"],
      member_count: 2,
    };
    expect(curationSetsOnly([set])).toEqual([set]);
  });

  it("survives a non-array answer rather than throwing mid-render", () => {
    expect(curationSetsOnly(null)).toEqual([]);
    expect(curationSetsOnly({ data: [] })).toEqual([]);
    expect(curationSetsOnly(undefined)).toEqual([]);
  });
});
