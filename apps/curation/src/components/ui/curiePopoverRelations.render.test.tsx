/**
 * @vitest-environment jsdom
 *
 * The related-terms section of the term card.
 *
 * 🛑 What it must never become: an annotation. No row here was written
 * onto any experiment, so the section carries no Accept, no Add and no
 * apply affordance — a curator still has to make the annotation, and an
 * inference that becomes a tag stops being recomputable.
 *
 * Rows are rendered literally, `subject — predicate → object`. Which end
 * a term sits on is the curator's choice of predicate and both shapes
 * are in the corpus, so the arrow states direction and the predicate is
 * never reworded.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/api/annotations", () => ({
  useGemmaTerm: () => ({ data: null, isLoading: false }),
  useOlsTerm: () => ({ data: null, isLoading: false }),
  useNcbiGene: () => ({ data: null, isLoading: false }),
  useTermChildren: () => ({ data: null }),
  useTermSynonyms: () => ({ data: [] }),
}));
vi.mock("@/api/genes", () => ({ useGeneInfo: () => ({ data: null }) }));

import { CuriePopoverBody } from "./CuriePopover";
import type { MergedRelation } from "@/api/termRelations";

const ALZ = "http://purl.obolibrary.org/obo/MONDO_0004975";

const curated: MergedRelation = {
  subject: "Alzheimer disease",
  subject_uri: ALZ,
  subject_category: "Disease model",
  predicate: "has_genotype",
  predicate_uri: "http://purl.obolibrary.org/obo/GENO_0000222",
  object: "APP/PS1",
  object_uri: "http://gemma.msl.ubc.ca/ont/TGEMO_00174",
  taxon_name: "mouse",
  basis: "CURATED",
  number_of_experiments: 10,
  object_breadth: 3,
  example_dataset_id: 20187,
  copies: 2,
};

/** CLO's own restriction, with this term on the OBJECT side. */
const asserted: MergedRelation = {
  subject: "AG07671 cell",
  subject_uri: "http://purl.obolibrary.org/obo/CLO_0032907",
  predicate: "is disease model for",
  object: "Alzheimer disease",
  object_uri: ALZ,
  object_category: "disease",
  basis: "ONTOLOGY",
  source: "CLO",
  source_version: "2026-06-19",
  number_of_experiments: 0,
  object_breadth: 9,
  example_dataset_id: null,
  copies: 1,
};

/** Cellosaurus, which resolved the object and kept its own line for it. */
const external: MergedRelation = {
  subject: "A-549",
  subject_uri: "https://www.cellosaurus.org/CVCL_0023",
  subject_category: "cell line",
  predicate: "derives from patient having disease",
  object: "lung adenocarcinoma",
  object_uri: "http://purl.obolibrary.org/obo/MONDO_0005061",
  object_category: "disease",
  basis: "EXTERNAL",
  source: "CELLOSAURUS",
  evidence: "NCIT:C3512 Lung adenocarcinoma",
  number_of_experiments: 0,
  object_breadth: 2777,
  example_dataset_id: null,
  copies: 1,
};

/** The same producer's other predicate, which has NOT resolved its
 *  object: `evidence` is a verbatim copy of the label. Filed with the
 *  backend 2026-08-18; until it lands, a hover repeating the line above
 *  it is noise, so there must not be one. */
const unresolved: MergedRelation = {
  ...external,
  predicate: "derives from anatomic part",
  object: "In situ; Lung",
  object_uri: "http://purl.obolibrary.org/obo/UBERON_0002048",
  object_category: "organism part",
  evidence: "In situ; Lung",
};

function renderRelations(relations: MergedRelation[]) {
  return render(
    <CuriePopoverBody
      detail={
        {
          uri: ALZ,
          label: "Alzheimer disease",
          definition: "",
          parents: [],
          synonyms: [],
          alternativeIds: [],
          xrefs: [],
          ontologyVersion: null,
          ontology: "mondo",
        } as never
      }
      childrenResult={null}
      relations={relations}
      onNavigate={() => {}}
    />,
  );
}

describe("related terms on a term card", () => {
  it("says these are derived, not curated annotations", () => {
    renderRelations([curated]);
    expect(screen.getByText(/derived, not curated/)).toBeTruthy();
  });

  it("offers no way to act on one", () => {
    // 🛑 The whole class distinction in one assertion: the only buttons
    // in the section navigate to a term. Nothing applies, accepts or
    // adds.
    const { container } = renderRelations([curated, asserted]);
    for (const b of container.querySelectorAll("button")) {
      expect(b.textContent ?? "").not.toMatch(/accept|apply|add|use/i);
    }
  });

  it("reads as written, with the predicate never reworded", () => {
    // Every row here is outbound — the card's term is the subject — so
    // there is no direction to state and no arrow to get backwards.
    renderRelations([curated, asserted]);
    expect(screen.getByText(/has_genotype/)).toBeTruthy();
    expect(screen.getByText(/is disease model for/)).toBeTruthy();
    expect(screen.queryByText(/←/)).toBeNull();
  });

  it("names the basis on every row", () => {
    renderRelations([curated, asserted]);
    expect(screen.getByText("curator asserted")).toBeTruthy();
    expect(screen.getByText("ontology asserts")).toBeTruthy();
  });

  it("names the ontology that asserted it", () => {
    renderRelations([asserted]);
    expect(screen.getByText(/CLO/)).toBeTruthy();
  });

  it("shows support as datasets, and only where it was counted", () => {
    // 🛑 0 on an asserted basis means "not counted", not "no evidence" —
    // rendering "0 datasets" beside an ontology's own restriction reads
    // as the opposite of what it means.
    renderRelations([curated, asserted]);
    expect(screen.getByText(/10 datasets/)).toBeTruthy();
    // ``/0 datasets/`` would match "10 datasets"; the word boundary is
    // the assertion.
    expect(screen.queryByText(/\b0 datasets/)).toBeNull();
  });

  it("says when the source emitted one fact more than once", () => {
    renderRelations([curated]);
    expect(screen.getByText(/folded 2/)).toBeTruthy();
  });


  it("carries the source's own words for a third party's claim", () => {
    // 🛑 Origin, never judgement. Nobody here asserted that A-549 came
    // from a lung adenocarcinoma, so the row says who did and — in the
    // hover, where detail lives — the line they filed it under.
    const { container } = renderRelations([external]);
    const src = [...container.querySelectorAll("span")].find(
      (n) => n.textContent?.trim() === "CELLOSAURUS",
    );
    expect(src?.getAttribute("title")).toContain("NCIT:C3512 Lung adenocarcinoma");
  });

  it("stays quiet where the source only repeats the object", () => {
    const { container } = renderRelations([unresolved]);
    const src = [...container.querySelectorAll("span")].find(
      (n) => n.textContent?.trim() === "CELLOSAURUS",
    );
    expect(src?.getAttribute("title") ?? "").not.toContain("In situ");
  });

  it("renders nothing at all when nothing is recorded", () => {
    // The common case for a long time, and it must not leave a header
    // announcing an empty section.
    const { container } = renderRelations([]);
    expect(container.textContent).not.toContain("related terms");
  });
});
