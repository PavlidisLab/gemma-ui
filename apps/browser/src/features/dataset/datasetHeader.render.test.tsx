/**
 * @vitest-environment jsdom
 *
 * The dataset page's header, rendered.
 *
 * First render test in this app — nothing here used to render under
 * test, so every claim about this page was checked by eye. What it pins
 * is the line that says what kind of data the dataset is, because that
 * line has two sources and the cheap one is new: the payload's own
 * `libraryStrategies` / `librarySelections` / `extractedMolecules`
 * tallies when it carries them, and a fetch of every sample when it
 * does not. Both must put the same sentence on screen, and the fast
 * path must not fetch the samples at all — which is the whole point of
 * it and is invisible on screen.
 */
import { describe, expect, it, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderRoute } from "../../../test/renderRoute";
import {
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

let stub: GemmaFetchStub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
});

function mount(dataset: Record<string, unknown>, samples: unknown[] = []) {
  stub = installGemmaFetch([
    { match: /\/rest\/v2\/datasets\/1658\/samples/, body: page(samples) },
    { match: /\/rest\/v2\/datasets\/1658(\?|$)/, body: page([dataset]) },
    { match: /\/rest\/v2\/datasets\/GSE11630(\?|$)/, body: page([dataset]) },
  ]);
  return renderRoute("/dataset/1658");
}

/** One sample as `/datasets/{id}/samples` serves it. */
function sample(n: number, strategy: string | null) {
  return {
    id: n,
    name: `GSM${n}`,
    accession: { accession: `GSM${n}` },
    libraryStrategy: strategy,
    sampleUsed: { id: n, name: `GSM${n}` },
  };
}

describe("dataset header", () => {
  it("names the dataset from the payload", async () => {
    mount(DATASET);
    expect(await screen.findByText("GSE11630")).toBeInTheDocument();
    expect(
      screen.getByText(/Peripheral blood of patients with coronary artery/),
    ).toBeInTheDocument();
  });

  it("reads the kind off the payload's tallies, without fetching the samples", async () => {
    mount({
      ...DATASET,
      libraryStrategies: [{ value: "RNA-Seq", numberOfBioAssays: 58 }],
      extractedMolecules: [{ value: "polyA RNA", numberOfBioAssays: 58 }],
    });

    expect(await screen.findByText("RNA-Seq")).toBeInTheDocument();
    // 🛑 The saving IS the feature: the tallies exist so the page does
    // not pull every sample to read one field. Nothing on screen says
    // whether it did, so the assertion is on the wire.
    await waitFor(() =>
      expect(stub!.fetched(/\/datasets\/1658\/samples/)).toBe(false),
    );
  });

  it("says how many assays a partly-recorded field covers", async () => {
    mount({
      ...DATASET,
      libraryStrategies: [
        { value: "RNA-Seq", numberOfBioAssays: 45 },
        { value: null, numberOfBioAssays: 13 },
      ],
    });

    const kind = await screen.findByText("RNA-Seq");
    // A null entry is assays that record nothing — dropped from the
    // tallies, kept in the total, so the sentence reads "45 of 58"
    // rather than claiming all 58.
    expect(kind).toHaveAttribute("title", expect.stringContaining("45 of 58"));
  });

  it("falls back to the samples when the payload predates the tallies", async () => {
    mount(
      DATASET,
      Array.from({ length: 58 }, (_, i) => sample(i + 1, "RNA-Seq")),
    );

    expect(await screen.findByText("RNA-Seq")).toBeInTheDocument();
    await waitFor(() =>
      expect(stub!.fetched(/\/datasets\/1658\/samples/)).toBe(true),
    );
  });
});
