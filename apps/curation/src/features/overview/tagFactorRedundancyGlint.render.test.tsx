/**
 * @vitest-environment jsdom
 *
 * A direct EE-tag whose term is also a factor value is MARKED
 * redundant, not hidden.
 *
 * GSE276387 (eid 40317) is the case: a stored `disease: lung
 * adenocarcinoma` ExperimentTag beside a `disease` factor whose FV
 * 290745 carries the same MONDO term. The chip used to be dropped
 * when the FV-synth chip was on screen and to reappear when "Hide
 * variables" removed it — a noise toggle deciding whether curation
 * content rendered. A redundant tag is a deletion candidate, so it
 * has to be visible to be actionable.
 *
 * NOT tested here: the ring is asserted by class name, so the glint's
 * actual colour and glow are not verified by a green run.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/features/design/DesignDraftContext", () => ({
  useDesignDraft: () => ({ draft: null, apply: vi.fn() }),
  useDatasetTaxon: () => null,
}));
vi.mock("@/features/comparison/FlowContext", () => ({
  useIsReadOnly: () => false,
}));

import { EditableDirectGroupChip } from "./TagBar";
import type { Tag } from "@/features/experiment/types";

afterEach(cleanup);

const DISEASE = {
  label: "disease",
  uri: "http://www.ebi.ac.uk/efo/EFO_0000408",
} as Tag["category"];
const LUAD = "http://purl.obolibrary.org/obo/MONDO_0005061";

const tag = (uri: string | null, statements: unknown[] = []): Tag =>
  ({
    id: 56966403,
    category: DISEASE,
    value: { label: "lung adenocarcinoma", uri },
    statements,
  }) as unknown as Tag;

const chipFor = (t: Tag, factorMatchKeys?: Set<string>) => {
  const { container } = render(
    <EditableDirectGroupChip
      category={DISEASE}
      tags={[t]}
      factorMatchKeys={factorMatchKeys}
    />,
  );
  // The outer chip is the one carrying the audit-focus hook.
  return container.querySelector("[data-audit-target]") as HTMLElement;
};

const FACTOR_KEYS = new Set([`disease|${LUAD}`]);

describe("direct EE-tag redundant with a factor value", () => {
  it("still renders — the chip is never dropped", () => {
    chipFor(tag(LUAD), FACTOR_KEYS);
    expect(screen.getByText("lung adenocarcinoma")).toBeTruthy();
  });

  it("carries the violet redundancy glint", () => {
    const chip = chipFor(tag(LUAD), FACTOR_KEYS);
    expect(chip.className).toContain("ring-violet-500");
  });

  it("names the factor as the carrier in the hover title", () => {
    const chip = chipFor(tag(LUAD), FACTOR_KEYS);
    expect(chip.getAttribute("title")).toContain("factor value");
  });

  it("does not glint when no factor carries the term", () => {
    const chip = chipFor(tag(LUAD), new Set<string>());
    expect(chip.className).not.toContain("ring-violet-500");
  });

  it("does not glint on a free-text tag — there is no term to match", () => {
    const chip = chipFor(tag(null), FACTOR_KEYS);
    expect(chip.className).not.toContain("ring-violet-500");
  });

  it("does not glint on a statement-shaped tag — it asserts more than the term", () => {
    const chip = chipFor(
      tag(LUAD, [
        {
          category: DISEASE,
          subject: { label: "lung adenocarcinoma", uri: LUAD },
          predicate: { label: "has modifier", uri: null },
          object: { label: "metastatic", uri: null },
          supporting_evidence: [],
        },
      ]),
      FACTOR_KEYS,
    );
    expect(chip.className).not.toContain("ring-violet-500");
  });
});
