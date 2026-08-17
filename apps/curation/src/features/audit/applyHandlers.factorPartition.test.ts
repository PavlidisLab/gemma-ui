/**
 * Apply-chain contract tests for the two FACTOR-level calibration
 * branches that `applyHandlers.test.ts` doesn't reach:
 *
 *   - ``calibration_factor_partition_mismatch`` — agent and gold agree on
 *     the category but disagree on the FV breakdown. Adopt-shaped:
 *     replace gold's partition with the agent's.
 *   - ``calibration_factor_gold_only_miss`` — remove the gold factor the
 *     agent didn't propose.
 *
 * Both are mutating paths, so a silent no-op here reads to the curator
 * as "I clicked Agree and nothing happened" — the exact class of bug
 * the partition_mismatch branch was added to fix (it had been
 * disposition-PATCHing without ever routing through a mutator).
 *
 * Kept in its own file so the long-standing `applyHandlers.test.ts`
 * stays focused on the tag/rename/misbinding shapes it was written for.
 */
import { describe, expect, it } from "vitest";
import type { AuditFinding, AuditReport } from "@/api/auditTypes";
import type { OntologyTerm as WireTerm } from "@/api/types";
import type {
  Design,
  Factor,
  FactorValue,
  OntologyTerm,
} from "@/features/experiment/types";
import { resolveApplyAction } from "./applyHandlers";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function term(label: string, uri: string | null = null): OntologyTerm {
  return { label, uri };
}

/** Wire-side term. ``api/types``' OntologyTerm carries the resolver +
 *  score the design-side one omits; FactorRef / FvPair use that shape. */
function wireTerm(label: string, uri: string | null = null): WireTerm {
  return { label, uri, resolver: null, score: null };
}

/** Design-side factor value. ``bms`` is the biomaterial set, which is
 *  half of the FV signature the idempotency check compares on. */
function fv(id: number, label: string, bms: string[] = []): FactorValue {
  return {
    id,
    free_text_label: label,
    is_baseline: false,
    biomaterial_short_names: bms,
    statements: [{ subject: term(label) }],
  };
}

function factor(id: number, categoryLabel: string, fvs: FactorValue[]): Factor {
  return {
    id,
    name: categoryLabel,
    category: term(categoryLabel),
    description: "",
    type: "categorical",
    factor_values: fvs,
  };
}

function design(factors: Factor[]): Design {
  return {
    experiment_id: 1,
    experiment_short_name: "GSE-test",
    factors,
    biomaterials: [],
    tags: [],
  };
}

/** Proposal-side factor value (the agent's shape — no ids). */
function pfv(label: string, bms: string[] = []) {
  return {
    free_text_label: label,
    is_baseline: false,
    statements: [{ subject: term(label) }],
    biomaterial_short_names: bms,
  };
}

function proposalFactor(
  categoryLabel: string,
  fvs: ReturnType<typeof pfv>[],
) {
  return {
    category: wireTerm(categoryLabel),
    name_in_design: categoryLabel,
    factor_type: "categorical",
    factor_values: fvs,
  };
}

/** Minimal AuditReport carrying a comparison_proposal. */
function report(factors: ReturnType<typeof proposalFactor>[]): AuditReport {
  return {
    audit_id: "a1",
    experiment_id: 1,
    experiment_short_name: "GSE-test",
    audited_at: "",
    model: null,
    scope: { include: [] },
    findings: [],
    evidence: {
      preboarding_excerpt: "",
      paper_source: null,
      paper_excerpt: "",
      comparison_proposal: { factors, tags: [] },
    },
    summary: {
      n_blocker: 0,
      n_major: 0,
      n_minor: 0,
      n_ok: 0,
      overall_verdict: "passes",
    },
    dispositions: [],
  } as unknown as AuditReport;
}

function finding(partial: Partial<AuditFinding>): AuditFinding {
  return {
    target_kind: "factor",
    target_id: "",
    severity: "minor",
    issue_code: "calibration_factor_partition_mismatch",
    rationale: "",
    citation: "",
    citation_url: "",
    suggested_fix: "",
    proposer_suggestion: "",
    ...partial,
  } as AuditFinding;
}

