import { describe, expect, it } from "vitest";
import { buildCurationDocument } from "./curationCommit";

/**
 * The second predicate-object pair, and the `clientRef` that names a
 * statement being created.
 *
 * The draft holds one PAIR per row and Gemma holds one STATEMENT with
 * up to two; the commit is where those two models meet. Two failures
 * live here, both silent on read-back because a rendered label rebuilds
 * from `predicate`/`object` alone:
 *
 *  - a pair that cannot be expressed is not left alone, it is rebuilt
 *    out of existence (cab (eval), 2026-09-08: 9,031 rows in `gemd`
 *    carry a second pair);
 *  - two new statements sharing one `clientRef` collide on the key the
 *    response's `idMap` reports creations under.
 *
 * `secondPredicate` / `secondObject` are live on gemma2 from
 * `7cba4a75eb1d` (2026-09-08). Before it they were accepted, ignored
 * and dropped with no warning, which is why the emit used to be the
 * flattened form instead.
 */

const stmts = (rows: unknown[]) =>
  buildCurationDocument(
    {
      factors: [
        {
          id: 7,
          gemma_factor_id: 7,
          factor_values: [{ id: 1, statements: rows }],
        },
      ],
    } as never,
    { mode: "remote" },
  ).design?.factors?.items?.[0].factorValues?.items?.[0].statements?.items;

const subject = { label: "dexamethasone", uri: "CHEBI_41879" };

describe("a statement's second predicate-object pair", () => {
  it("emits ONE item carrying both pairs, not two rows sharing an id", () => {
    const out = stmts([
      { gemma_id: 300, subject, predicate: { label: "has dose" }, object: { label: "10 nM" } },
      { gemma_id: 300, subject, predicate: { label: "for" }, object: { label: "12 hours" } },
    ]);
    expect(out).toHaveLength(1);
    expect(out?.[0]).toMatchObject({
      gemmaId: 300,
      predicate: { label: "has dose" },
      object: { label: "10 nM" },
      secondPredicate: { label: "for" },
      secondObject: { label: "12 hours" },
    });
  });

  it("never sends both spellings — one statement is one item", () => {
    // Explicit fields AND the flattened two-entry form for the same
    // statement is a 400 (gembro, `7cba4a75eb1d`).
    const out = stmts([
      { gemma_id: 300, subject, predicate: { label: "has dose" }, object: { label: "10 nM" } },
      { gemma_id: 300, subject, predicate: { label: "for" }, object: { label: "12 hours" } },
    ]);
    expect(out?.filter((s) => (s as { gemmaId?: number }).gemmaId === 300)).toHaveLength(1);
  });

  it("leaves a single-pair statement alone", () => {
    const out = stmts([
      { gemma_id: 300, subject, predicate: { label: "has dose" }, object: { label: "10 nM" } },
    ]);
    expect(out).toHaveLength(1);
    expect(out?.[0]).not.toHaveProperty("secondPredicate");
    expect(out?.[0]).not.toHaveProperty("secondObject");
  });

  it("drops half a pair rather than sending it — a predicate with no object is a 400", () => {
    const out = stmts([
      { gemma_id: 300, subject, predicate: { label: "has dose" }, object: { label: "10 nM" } },
      { gemma_id: 300, subject, predicate: { label: "for" } },
    ]);
    expect(out).toHaveLength(1);
    expect(out?.[0]).not.toHaveProperty("secondPredicate");
  });

  it("carries the first row's evidenceCode for the whole statement", () => {
    const out = stmts([
      { gemma_id: 300, subject, evidence_code: "IC", predicate: { label: "has dose" }, object: { label: "10 nM" } },
      { gemma_id: 300, subject, predicate: { label: "for" }, object: { label: "12 hours" } },
    ]);
    expect(out?.[0]).toMatchObject({ evidenceCode: "IC" });
  });
});

