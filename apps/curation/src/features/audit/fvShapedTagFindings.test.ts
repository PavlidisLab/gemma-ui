import { describe, expect, it } from "vitest";
import type { AuditFinding } from "@/api/auditTypes";
import type { Design } from "@/features/experiment/types";
import {
  fvShapedTagTargets,
  partitionFvShapedTagFindings,
} from "./auditPresentation";

// A tag-target finding whose (category, value) pair is really a FACTOR
// VALUE gets hidden — tags and factor values are different entity
// types, so a REMOVE TAG card for a factor value is a card about
// something that isn't there. The counts in the headers have to be
// taken from the SAME partition the body renders: a panel announcing
// "2 findings — 2 proposals" over one visible card sends the curator
// looking for a card that will never appear.

function design(): Design {
  return {
    experiment_id: 9909,
    experiment_short_name: "GSE9909",
    biomaterials: [],
    tags: [],
    factors: [
      {
        id: 1,
        name: "disease model",
        category: { label: "disease model", uri: null },
        description: "",
        type: "categorical",
        factor_values: [
          {
            id: 1,
            free_text_label: "retinitis pigmentosa",
            is_baseline: false,
            biomaterial_short_names: [],
            statements: [],
          },
          {
            id: 2,
            free_text_label: "control",
            is_baseline: true,
            biomaterial_short_names: [],
            statements: [
              {
                category: null,
                subject: { label: "reference subject role", uri: null },
              },
            ],
          },
        ],
      },
    ],
  };
}

function finding(targetId: string, kind: "tag" | "factor"): AuditFinding {
  return {
    target_id: targetId,
    target_kind: kind,
    severity: "minor",
    issue_code: "x",
    message: "m",
  } as AuditFinding;
}

describe("fvShapedTagTargets", () => {
  it("covers the FV label and its statement terms", () => {
    const t = fvShapedTagTargets(design());
    expect(t.has("tag:disease-model/retinitis-pigmentosa")).toBe(true);
    // Statement subject too — the upstream "tag" is sometimes the term
    // behind the FV rather than its free-text label.
    expect(t.has("tag:disease-model/reference-subject-role")).toBe(true);
    expect(t.has("tag:disease-model/glaucoma")).toBe(false);
  });

  it("is empty for a null design rather than throwing", () => {
    expect(fvShapedTagTargets(null).size).toBe(0);
  });
});

describe("partitionFvShapedTagFindings", () => {
  it("hides the FV-shaped tag finding and keeps the rest", () => {
    const { visible, hidden } = partitionFvShapedTagFindings(
      [
        finding("tag:disease-model/retinitis-pigmentosa", "tag"),
        finding("tag:developmental-stage/prime-adult-stage", "tag"),
      ],
      design(),
    );
    expect(hidden.map((f) => f.target_id)).toEqual([
      "tag:disease-model/retinitis-pigmentosa",
    ]);
    expect(visible.map((f) => f.target_id)).toEqual([
      "tag:developmental-stage/prime-adult-stage",
    ]);
  });

  it("the two halves account for every finding — nothing is dropped", () => {
    // The caption reports the hidden count, so a finding that fell out
    // of both halves would vanish without a trace.
    const all = [
      finding("tag:disease-model/retinitis-pigmentosa", "tag"),
      finding("tag:developmental-stage/prime-adult-stage", "tag"),
      finding("factor:disease-model", "factor"),
    ];
    const { visible, hidden } = partitionFvShapedTagFindings(all, design());
    expect(visible.length + hidden.length).toBe(all.length);
  });

  it("only tag-kind findings are hidden — a factor finding on the same slug stays", () => {
    const { visible, hidden } = partitionFvShapedTagFindings(
      [finding("tag:disease-model/retinitis-pigmentosa", "factor")],
      design(),
    );
    expect(hidden).toHaveLength(0);
    expect(visible).toHaveLength(1);
  });

  it("hides nothing when the design hasn't loaded", () => {
    const all = [finding("tag:disease-model/retinitis-pigmentosa", "tag")];
    const { visible, hidden } = partitionFvShapedTagFindings(all, null);
    expect(hidden).toHaveLength(0);
    expect(visible).toHaveLength(1);
  });
});
