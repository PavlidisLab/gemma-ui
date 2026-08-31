/**
 * @vitest-environment jsdom
 *
 * The dataset page's Annotations card used to render a statement
 * (subject + predicate/object pairs) as Gemma's pre-concatenated
 * run-on `termName` string, or lose the predicate/object structure
 * entirely. `OntologyTermChip`'s `pairs` prop renders it compactly
 * instead — see the component's doc comment for why it flattens
 * subject/predicate/object into one chip frame rather than nesting a
 * bordered leaf per term (browser's own `vitest.config.ts` notes this
 * is the app's first render test — jsdom is opted in per-file via
 * this docblock rather than the curation app's `environmentMatchGlobs`
 * suffix convention, since there's only one file so far).
 */
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OntologyTermChip } from "./OntologyTermChip";

describe("OntologyTermChip — plain term (unchanged)", () => {
  it("renders a bare resolved term exactly as before — no pairs prop", () => {
    const { container, getByText } = render(
      <OntologyTermChip uri="http://purl.obolibrary.org/obo/UBERON_0002048">
        lung
      </OntologyTermChip>,
    );
    expect(getByText("lung")).toBeInTheDocument();
    // Still a single link-wrapped chip — the pre-existing shape.
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toContain("UBERON_0002048");
    // No dot separator / predicate text leaked in from the statement path.
    expect(container.textContent).not.toContain("·");
  });
});

describe("OntologyTermChip — one-pair statement", () => {
  it("renders subject · predicate · object as one chip, not three", () => {
    const { container } = render(
      <OntologyTermChip
        uri="http://purl.org/commons/record/ncbi_gene/16153"
        pairs={[
          {
            predicate: "has_genotype",
            predicateUri: "http://purl.obolibrary.org/obo/GENO_0000222",
            object: "Homozygous negative",
            objectUri: "http://gemma.msl.ubc.ca/ont/TGEMO_00001",
          },
        ]}
      >
        Il10 [mouse] interleukin 10
      </OntologyTermChip>,
    );
    // Exactly one outer chip frame (one bordered/padded/rounded span),
    // not a chip-per-term — compactness constraint from the task.
    const frames = container.querySelectorAll("span.rounded");
    expect(frames).toHaveLength(1);
    expect(container.textContent).toContain("Il10 [mouse] interleukin 10");
    expect(container.textContent).toContain("has_genotype");
    expect(container.textContent).toContain("Homozygous negative");
    // Subject and object each link out independently (different URIs).
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toContain("16153");
    expect(links[1].getAttribute("href")).toContain("TGEMO_00001");
  });
});

describe("OntologyTermChip — two-pair statement", () => {
  it("expresses both pairs on one line without becoming a paragraph", () => {
    const { container } = render(
      <OntologyTermChip
        uri="http://purl.obolibrary.org/obo/NCBITaxon_1639"
        pairs={[
          { predicate: "has_genotype", predicateUri: null, object: "delta-A", objectUri: null },
          { predicate: "has_genotype", predicateUri: null, object: "delta-inlB", objectUri: null },
        ]}
      >
        Listeria monocytogenes
      </OntologyTermChip>,
    );
    // Still exactly one chip frame for both pairs together.
    const frames = container.querySelectorAll("span.rounded");
    expect(frames).toHaveLength(1);
    // whitespace-nowrap on the frame is what keeps it one line — assert
    // the class rather than a layout measurement jsdom can't give us.
    expect(frames[0].className).toContain("whitespace-nowrap");
    expect(container.textContent).toContain("Listeria monocytogenes");
    expect(container.textContent).toContain("delta-A");
    expect(container.textContent).toContain("delta-inlB");
    // Two separate "·" pairs (predicate+object) rendered, one per slot.
    expect(container.textContent?.match(/·/g)?.length).toBe(4);
  });
});

describe("OntologyTermChip — long object truncates", () => {
  it("caps the object's width and keeps the full text reachable via title, not by wrapping", () => {
    const longObject =
      "a very long free-text object value that would otherwise force the annotations card wide open";
    const { container } = render(
      <OntologyTermChip
        uri="http://purl.obolibrary.org/obo/NCBITaxon_1642"
        pairs={[
          { predicate: "has phenotype", predicateUri: null, object: longObject, objectUri: null },
        ]}
      >
        Listeria innocua
      </OntologyTermChip>,
    );
    const frame = container.querySelector("span.rounded");
    expect(frame?.className).toContain("whitespace-nowrap");
    // The label span itself (not its leaf wrapper, and not the
    // subject's own truncate span) carries the capped max-width, and
    // the FULL text in its title.
    const truncateSpans = Array.from(container.querySelectorAll("span.truncate"));
    const objectSpan = truncateSpans.find((s) => s.className.includes("max-w-[14ch]"));
    expect(objectSpan).toBeDefined();
    expect(objectSpan?.getAttribute("title")).toBe(longObject);
    expect(objectSpan?.textContent).toBe(longObject);
  });
});
