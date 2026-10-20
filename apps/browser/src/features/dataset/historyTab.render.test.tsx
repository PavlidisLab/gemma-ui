/**
 * @vitest-environment jsdom
 *
 * The dataset page's History tab: the `/auditEvents` trail as a table,
 * admins only. A non-admin must not see the tab, and a hand-typed
 * `?tab=history` must not fetch the trail for them either.
 */
import { describe, expect, it, afterEach } from "vitest";
import { screen, within } from "@testing-library/react";

import { renderRoute } from "../../../test/renderRoute";
import {
  envelope,
  installGemmaFetch,
  page,
  type GemmaFetchStub,
} from "../../../test/gemmaFetch";

const DATASET = {
  id: 1658,
  shortName: "GSE11630",
  name: "Peripheral blood of patients with coronary artery disease",
  description: "An abstract.",
  numberOfBioAssays: 58,
  taxon: { id: 1, commonName: "human", scientificName: "Homo sapiens" },
  isPublic: true,
  troubled: false,
  lastUpdated: "2026-01-02T00:00:00Z",
  characteristics: [],
  geeq: null,
};

const ADMIN = { userName: "admin", authorities: ["GROUP_ADMIN", "GROUP_USER"] };

// As the server ships them: oldest first.
const EVENTS = [
  {
    id: 1, performer: "administrator", date: "2006-11-06T01:29:50.000+00:00",
    action: "C", actionName: "Create", eventTypeName: "",
    note: "Create ExpressionExperimentImpl 1", detail: null,
  },
  {
    id: 2, performer: "gemmaAgent", date: "2026-09-15T02:35:54.588+00:00",
    action: "U", actionName: "Update", eventTypeName: "SampleCorrelationAnalysisEvent",
    note: "Sample correlation has been computed.", detail: "a long stack trace",
  },
];

let stub: GemmaFetchStub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
});

function mount(path: string, me: unknown | null) {
  stub = installGemmaFetch([
    ...(me ? [{ match: /\/rest\/v2\/me(\?|$)/, body: envelope(me) }] : []),
    { match: /\/rest\/v2\/datasets\/1658\/auditEvents/, body: envelope(EVENTS) },
    // The admin header reads this; it isn't what's under test.
    { match: /\/rest\/v2\/datasets\/1658\/pipelineStatus/, body: envelope({
      datasetId: 1658, steps: [], hasBatchInformation: false, hasDea: false,
      hasCoexpressionAnalysis: false, isTroubled: false, needsAttention: false, isPublic: true,
    }) },
    { match: /\/rest\/v2\/datasets\/1658(\?|$)/, body: page([DATASET]) },
    { match: /\/rest\/v2\/datasets\/GSE11630(\?|$)/, body: page([DATASET]) },
  ]);
  return renderRoute(path);
}

describe("dataset History tab", () => {
  it("lists the audit trail newest first, one column per field", async () => {
    mount("/dataset/1658?tab=history", ADMIN);
    expect(await screen.findByText("SampleCorrelationAnalysisEvent")).toBeInTheDocument();

    const rows = screen.getAllByRole("row");
    expect(within(rows[0]).getAllByRole("columnheader").map((h) => h.textContent))
      .toEqual(["Date", "Performer", "Event type", "Comment"]);
    expect(rows[1]).toHaveTextContent("gemmaAgent");
    expect(rows[1]).toHaveTextContent("Sample correlation has been computed.");
    // An untyped event says which action it was rather than leave a blank.
    expect(rows[2]).toHaveTextContent("administrator");
    expect(rows[2]).toHaveTextContent("Create");
    expect(screen.getByText("a long stack trace")).toBeInTheDocument();
  });

  it("is hidden from non-admins, and a typed URL does not fetch the trail", async () => {
    mount("/dataset/1658?tab=history", null);
    expect(await screen.findByText("GSE11630")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /History/ })).toBeNull();
    expect(stub!.calls.some((u) => u.includes("/auditEvents"))).toBe(false);
  });
});