/** When a calibration branch declines to build a mutator, the chain
 *  must still hand back a safe non-mutating action — a finding card
 *  that dead-ends leaves the curator with nothing to click. Assert the
 *  fallback rather than a bare null. */
function expectFocusOnly(action: ReturnType<typeof resolveApplyAction>): void {
  expect(action).not.toBeNull();
  expect(action?.mutates).toBe(false);
  expect(action?.mutate).toBeUndefined();
}

/** partition_mismatch finding with the agent/gold category pair set.
 *  ``goldCategory`` defaults to ``category`` — the two sides agreeing
 *  on the category is the common case, but NOT the universal one: a
 *  repartition often arrives with a recategorization (16 of the 100
 *  partition_mismatch findings in the local store), and that is the
 *  variant that used to silently no-op. Pass it explicitly to cover
 *  the divergent shape. */
function pmFinding(opts: {
  category: string;
  goldCategory?: string;
  direction: "agent_finer" | "agent_coarser" | "cross_cutting";
  crossCuttingGolds?: number;
  agentIndex?: number | null;
}): AuditFinding {
  return finding({
    target_id: `factor:${opts.goldCategory ?? opts.category}`,
    issue_code: "calibration_factor_partition_mismatch",
    agent_target_index: opts.agentIndex ?? 0,
    partition_mismatch: {
      agent: { category: wireTerm(opts.category) },
      gold: { category: wireTerm(opts.goldCategory ?? opts.category) },
      direction: opts.direction,
      fv_pairs: [],
      ...(opts.crossCuttingGolds !== undefined
        ? {
            cross_cutting_golds: Array.from(
              { length: opts.crossCuttingGolds },
              () => ({ category: wireTerm(opts.category) }),
            ),
          }
        : {}),
    },
  } as Partial<AuditFinding>);
}

// ---------------------------------------------------------------------------
// calibration_factor_partition_mismatch
// ---------------------------------------------------------------------------

