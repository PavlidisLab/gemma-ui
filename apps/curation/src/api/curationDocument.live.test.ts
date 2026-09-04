/**
 * The UI leg of the curation battle test — the document this app would
 * commit, run against Gemma's real validator.
 *
 * 🛑 **PREFLIGHT ONLY, and gemma2 is PRODUCTION.** `POST
 * /datasets/{id}/curation/preflight` takes the same body as the commit
 * and writes nothing, which makes it the honest instrument for "is this
 * document well formed". Nothing here commits. If a case ever needs a
 * real write to be meaningful it belongs on the sandbox (:8081, bound
 * to `gemdsandbox` by container environment) and needs Paul's say-so,
 * not this file's.
 *
 * 🛑 **A clean preflight is NOT an authorization answer.** gembro,
 * 2026-09-04: the dry run is exempt from the write-target guard and
 * skips the curation-lock check. It says the document parses and what
 * it would change — never that the write would be allowed.
 *
 * 🛑 **Every assertion here is paired with the no-op it must not pass.**
 * The lesson of the 2026-09-03 battle-test night was a harness printing
 * "REVERSIBLE — content AND identity restored" on a run where the edit
 * 400'd and both restores 403'd: nothing happened, so before == after,
 * so everything passed. So the FIRST case is the control — an unchanged
 * design must preflight as changing nothing — and the mutation cases are
 * only meaningful because that control exists.
 *
 * Opt-in, because the unit suite must not depend on a reachable server:
 *
 *     GEMMA_LIVE=1 npx vitest run src/api/curationDocument.live.test.ts
 *
 * Credentials come from the macOS keychain, never from a file or the
 * environment.
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { buildCurationDocument, type CommittableDesign } from "./curationCommit";

const LIVE = process.env.GEMMA_LIVE === "1";
/** Dataset to probe. GSE6966 / dataset 2706 by default — the one the
 *  audit work has been running against. */
const DATASET = Number(process.env.GEMMA_LIVE_DATASET ?? 2706);

function keychain(service: string): string {
  return execFileSync("security", ["find-generic-password", "-s", service, "-w"], {
    encoding: "utf8",
  }).trim();
}

function creds() {
  return {
    base: process.env.GEMMA_BASE_URL || keychain("GEMMA_BASE_URL"),
    auth:
      "Basic " +
      Buffer.from(`${keychain("GEMMA_USERNAME")}:${keychain("GEMMA_PASSWORD")}`).toString(
        "base64",
      ),
  };
}

