/**
 * The flat annotation list shows experiment-level rows only.
 *
 * Shapes taken from dataset 27773 (GSE233669), the case that prompted
 * this: 24 annotations, 12 of them BioMaterial, including a `BioSource`
 * category and a `group` category carrying the submitter's own arm
 * labels.
 */
import { describe, expect, it } from "vitest";
import {
  isExperimentLevelAnnotation,
  splitBySampleScope,
} from "./annotationScope";
import type { DatasetAnnotation } from "./types";

const ann = (
  objectClass: string,
  className: string,
  termName: string,
  termUri: string | null = null,
): DatasetAnnotation => ({
  objectClass,
  className,
  classUri: null,
  termName,
  termUri,
  statements: [],
});

describe("isExperimentLevelAnnotation", () => {
  it("keeps experiment tags and factor values", () => {
    expect(
      isExperimentLevelAnnotation(ann("ExperimentTag", "assay", "bulk RNA-seq")),
    ).toBe(true);
    expect(
      isExperimentLevelAnnotation(ann("FactorValue", "genotype", "NEFH-tTa")),
    ).toBe(true);
  });

  it("drops per-sample characteristics", () => {
    expect(
      isExperimentLevelAnnotation(ann("BioMaterial", "group", "TDP-15")),
    ).toBe(false);
    expect(
      isExperimentLevelAnnotation(
        ann("BioMaterial", "BioSource", "cerebral cortex (whole tissue)"),
      ),
    ).toBe(false);
  });

  it("keeps an experiment tag that carries no ontology term", () => {
    // A free-text EE tag is marked as free text, never hidden — the
    // filter is on scope, not on grounding.
    expect(
      isExperimentLevelAnnotation(
        ann("ExperimentTag", "strain", "mixed C57BL/6J x C3H/HeJ", null),
      ),
    ).toBe(true);
  });

  it("keeps an unrecognised or empty objectClass", () => {
    // Gemma owns this vocabulary. Dropping a kind we have not seen
    // would hide real annotations silently, which is the one failure
    // this filter could not surface.
    expect(isExperimentLevelAnnotation(ann("", "assay", "x"))).toBe(true);
    expect(
      isExperimentLevelAnnotation(ann("SomethingNew", "assay", "x")),
    ).toBe(true);
  });
});

describe("splitBySampleScope", () => {
  it("partitions without losing or duplicating a row", () => {
    const rows = [
      ann("ExperimentTag", "assay", "bulk RNA-seq assay"),
      ann("BioMaterial", "group", "ctrl-PBS"),
      ann("FactorValue", "biological sex", "male"),
      ann("BioMaterial", "genotype", "bigenic"),
      ann("BioMaterial", "BioSource", "cerebral cortex (whole tissue)"),
    ];
    const { experimentLevel, perSample } = splitBySampleScope(rows);
    expect(experimentLevel).toHaveLength(2);
    expect(perSample).toHaveLength(3);
    expect(experimentLevel.length + perSample.length).toBe(rows.length);
  });

  it("preserves input order within each side", () => {
    const { experimentLevel } = splitBySampleScope([
      ann("ExperimentTag", "assay", "first"),
      ann("BioMaterial", "group", "skipped"),
      ann("ExperimentTag", "assay", "second"),
    ]);
    expect(experimentLevel.map((a) => a.termName)).toEqual(["first", "second"]);
  });

  it("handles an empty list", () => {
    expect(splitBySampleScope([])).toEqual({
      experimentLevel: [],
      perSample: [],
    });
  });
});
