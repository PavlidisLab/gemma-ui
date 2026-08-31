import { describe, expect, it } from "vitest";
import { packPackageNames } from "./HistoryPanel";

const REAL =
  "C event on entity ubic.gemma.model.expression.experiment.ExpressionExperiment:null " +
  "[ExpressionExperiment Name=Genome-wide analysis of gene expression in brain of " +
  "Neil3-deficient Alzheimer's disease mouse model (GSE197199)] by mrafi via Object " +
  "ubic.gemma.persistence.service.BaseDao.create(Object) on Mon Jan 30 16:38:58 PST 2023";

describe("packPackageNames", () => {
  it("packs both FQNs in a real note and keeps everything else", () => {
    const out = packPackageNames(REAL);
    expect(out).toContain("u.g.m.e.e.ExpressionExperiment:null");
    expect(out).toContain("u.g.p.s.BaseDao.create(Object)");
    // The parts a curator actually reads survive untouched.
    expect(out).toContain("(GSE197199)");
    expect(out).toContain("by mrafi");
    expect(out).toContain("Mon Jan 30 16:38:58 PST 2023");
    expect(out.length).toBeLessThan(REAL.length);
  });

  it("🛑 keeps the class name whole — it is the part that means something", () => {
    expect(
      packPackageNames("ubic.gemma.model.common.auditAndSecurity.AuditEvent"),
    ).toBe("u.g.m.c.a.AuditEvent");
  });

  it("leaves prose containing dots alone", () => {
    // Fewer than two lowercase segments, so nothing matches.
    expect(packPackageNames("see e.g. Table 1")).toBe("see e.g. Table 1");
    expect(packPackageNames("Added tag organism part = brain")).toBe(
      "Added tag organism part = brain",
    );
  });

  it("is empty-safe", () => {
    expect(packPackageNames("")).toBe("");
  });
});