describe("clientRef on a statement being created", () => {
  it("gives two unrelated new statements DIFFERENT refs", () => {
    const out = stmts([
      { gemma_id: null, subject, predicate: { label: "has dose" }, object: { label: "10 nM" } },
      { gemma_id: null, subject: { label: "hypoxia" }, predicate: { label: "has duration" }, object: { label: "6 h" } },
    ]);
    expect(out).toHaveLength(2);
    const refs = out?.map((s) => (s as { clientRef?: string }).clientRef);
    expect(new Set(refs).size).toBe(2);
  });

  it("keeps id-less rows separate — the draft cannot author a compound statement", () => {
    // `types.ts::Statement`: each uncommitted pair becomes its own
    // statement, so two id-less rows are two statements, never one
    // with a second pair.
    const out = stmts([
      { gemma_id: null, subject, predicate: { label: "has dose" }, object: { label: "10 nM" } },
      { gemma_id: null, subject, predicate: { label: "for" }, object: { label: "12 hours" } },
    ]);
    expect(out).toHaveLength(2);
    expect(out?.[0]).not.toHaveProperty("secondPredicate");
  });
});

/**
 * Dropping ONE clause of a compound statement.
 *
 * Omission used to be how that was said. `003b932cf7` (gembro,
 * 2026-09-11) made omitting a pair the stored statement HAS a 400, with
 * `clearSecondPair: true` as the replacement — because both fields are
 * objects and Jackson cannot tell a missing key from an explicit null,
 * so without it a second pair would be unremovable.
 *
 * The draft alone cannot tell a dropped pair from a statement that
 * never had one; only the baseline can, which is why these cases pass
 * one.
 */
const withBaseline = (rows: unknown[], baselineRows: unknown[]) =>
  buildCurationDocument(
    {
      factors: [
        { id: 7, gemma_factor_id: 7, factor_values: [{ id: 1, statements: rows }] },
      ],
    } as never,
    {
      mode: "remote",
      baseline: {
        factors: [
          {
            id: 7,
            gemma_factor_id: 7,
            factor_values: [{ id: 1, statements: baselineRows }],
          },
        ],
      },
    } as never,
  ).design?.factors?.items?.[0].factorValues?.items?.[0].statements?.items;

const dose = { gemma_id: 300, subject, predicate: { label: "has dose" }, object: { label: "10 nM" } };
const forTwelve = { gemma_id: 300, subject, predicate: { label: "for" }, object: { label: "12 hours" } };

describe("clearSecondPair", () => {
  it("says the clear out loud when the curator drops a clause", () => {
    const out = withBaseline([dose], [dose, forTwelve]);
    expect(out).toHaveLength(1);
    expect(out?.[0]).toMatchObject({ gemmaId: 300, clearSecondPair: true });
    expect(out?.[0]).not.toHaveProperty("secondPredicate");
    expect(out?.[0]).not.toHaveProperty("secondObject");
  });

  it("🛑 is ABSENT — never false — when the pair is being kept", () => {
    // The flag beside a pair is a 400, not a precedence rule.
    const out = withBaseline([dose, forTwelve], [dose, forTwelve]);
    expect(out?.[0]).toMatchObject({ secondPredicate: { label: "for" } });
    expect(out?.[0]).not.toHaveProperty("clearSecondPair");
  });

  it("stays off a statement that never had a second pair", () => {
    const out = withBaseline([dose], [dose]);
    expect(out?.[0]).not.toHaveProperty("clearSecondPair");
  });

  it("stays off a statement being CREATED — there is nothing stored to clear", () => {
    const out = withBaseline(
      [{ gemma_id: null, subject, predicate: { label: "has dose" }, object: { label: "10 nM" } }],
      [dose, forTwelve],
    );
    expect(out?.[0]).not.toHaveProperty("clearSecondPair");
  });

  it("🛑 never guesses without a baseline — a wrong flag DELETES a pair", () => {
    const out = stmts([dose]);
    expect(out?.[0]).not.toHaveProperty("clearSecondPair");
  });
});
