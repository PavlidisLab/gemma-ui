/**
 * @vitest-environment jsdom
 *
 * TagStatementInline — a shared subject prints ONCE.
 *
 * The fold's arithmetic is pinned in `tagStatementFold.test.ts`; this
 * checks the thing the curator actually sees, because a fold that
 * computes correctly and still renders the subject twice fixes
 * nothing.
 */
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TagStatementInline } from "./TagBar";
import type { Statement } from "@/features/experiment/types";

afterEach(cleanup);

const term = (label: string, uri?: string) => ({ label, uri: uri ?? null });
const stmt = (
  subject: string,
  predicate: string | null,
  object: string | null,
  objectUri?: string,
): Statement =>
  ({
    gemma_id: null,
    subject: term(subject),
    predicate: predicate ? term(predicate) : null,
    object: object ? term(object, objectUri) : null,
  }) as unknown as Statement;

describe("TagStatementInline — shared subject", () => {
  it("prints the subject once and both objects", () => {
    render(
      <TagStatementInline
        statements={[
          stmt("mixed C57BL/6J x C3H/HeJ", "derives from", "C57BL/6J"),
          stmt("mixed C57BL/6J x C3H/HeJ", "derives from", "C3H/HeJ"),
        ]}
      />,
    );
    expect(screen.getAllByText("mixed C57BL/6J x C3H/HeJ")).toHaveLength(1);
    // The repeated predicate collapses with its subject.
    expect(screen.getAllByText("derives from")).toHaveLength(1);
    // Both objects survive the fold — nothing is swallowed.
    expect(screen.getByText("C57BL/6J")).toBeTruthy();
    expect(screen.getByText("C3H/HeJ")).toBeTruthy();
  });

  it("keeps two distinct predicates visible under the one subject", () => {
    render(
      <TagStatementInline
        statements={[
          stmt("HeLa", "derives from", "cervix"),
          stmt("HeLa", "has disease", "adenocarcinoma"),
        ]}
      />,
    );
    expect(screen.getAllByText("HeLa")).toHaveLength(1);
    expect(screen.getByText("derives from")).toBeTruthy();
    expect(screen.getByText("has disease")).toBeTruthy();
    expect(screen.getByText("cervix")).toBeTruthy();
    expect(screen.getByText("adenocarcinoma")).toBeTruthy();
  });

  it("renders a lone statement as one line, subject through object", () => {
    const { container } = render(
      <TagStatementInline
        statements={[stmt("Abca4", "has genotype", "homozygous negative")]}
      />,
    );
    expect(screen.getByText("Abca4")).toBeTruthy();
    expect(screen.getByText("has genotype")).toBeTruthy();
    expect(screen.getByText("homozygous negative")).toBeTruthy();
    // No indented sub-list for the common case.
    expect(container.querySelectorAll(".pl-2")).toHaveLength(0);
  });

  it("does not merge two different subjects", () => {
    render(
      <TagStatementInline
        statements={[
          stmt("Abca4", "has genotype", "null"),
          stmt("Rho", "has genotype", "null"),
        ]}
      />,
    );
    expect(screen.getByText("Abca4")).toBeTruthy();
    expect(screen.getByText("Rho")).toBeTruthy();
    expect(screen.getAllByText("has genotype")).toHaveLength(2);
  });
});

describe("TagStatementInline — grounded terms carry their CURIE", () => {
  it("shows the term id beside a grounded object", () => {
    // The single-value path in this same chip has rendered a CurieLink
    // since 2026-06-15; a statement-structured tag was the only place
    // in the chip without one.
    render(
      <TagStatementInline
        statements={[
          stmt(
            "mixed C57BL/6J x C3H/HeJ",
            "derives from",
            "C57BL/6J",
            "http://purl.obolibrary.org/obo/NCBITaxon_10090",
          ),
        ]}
      />,
    );
    // Uppercased prefix is `shortenUri`'s existing behaviour for an
    // underscore CURIE, shared with the browser app. Pinned as-is
    // rather than quietly changed here.
    expect(screen.getByText("NCBITAXON:10090")).toBeTruthy();
  });

  it("shows nothing extra for an ungrounded term", () => {
    render(
      <TagStatementInline
        statements={[stmt("free text subject", "derives from", "also free")]}
      />,
    );
    expect(screen.queryByText(/:/)).toBeNull();
  });
});
