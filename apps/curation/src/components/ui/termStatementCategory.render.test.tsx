/**
 * @vitest-environment jsdom
 *
 * The statement-category hover line (2026-08-19, ticket 190 /
 * GSE17482): an agent payload shipped a grounded factor category with
 * uri-less statement categories, and nothing on screen could show the
 * difference before adopting. Comparison-surface subject chips now
 * carry a ``category: …`` line in their tooltip stating exactly what
 * the payload holds — grounded CURIE or "free text".
 */
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { Term } from "./Term";

const DU145 = "http://purl.obolibrary.org/obo/CLO_0002840";
const CLO_CELL_LINE = "http://purl.obolibrary.org/obo/CLO_0000031";

function chip(node: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
  );
}

function outerTitle(container: HTMLElement): string {
  const el = container.querySelector("span[title]");
  return el?.getAttribute("title") ?? "";
}

describe("Term — statement-category tooltip line", () => {
  it("an ungrounded statement category reads as free text on hover", () => {
    const { container } = chip(
      <Term
        uri={DU145}
        asLink={false}
        statementCategory={{ label: "cell line", uri: null }}
      >
        DU 145 cell
      </Term>,
    );
    const title = outerTitle(container);
    expect(title).toContain(DU145);
    expect(title).toContain("category: cell line — free text (no ontology term)");
  });

  it("a grounded statement category shows its CURIE", () => {
    const { container } = chip(
      <Term
        uri={DU145}
        asLink={false}
        statementCategory={{ label: "cell line", uri: CLO_CELL_LINE }}
      >
        DU 145 cell
      </Term>,
    );
    expect(outerTitle(container)).toContain("category: cell line — CLO:0000031");
  });

  it("no statementCategory → the tooltip is exactly the URI, as before", () => {
    const { container } = chip(
      <Term uri={DU145} asLink={false}>
        DU 145 cell
      </Term>,
    );
    expect(outerTitle(container)).toBe(DU145);
  });
});