async function get(path: string): Promise<unknown> {
  const { base, auth } = creds();
  const r = await fetch(`${base}/rest/v2${path}`, {
    headers: { Authorization: auth, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json();
}

/** The dry run. Returns the report AND the status, because a body that
 *  parses is not the same as a 200 — see the 400 assertions below. */
async function preflight(
  doc: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { base, auth } = creds();
  const r = await fetch(`${base}/rest/v2/datasets/${DATASET}/curation/preflight`, {
    method: "POST",
    headers: {
      Authorization: auth,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(doc),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

interface WireTag {
  id: number;
  className?: string | null;
  classUri?: string | null;
  termName?: string | null;
  termUri?: string | null;
  category?: string | null;
  categoryUri?: string | null;
  value?: string | null;
  valueUri?: string | null;
  objectClass?: string | null;
}

/** Gemma's experiment-level annotations → the tag shape the builder
 *  takes. Reads BOTH spellings: Gemma renamed these with no aliases and
 *  an older instance still serves the old ones. */
function tagsFromWire(rows: WireTag[]): NonNullable<CommittableDesign["tags"]> {
  return rows.map((r) => ({
    id: r.id,
    category: {
      label: r.category ?? r.className ?? undefined,
      uri: r.categoryUri ?? r.classUri ?? null,
    },
    value: {
      label: r.value ?? r.termName ?? undefined,
      uri: r.valueUri ?? r.termUri ?? null,
    },
  }));
}

/** `changes.tags`, and it must EXIST.
 *
 *  🛑 The first version of this returned `{}` for a missing field, so
 *  every assertion below would have passed against a server that
 *  reported nothing at all — the exact failure this file is written to
 *  avoid, reproduced in its own helper. Measured shape on gemma2
 *  2026-09-04: `{created, updated, deleted, unchanged}`. */
function tagChanges(body: Record<string, unknown>): {
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
} {
  const changes = (body.data as { changes?: Record<string, unknown> } | undefined)
    ?.changes;
  const tags = changes?.tags as Record<string, number> | undefined;
  if (!tags || typeof tags.unchanged !== "number") {
    throw new Error(
      `preflight reported no tag counts — the assertions below would be ` +
        `vacuous. Body: ${JSON.stringify(body).slice(0, 400)}`,
    );
  }
  return tags as ReturnType<typeof tagChanges>;
}

describe.skipIf(!LIVE)("the document this UI would commit, against Gemma", () => {
  it("🛑 CONTROL: an unchanged design preflights as changing NOTHING", async () => {
    // The control the whole file rests on. If a document built from
    // what Gemma just served reports changes, the builder is inventing
    // them — and every "the mutation was seen" assertion below would be
    // meaningless, because it would pass on a no-op too.
    const raw = (await get(
      `/datasets/${DATASET}/annotations?includeFreeText=true`,
    )) as { data?: WireTag[] };
    const tags = tagsFromWire(raw.data ?? []);
    expect(tags.length, "dataset has no tags — pick one that does").toBeGreaterThan(0);

    const design: CommittableDesign = { tags };
    const doc = buildCurationDocument(design, {
      mode: "remote",
      baseline: { tags },
    });

    // Every item is a bare keep-marker: the id and nothing else.
    for (const item of doc.tags?.items ?? []) {
      expect(Object.keys(item)).toEqual(["gemmaId"]);
    }
    expect(doc.tags?.deletedIds).toBeUndefined();

    const { status, body } = await preflight(doc);
    expect(status, JSON.stringify(body).slice(0, 400)).toBe(200);
    // Exact counts, not a "looks empty" match: every tag accounted for
    // as unchanged, and nothing created, updated or deleted.
    expect(tagChanges(body)).toEqual({
      created: 0,
      updated: 0,
      deleted: 0,
      unchanged: tags.length,
    });
  });

  it("🛑 the OLD builder's shape is still refused — the 400 is real", async () => {
    // Proves the keep-marker guard actually fires, so the fix above is
    // answering a live rule rather than a documented one. This is the
    // exact body `curationCommit.ts` emitted before ce63060.
    const raw = (await get(
      `/datasets/${DATASET}/annotations?includeFreeText=true`,
    )) as { data?: WireTag[] };
    const first = tagsFromWire(raw.data ?? [])[0];
    const { status, body } = await preflight({
      tags: {
        items: [
          {
            gemmaId: first.id,
            category: { label: first.category?.label, uri: first.category?.uri ?? undefined },
            value: { label: first.value?.label, uri: first.value?.uri ?? undefined },
          },
        ],
      },
    });
    expect(status).toBe(400);
    expect(JSON.stringify(body)).toMatch(/category|value/);
  });

  it("a re-term preflights as a delete AND a create, not a create alone", async () => {
    // The shape the fix produces. `tags.created: 1` alone would read as
    // a restoration; the delete is what says the old identity is going.
    const raw = (await get(
      `/datasets/${DATASET}/annotations?includeFreeText=true`,
    )) as { data?: WireTag[] };
    const tags = tagsFromWire(raw.data ?? []);
    const retermed = tags.map((t, i) =>
      i === 0
        ? { ...t, value: { label: "hepatocyte", uri: "http://purl.obolibrary.org/obo/CL_0000182" } }
        : t,
    );
    const doc = buildCurationDocument({ tags: retermed }, {
      mode: "remote",
      baseline: { tags },
    });
    expect(doc.tags?.deletedIds).toEqual([tags[0].id]);
    expect(doc.tags?.items?.[0].clientRef).toBe(`tag-${tags[0].id}`);

    const { status, body } = await preflight(doc);
    expect(status, JSON.stringify(body).slice(0, 400)).toBe(200);
    // BOTH halves, and against the control's exact counts. `created: 1`
    // alone would read as a restoration; the delete is what says the
    // old identity is going.
    expect(tagChanges(body)).toEqual({
      created: 1,
      updated: 0,
      deleted: 1,
      unchanged: tags.length - 1,
    });
  });
});