describe("resolveApplyAction — FACTOR PARTITION MISMATCH", () => {
  it("falls back to focus-only when the finding carries no partition_mismatch payload", () => {
    const d = design([factor(1, "organism part", [fv(10, "liver")])]);
    const f = finding({
      issue_code: "calibration_factor_partition_mismatch",
      target_id: "factor:organism-part",
    });

    expectFocusOnly(resolveApplyAction(f, { design: d, report: report([]) }));
  });

  it("declines a genuine cross-cutting mismatch (more than one gold spanned)", () => {
    // Not a single-factor replace — the curator disambiguates in the
    // dedicated card body instead.
    const d = design([factor(1, "population", [fv(10, "YRI", ["S1"])])]);
    const f = pmFinding({
      category: "population",
      direction: "cross_cutting",
      crossCuttingGolds: 2,
    });
    const r = report([proposalFactor("population", [pfv("YRI", ["S1"])])]);

    expectFocusOnly(resolveApplyAction(f, { design: d, report: r }));
  });

  it("treats a degenerate cross-cutting (one gold spanned) as a normal adopt", () => {
    // The agent labelled it cross_cutting only because no FV pair hit
    // Jaccard >= 0.8; with a single gold in scope adopt is still safe.
    const d = design([
      factor(1, "population", [fv(10, "YRI", ["S1", "S2"])]),
    ]);
    const f = pmFinding({
      category: "population",
      direction: "cross_cutting",
      crossCuttingGolds: 1,
    });
    const r = report([
      proposalFactor("population", [pfv("YRI", ["S1"]), pfv("CHB", ["S2"])]),
    ]);

    const action = resolveApplyAction(f, { design: d, report: r });
    expect(action?.mutates).toBe(true);
  });

  it("falls back to focus-only when the agent factor cannot be resolved", () => {
    const d = design([factor(1, "organism part", [fv(10, "liver")])]);
    const f = pmFinding({ category: "organism part", direction: "agent_finer" });
    // Empty comparison proposal — nothing to adopt.
    expectFocusOnly(resolveApplyAction(f, { design: d, report: report([]) }));
  });

  it("offers a non-mutating disposition when the factor is not in the draft", () => {
    // Curator is on a baseline that never had this factor. Agreeing
    // must still be possible — just without a draft edit.
    const d = design([factor(1, "sex", [fv(10, "female")])]);
    const f = pmFinding({ category: "organism part", direction: "agent_finer" });
    const r = report([
      proposalFactor("organism part", [pfv("liver"), pfv("brain")]),
    ]);

    const action = resolveApplyAction(f, { design: d, report: r });
    expect(action?.mutates).toBe(false);
    expect(action?.label).toContain("not in draft");
    expect(action?.mutate).toBeUndefined();
  });

  it("reports already-applied when gold already carries the agent's exact partition", () => {
    // Identical FV signature = same labels AND same biomaterial sets.
    const d = design([
      factor(1, "organism part", [
        fv(10, "liver", ["S1", "S2"]),
        fv(11, "brain", ["S3"]),
      ]),
    ]);
    const f = pmFinding({ category: "organism part", direction: "agent_finer" });
    const r = report([
      proposalFactor("organism part", [
        pfv("liver", ["S1", "S2"]),
        pfv("brain", ["S3"]),
      ]),
    ]);

    const action = resolveApplyAction(f, { design: d, report: r });
    expect(action?.mutates).toBe(false);
    expect(action?.label).toContain("Already applied");
  });

  it("ignores biomaterial ORDER when deciding already-applied", () => {
    // The signature sorts the biomaterial set, so a different order on
    // the wire must not read as a different partition.
    const d = design([
      factor(1, "organism part", [fv(10, "liver", ["S2", "S1"])]),
    ]);
    const f = pmFinding({ category: "organism part", direction: "agent_finer" });
    const r = report([
      proposalFactor("organism part", [pfv("liver", ["S1", "S2"])]),
    ]);

    expect(resolveApplyAction(f, { design: d, report: r })?.mutates).toBe(
      false,
    );
  });

  it("treats a differing biomaterial set as a real mismatch even when labels match", () => {
    const d = design([
      factor(1, "organism part", [fv(10, "liver", ["S1"])]),
    ]);
    const f = pmFinding({ category: "organism part", direction: "agent_finer" });
    const r = report([
      proposalFactor("organism part", [pfv("liver", ["S1", "S2"])]),
    ]);

    expect(resolveApplyAction(f, { design: d, report: r })?.mutates).toBe(true);
  });

  it("adopts the agent's finer partition onto the draft", () => {
    // The regression this branch exists for: Agree used to PATCH the
    // disposition and leave the design at the old level count.
    const d = design([
      factor(1, "organism part", [fv(10, "brain", ["S1", "S2", "S3"])]),
    ]);
    const f = pmFinding({ category: "organism part", direction: "agent_finer" });
    const r = report([
      proposalFactor("organism part", [
        pfv("cortex", ["S1"]),
        pfv("hippocampus", ["S2"]),
        pfv("cerebellum", ["S3"]),
      ]),
    ]);

    const action = resolveApplyAction(f, { design: d, report: r });
    expect(action?.mutates).toBe(true);
    expect(action?.tooltip).toContain("finer levels");
    expect(action?.tooltip).toContain("1 → 3 values");

    const next = action!.mutate!(d);
    const adopted = next.factors.find(
      (x) => x.category.label === "organism part",
    );
    expect(adopted!.factor_values.map((v) => v.free_text_label).sort()).toEqual(
      ["cerebellum", "cortex", "hippocampus"],
    );
  });

  it("describes an agent_coarser adopt as fewer levels", () => {
    const d = design([
      factor(1, "treatment", [
        fv(10, "low dose", ["S1"]),
        fv(11, "high dose", ["S2"]),
      ]),
    ]);
    const f = pmFinding({ category: "treatment", direction: "agent_coarser" });
    const r = report([
      proposalFactor("treatment", [pfv("treated", ["S1", "S2"])]),
    ]);

    const action = resolveApplyAction(f, { design: d, report: r });
    expect(action?.mutates).toBe(true);
    expect(action?.tooltip).toContain("fewer levels");
    expect(action!.mutate!(d).factors[0].factor_values).toHaveLength(1);
  });

  it("falls back to the neutral word \"partition\" for a degenerate cross-cutting", () => {
    const d = design([factor(1, "population", [fv(10, "YRI", ["S1"])])]);
    const f = pmFinding({
      category: "population",
      direction: "cross_cutting",
      crossCuttingGolds: 1,
    });
    const r = report([
      proposalFactor("population", [pfv("YRI", ["S1"]), pfv("CHB", ["S2"])]),
    ]);

    expect(resolveApplyAction(f, { design: d, report: r })?.tooltip).toContain(
      "partition",
    );
  });

  it("adopts onto the GOLD factor when the agent also recategorizes it", () => {
    // GSE96826 (eid 15112), reported 2026-08-17: Gemma has a 4-value
    // `disease` factor; the agent proposes a 3-value `genotype` over
    // the same 11 samples. The mutator used to re-resolve its landing
    // factor from the AGENT's category, found no `genotype` in the
    // draft, and returned the design untouched while the disposition
    // recorded as accepted. Adopt must land on the factor the finding
    // paired against, whatever the agent renames it to.
    const d = design([
      factor(1, "disease", [
        fv(10, "SCA2 fibroblast", ["S1", "S2"]),
        fv(11, "Machado-Joseph disease", ["S3", "S4", "S5", "S6"]),
        fv(12, "reference subject role", ["S7", "S8", "S9"]),
        fv(13, "SCA2 PBMC", ["S10", "S11"]),
      ]),
    ]);
    const f = pmFinding({
      category: "genotype",
      goldCategory: "disease",
      direction: "agent_coarser",
    });
    const r = report([
      proposalFactor("genotype", [
        pfv("control", ["S7", "S8", "S9"]),
        pfv("SCA2", ["S1", "S2", "S10", "S11"]),
        pfv("SCA3", ["S3", "S4", "S5", "S6"]),
      ]),
    ]);

    const action = resolveApplyAction(f, { design: d, report: r });
    expect(action?.mutates).toBe(true);

    const next = action!.mutate!(d);
    // One factor in, one factor out — the adopt is an in-place
    // rewrite, never a drop plus an add.
    expect(next.factors).toHaveLength(1);
    const adopted = next.factors[0];
    expect(adopted.id).toBe(1);
    expect(adopted.category.label).toBe("genotype");
    expect(
      adopted.factor_values.map((v) => v.free_text_label).sort(),
    ).toEqual(["SCA2", "SCA3", "control"]);
    // The samples moved with the levels — that is the half of the
    // operation no existing verb (rename_fv) performs.
    expect(
      adopted.factor_values.find((v) => v.free_text_label === "SCA2")!
        .biomaterial_short_names.sort(),
    ).toEqual(["S1", "S10", "S11", "S2"]);
  });

  it("is idempotent — re-adopting a recategorized swap keeps the factor", () => {
    // The trap cab hit on the ledger side (2026-08-17): an adopt built
    // as drop-then-add lands correctly ONCE, then on replay the add
    // no-ops (already present) while the drop still matches by key and
    // DELETES the result. In-place rewrite has no second pass to get
    // wrong; assert the second apply is a no-op, not a deletion.
    const d = design([
      factor(1, "disease", [
        fv(10, "SCA2", ["S1", "S2"]),
        fv(11, "control", ["S3"]),
      ]),
    ]);
    const f = pmFinding({
      category: "genotype",
      goldCategory: "disease",
      direction: "agent_coarser",
    });
    const r = report([
      proposalFactor("genotype", [pfv("affected", ["S1", "S2", "S3"])]),
    ]);

    const once = resolveApplyAction(f, { design: d, report: r })!.mutate!(d);
    // Resolve again against the ALREADY-ADOPTED design, as a reload
    // would. The gold factor now wears the agent's category.
    const again = resolveApplyAction(f, { design: once, report: r });
    const twice = again?.mutate ? again.mutate(once) : once;

    expect(twice.factors).toHaveLength(1);
    expect(twice.factors[0].id).toBe(1);
    expect(twice.factors[0].factor_values).toHaveLength(1);
    expect(twice.factors[0].factor_values[0].free_text_label).toBe("affected");
  });

  it("does not mutate the design passed to the resolver", () => {
    const d = design([
      factor(1, "organism part", [fv(10, "brain", ["S1", "S2"])]),
    ]);
    const f = pmFinding({ category: "organism part", direction: "agent_finer" });
    const r = report([
      proposalFactor("organism part", [
        pfv("cortex", ["S1"]),
        pfv("hippocampus", ["S2"]),
      ]),
    ]);

    resolveApplyAction(f, { design: d, report: r })!.mutate!(d);

    expect(d.factors[0].factor_values).toHaveLength(1);
    expect(d.factors[0].factor_values[0].free_text_label).toBe("brain");
  });
});

