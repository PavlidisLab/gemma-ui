/**
 * ``tagToDraft`` / ``draftToStatements`` round-trip — the conversion
 * between the Tag the store holds and the StatementDraft the edit
 * modal works on. Deferred from the 2026-06-17 statement-chip landing;
 * the invariants under test are the wire spec's: subject == tag.value,
 * pairs share the draft's category + subject, and blank pairs never
 * reach the stored statements.
 */
import { describe, expect, it } from "vitest";
import type { Tag } from "@/features/experiment/types";
import { draftToStatements, tagToDraft } from "./TagBar";

const ORGANISM_PART = {
  label: "organism part",
  uri: "http://www.ebi.ac.uk/efo/EFO_0000635",
};
const CORTEX = {
  label: "cortex",
  uri: "http://purl.obolibrary.org/obo/UBERON_0001851",
};
const PART_OF = {
  label: "part of",
  uri: "http://purl.obolibrary.org/obo/BFO_0000050",
};
const BRAIN = {
  label: "brain",
  uri: "http://purl.obolibrary.org/obo/UBERON_0000955",
};

function tag(statements: Tag["statements"]): Tag {
  return {
    id: 7,
    category: ORGANISM_PART,
    value: CORTEX,
    statements,
  } as Tag;
}

describe("tagToDraft", () => {
  it("a flat tag becomes a draft with no pairs", () => {
    const d = tagToDraft(tag([]));
    expect(d.category).toEqual(ORGANISM_PART);
    expect(d.subject).toEqual(CORTEX);
    expect(d.pairs).toEqual([]);
  });

  it("statements become (predicate, object) pairs — subject not echoed per pair", () => {
    const d = tagToDraft(
      tag([
        {
          category: ORGANISM_PART,
          subject: CORTEX,
          predicate: PART_OF,
          object: BRAIN,
        },
      ]),
    );
    expect(d.pairs).toEqual([{ predicate: PART_OF, object: BRAIN }]);
  });

  it("tolerates a missing statements key (older payloads)", () => {
    expect(tagToDraft(tag(undefined)).pairs).toEqual([]);
  });
});

describe("draftToStatements", () => {
  it("stamps the draft's category + subject onto every pair", () => {
    const out = draftToStatements({
      category: ORGANISM_PART,
      subject: CORTEX,
      pairs: [{ predicate: PART_OF, object: BRAIN }],
    });
    expect(out).toEqual([
      {
        category: ORGANISM_PART,
        subject: CORTEX,
        predicate: PART_OF,
        object: BRAIN,
      },
    ]);
  });

  it("drops pairs with neither predicate nor object", () => {
    const out = draftToStatements({
      category: ORGANISM_PART,
      subject: CORTEX,
      pairs: [
        { predicate: null, object: null },
        { predicate: PART_OF, object: null },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].predicate).toEqual(PART_OF);
  });
});

describe("round trip", () => {
  it("tag → draft → statements preserves every S-P-O", () => {
    const original = tag([
      {
        category: ORGANISM_PART,
        subject: CORTEX,
        predicate: PART_OF,
        object: BRAIN,
      },
    ]);
    const back = draftToStatements(tagToDraft(original));
    expect(back).toEqual(original.statements);
  });
});
