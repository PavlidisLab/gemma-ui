import { describe, expect, it } from "vitest";
import { materializedRecoveryToasts } from "./materializedToast";
import type { MaterializedAction } from "@/api/auditTypes";

describe("materializedRecoveryToasts", () => {
  it("returns [] when nothing was materialized (healthy path)", () => {
    expect(materializedRecoveryToasts([])).toEqual([]);
  });

  it("untagged actions are treated as reviewer drops → single warn toast", () => {
    // Legacy reviewer-only shape (no source stamp).
    const recovered: MaterializedAction[] = [
      { kind: "add_tag", target_id: "tag:disease/hand", detail: "disease: HAND" },
    ];
    const [t, ...rest] = materializedRecoveryToasts(recovered);
    expect(rest).toEqual([]);
    expect(t.tone).toBe("warn");
    expect(t.message).toContain("recovered 1 accepted change ");
    expect(t.message).not.toContain("changes");
    expect(t.message).toContain("disease: HAND");
    expect(t.message).toContain("Your decisions are saved");
  });

  it("gold-source actions → quiet info confirmation, not a warn", () => {
    const recovered: MaterializedAction[] = [
      { kind: "add_tag", target_id: "t1", detail: "disease: HAND", source: "gold" },
      { kind: "remove_factor", target_id: "f1", detail: "factor batch", source: "gold" },
    ];
    const toasts = materializedRecoveryToasts(recovered);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].tone).toBe("info");
    expect(toasts[0].message).toContain("2 accepted decisions recorded to gold");
    expect(toasts[0].message).toContain("disease: HAND, factor batch");
  });

  it("mixed sources → two toasts, warn (drops) + info (gold), each scoped", () => {
    const recovered: MaterializedAction[] = [
      { kind: "add_tag", target_id: "d1", detail: "cell type: neuron", source: "reviewer" },
      { kind: "add_factor", target_id: "g1", detail: "factor treatment", source: "gold" },
      { kind: "remove_tag", target_id: "g2", detail: "disease: X", source: "gold" },
    ];
    const toasts = materializedRecoveryToasts(recovered);
    expect(toasts).toHaveLength(2);
    const warn = toasts.find((t) => t.tone === "warn")!;
    const info = toasts.find((t) => t.tone === "info")!;
    // Warn scopes to ONLY the reviewer drop.
    expect(warn.message).toContain("recovered 1 accepted change ");
    expect(warn.message).toContain("cell type: neuron");
    expect(warn.message).not.toContain("factor treatment");
    // Info scopes to ONLY the gold writes.
    expect(info.message).toContain("2 accepted decisions recorded to gold");
    expect(info.message).toContain("factor treatment, disease: X");
    expect(info.message).not.toContain("cell type: neuron");
  });

  it("falls back to the action kind when detail is blank", () => {
    const recovered: MaterializedAction[] = [
      { kind: "remove_tag", target_id: "t1", detail: "   " },
      { kind: "rename_fv", target_id: "f1" },
    ];
    const [t] = materializedRecoveryToasts(recovered);
    expect(t.message).toContain("remove_tag, rename_fv");
  });
});