// ---------------------------------------------------------------------------
// calibration_factor_gold_only_miss
// ---------------------------------------------------------------------------

/** gold_only_miss findings name their factor in backticks in the
 *  rationale — that is the only label source this branch has. */
function missFinding(
  rationale: string,
  goldIndex?: number | null,
): AuditFinding {
  return finding({
    issue_code: "calibration_factor_gold_only_miss",
    target_id: "factor:genotype",
    rationale,
    ...(goldIndex === undefined ? {} : { gold_target_index: goldIndex }),
  } as Partial<AuditFinding>);
}

describe("resolveApplyAction — FACTOR GOLD-ONLY MISS (remove)", () => {
  it("falls back to focus-only when the rationale names no factor in backticks", () => {
    const d = design([factor(1, "genotype", [fv(10, "WT")])]);
    expectFocusOnly(
      resolveApplyAction(missFinding("agent missed a factor"), { design: d }),
    );
  });

  it("removes the factor resolved positionally via gold_target_index", () => {
    const d = design([
      factor(1, "sex", [fv(10, "female", ["S1"])]),
      factor(2, "genotype", [fv(20, "WT", ["S1"])]),
    ]);
    const f = missFinding("Gold has factor `genotype` the agent missed.", 1);

    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(true);
    expect(action?.tooltip).toContain("id=2");

    const next = action!.mutate!(d);
    expect(next.factors.map((x) => x.id)).toEqual([1]);
  });

  it("reports already-removed when no factor of that label is in the draft", () => {
    const d = design([factor(1, "sex", [fv(10, "female")])]);
    const f = missFinding("Gold has factor `genotype` the agent missed.");

    const action = resolveApplyAction(f, { design: d });
    expect(action?.mutates).toBe(false);
    expect(action?.label).toContain("Already removed");
    expect(action?.mutate).toBeUndefined();
  });

  it("removes the sole label match when no index is supplied", () => {
    const d = design([
      factor(1, "sex", [fv(10, "female", ["S1"])]),
      factor(2, "genotype", [fv(20, "WT", ["S1"])]),
    ]);
    const f = missFinding("Gold has factor `genotype` the agent missed.");

    const next = resolveApplyAction(f, { design: d })!.mutate!(d);
    expect(next.factors.map((x) => x.category.label)).toEqual(["sex"]);
  });

  it("matches the backticked label case-insensitively", () => {
    const d = design([factor(1, "genotype", [fv(10, "WT", ["S1"])])]);
    const f = missFinding("Gold has factor `GENOTYPE` the agent missed.");

    expect(resolveApplyAction(f, { design: d })?.mutates).toBe(true);
  });

  it("falls back to focus-only on duplicate candidates with nothing to disambiguate", () => {
    // Stale/out-of-range index defeats the positional resolve, leaving
    // two same-label candidates and nothing to choose between them.
    const d = design([
      factor(1, "genotype", [fv(10, "WT", ["S1"])]),
      factor(2, "genotype", [fv(20, "KO", ["S2"])]),
    ]);
    const f = missFinding("Gold has factor `genotype` the agent missed.", 99);

    expectFocusOnly(resolveApplyAction(f, { design: d, report: report([]) }));
  });

  it("disambiguates duplicate-category candidates by LEAST biomaterial overlap", () => {
    // The gold factor the agent missed is the one its proposal does NOT
    // overlap — the overlapping sibling is the one it did propose.
    const d = design([
      // Overlaps the agent's samples heavily → the agent DID cover this.
      factor(1, "genotype", [fv(10, "WT", ["S1", "S2"])]),
      // No overlap → this is the missed one.
      factor(2, "genotype", [fv(20, "KO", ["S9"])]),
    ]);
    const f = missFinding("Gold has factor `genotype` the agent missed.", 99);
    const r = report([
      proposalFactor("genotype", [pfv("WT", ["S1", "S2"])]),
    ]);

    const action = resolveApplyAction(f, { design: d, report: r });
    expect(action?.mutates).toBe(true);
    expect(action?.tooltip).toContain("id=2");
    expect(action?.tooltip).toContain("biomaterial overlap");

    const next = action!.mutate!(d);
    expect(next.factors.map((x) => x.id)).toEqual([1]);
  });

  it("removes only the targeted factor, leaving siblings untouched", () => {
    const d = design([
      factor(1, "sex", [fv(10, "female", ["S1"])]),
      factor(2, "genotype", [fv(20, "WT", ["S1"])]),
      factor(3, "treatment", [fv(30, "vehicle", ["S1"])]),
    ]);
    const f = missFinding("Gold has factor `genotype` the agent missed.", 1);

    const next = resolveApplyAction(f, { design: d })!.mutate!(d);
    expect(next.factors.map((x) => x.category.label)).toEqual([
      "sex",
      "treatment",
    ]);
  });

  it("does not mutate the design passed to the resolver", () => {
    const d = design([
      factor(1, "sex", [fv(10, "female", ["S1"])]),
      factor(2, "genotype", [fv(20, "WT", ["S1"])]),
    ]);
    const f = missFinding("Gold has factor `genotype` the agent missed.", 1);

    resolveApplyAction(f, { design: d })!.mutate!(d);

    expect(d.factors).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// calibration_factor_rename / near-match — adopt the agent's labels onto
// the aligned Gemma factor IN PLACE (the factor keeps its id, so audit
// dots and sample-table FV chips keep resolving).
// ---------------------------------------------------------------------------

type Pair = {
  agentLabel: string;
  goldLabel: string;
  agentBms?: string[];
};

/** rename finding. ``fv_pairs`` is the agent's authoritative
 *  (agent FV ↔ gold FV) mapping and takes precedence over the UI's
 *  biomaterial-overlap guess. */
function renameFinding(opts: {
  agentCategory: string;
  goldCategory: string;
  agentCategoryUri?: string | null;
  pairs?: Pair[];
  goldIndex?: number | null;
}): AuditFinding {
  return finding({
    issue_code: "calibration_factor_rename",
    target_id: `factor:${opts.goldCategory}`,
    ...(opts.goldIndex === undefined ? {} : { gold_target_index: opts.goldIndex }),
    rename: {
      agent: {
        category: wireTerm(opts.agentCategory, opts.agentCategoryUri ?? null),
      },
      gold: { category: wireTerm(opts.goldCategory) },
      direction: "agent_correct",
      fv_pairs: (opts.pairs ?? []).map((p) => ({
        agent: wireTerm(p.agentLabel),
        gold: wireTerm(p.goldLabel),
        equivalence: "synonym",
        ...(p.agentBms ? { agent_biomaterial_short_names: p.agentBms } : {}),
      })),
    },
  } as Partial<AuditFinding>);
}

describe("resolveApplyAction — FACTOR RENAME / NEAR MATCH", () => {
  it("falls back to focus-only when neither the proposal nor a rename payload resolves", () => {
    const d = design([factor(1, "disease", [fv(10, "AD", ["S1"])])]);
    const f = finding({
      issue_code: "calibration_factor_rename",
      target_id: "factor:disease",
    });

    expectFocusOnly(resolveApplyAction(f, { design: d, report: report([]) }));
  });

  it("offers a non-mutating agree when the aligned gold factor is not in the draft", () => {
    // ``resolveGoldFactor`` synthesises a gold factor (id -1) from the
    // rename payload so the card can render both sides. Nothing in the
    // draft carries that id, so there is no rename to perform — the
    // action must say so rather than promise a mutation and then hand
    // the draft back untouched with a success toast.
    const d = design([factor(1, "sex", [fv(10, "female", ["S1"])])]);
    const f = renameFinding({
      agentCategory: "disease",
      goldCategory: "disease state",
      pairs: [{ agentLabel: "AD", goldLabel: "Alzheimers" }],
    });

    const action = resolveApplyAction(f, { design: d, report: report([]) });
    expect(action?.mutates).toBe(false);
    expect(action?.label).toContain("not in draft");
    expect(action?.mutate).toBeUndefined();
    expect(action?.successMessage).toBe("");
  });

  it("reports already-applied when the factor already carries the agent's labels", () => {
    const d = design([factor(1, "disease", [fv(10, "AD", ["S1"])])]);
    const f = renameFinding({
      agentCategory: "disease",
      goldCategory: "disease",
      pairs: [{ agentLabel: "AD", goldLabel: "AD" }],
    });

    const action = resolveApplyAction(f, { design: d, report: report([]) });
    expect(action?.mutates).toBe(false);
    expect(action?.label).toContain("Already applied");
  });

  it("treats a category URI difference as drift even when the labels match", () => {
    const d = design([factor(1, "disease", [fv(10, "AD", ["S1"])])]);
    const f = renameFinding({
      agentCategory: "disease",
      agentCategoryUri: "http://x/EFO_0000408",
      goldCategory: "disease",
      pairs: [{ agentLabel: "AD", goldLabel: "AD" }],
    });

    const action = resolveApplyAction(f, { design: d, report: report([]) });
    expect(action?.mutates).toBe(true);
    const next = action!.mutate!(d);
    expect(next.factors[0].category.uri).toBe("http://x/EFO_0000408");
  });

  it("mutates from the finding's own rename payload when no comparison_proposal is present", () => {
    // Replayed static calibration batches ship no comparison_proposal;
    // Agree used to resolve no agent factor and go silently inert.
    const d = design([factor(1, "disease state", [fv(10, "Alzheimers", ["S1"])])]);
    const f = renameFinding({
      agentCategory: "disease",
      goldCategory: "disease state",
      agentCategoryUri: "http://x/EFO_0000408",
      pairs: [{ agentLabel: "AD", goldLabel: "Alzheimers" }],
    });

    const action = resolveApplyAction(f, { design: d, report: null });
    expect(action?.mutates).toBe(true);

    const next = action!.mutate!(d);
    expect(next.factors[0].category.label).toBe("disease");
    expect(next.factors[0].category.uri).toBe("http://x/EFO_0000408");
    expect(next.factors[0].factor_values[0].free_text_label).toBe("AD");
  });

  it("keeps the gold factor's id and FV ids across the rename", () => {
    // Downstream references (audit dots, sample-table chips) key off
    // these ids — a rename that reassigns them breaks the dot resolver.
    const d = design([factor(42, "disease state", [fv(77, "Alzheimers", ["S1"])])]);
    const f = renameFinding({
      agentCategory: "disease",
      goldCategory: "disease state",
      pairs: [{ agentLabel: "AD", goldLabel: "Alzheimers" }],
    });

    const next = resolveApplyAction(f, { design: d, report: null })!.mutate!(d);
    expect(next.factors[0].id).toBe(42);
    expect(next.factors[0].factor_values[0].id).toBe(77);
  });

  it("relabels each FV named by fv_pairs, matching gold labels case-insensitively", () => {
    const d = design([
      factor(1, "disease state", [
        fv(10, "ALZHEIMERS", ["S1"]),
        fv(11, "control", ["S2"]),
      ]),
    ]);
    const f = renameFinding({
      agentCategory: "disease",
      goldCategory: "disease state",
      pairs: [
        { agentLabel: "AD", goldLabel: "alzheimers" },
        { agentLabel: "healthy control", goldLabel: "control" },
      ],
    });

    const next = resolveApplyAction(f, { design: d, report: null })!.mutate!(d);
    expect(next.factors[0].factor_values.map((v) => v.free_text_label)).toEqual([
      "AD",
      "healthy control",
    ]);
  });

  it("skips an fv_pair whose agent and gold labels are identical", () => {
    const d = design([
      factor(1, "disease state", [
        fv(10, "AD", ["S1"]),
        fv(11, "control", ["S2"]),
      ]),
    ]);
    const f = renameFinding({
      agentCategory: "disease",
      goldCategory: "disease state",
      pairs: [
        { agentLabel: "AD", goldLabel: "AD" },
        { agentLabel: "healthy control", goldLabel: "control" },
      ],
    });

    const next = resolveApplyAction(f, { design: d, report: null })!.mutate!(d);
    expect(next.factors[0].factor_values[0].free_text_label).toBe("AD");
    expect(next.factors[0].factor_values[1].free_text_label).toBe(
      "healthy control",
    );
  });

  it("leaves a gold FV alone when no fv_pair names it", () => {
    const d = design([
      factor(1, "disease state", [
        fv(10, "Alzheimers", ["S1"]),
        fv(11, "untouched", ["S2"]),
      ]),
    ]);
    const f = renameFinding({
      agentCategory: "disease",
      goldCategory: "disease state",
      pairs: [{ agentLabel: "AD", goldLabel: "Alzheimers" }],
    });

    const next = resolveApplyAction(f, { design: d, report: null })!.mutate!(d);
    expect(next.factors[0].factor_values[1].free_text_label).toBe("untouched");
  });

  it("pairs FVs by identical biomaterial set when the agent shipped no fv_pairs", () => {
    // Path 2 — strict partition match, no UI guessing beyond set identity.
    const d = design([
      factor(1, "disease", [
        fv(10, "old-a", ["S1", "S2"]),
        fv(11, "old-b", ["S3"]),
      ]),
    ]);
    const f = finding({
      issue_code: "calibration_factor_rename",
      target_id: "factor:disease",
      agent_target_index: 0,
    });
    const r = report([
      proposalFactor("disease", [
        // Deliberately reversed relative to the design, and with the
        // biomaterial order shuffled — the set is what pairs them.
        pfv("new-b", ["S3"]),
        pfv("new-a", ["S2", "S1"]),
      ]),
    ]);

    const action = resolveApplyAction(f, { design: d, report: r });
    expect(action?.mutates).toBe(true);
    const next = action!.mutate!(d);
    expect(next.factors[0].factor_values.map((v) => v.free_text_label)).toEqual([
      "new-a",
      "new-b",
    ]);
  });

  it("falls back to highest biomaterial overlap when no set matches exactly", () => {
    // Path 3 — partial partitions. "new-a" overlaps FV 10 on two
    // samples and FV 11 on none, so it wins FV 10.
    const d = design([
      factor(1, "disease", [
        fv(10, "old-a", ["S1", "S2"]),
        fv(11, "old-b", ["S3", "S4"]),
      ]),
    ]);
    const f = finding({
      issue_code: "calibration_factor_rename",
      target_id: "factor:disease",
      agent_target_index: 0,
    });
    const r = report([
      proposalFactor("disease", [
        pfv("new-a", ["S1", "S2", "S9"]),
        pfv("new-b", ["S3", "S8"]),
      ]),
    ]);

    const next = resolveApplyAction(f, { design: d, report: r })!.mutate!(d);
    expect(next.factors[0].factor_values.map((v) => v.free_text_label)).toEqual([
      "new-a",
      "new-b",
    ]);
  });

  it("does not pair two agent FVs onto the same gold FV", () => {
    // ``consumed`` guards this — without it the second agent FV would
    // re-win the same gold FV on overlap and clobber the first relabel.
    const d = design([factor(1, "disease", [fv(10, "old-a", ["S1", "S2"])])]);
    const f = finding({
      issue_code: "calibration_factor_rename",
      target_id: "factor:disease",
      agent_target_index: 0,
    });
    const r = report([
      proposalFactor("disease", [
        pfv("first", ["S1"]),
        pfv("second", ["S2"]),
      ]),
    ]);

    const next = resolveApplyAction(f, { design: d, report: r })!.mutate!(d);
    expect(next.factors[0].factor_values).toHaveLength(1);
    expect(next.factors[0].factor_values[0].free_text_label).toBe("first");
  });

  it("does not mutate the design passed to the resolver", () => {
    const d = design([factor(1, "disease state", [fv(10, "Alzheimers", ["S1"])])]);
    const f = renameFinding({
      agentCategory: "disease",
      goldCategory: "disease state",
      pairs: [{ agentLabel: "AD", goldLabel: "Alzheimers" }],
    });

    resolveApplyAction(f, { design: d, report: null })!.mutate!(d);

    expect(d.factors[0].category.label).toBe("disease state");
    expect(d.factors[0].factor_values[0].free_text_label).toBe("Alzheimers");
  });
});
