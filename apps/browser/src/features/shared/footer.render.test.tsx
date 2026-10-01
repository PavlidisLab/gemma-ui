/**
 * @vitest-environment jsdom
 *
 * The footer's Curation link.
 *
 * On a dataset page it opens that dataset in the curation app; anywhere
 * else, the curation dashboard. The curation app routes on the numeric
 * id (`#/experiments/1658`) while a dataset URL here may carry the short
 * name, so the link has to wait for the dataset to resolve — and should
 * get it from the page's own request rather than a second one.
 */
import { describe, expect, it, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderRoute } from "../../../test/renderRoute";
import {
  envelope,
  installGemmaFetch,
  page,
  type GemmaFetchStub,
} from "../../../test/gemmaFetch";
import { CURATOR, TAXA } from "../../../test/browseFixtures";

const DATASET = {
  id: 1658,
  shortName: "GSE11630",
  name: "Peripheral blood of patients with coronary artery disease",
  numberOfBioAssays: 58,
  taxon: TAXA[0],
  isPublic: true,
  troubled: false,
  characteristics: [],
  geeq: null,
};

let stub: GemmaFetchStub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
});

function mount(path: string, signedIn = true) {
  stub = installGemmaFetch([
    ...(signedIn ? [{ match: /\/rest\/v2\/me(\?|$)/, body: envelope(CURATOR) }] : []),
    { match: /\/rest\/v2\/datasets\/(1658|GSE11630)(\?|$)/, body: page([DATASET]) },
  ]);
  return renderRoute(path);
}

/** The footer's Curation link, once the viewer is known. */
async function curationLink(): Promise<HTMLAnchorElement> {
  const footer = (await screen.findByRole("contentinfo")) as HTMLElement;
  let link: HTMLAnchorElement | null = null;
  await waitFor(() => {
    link = footer.querySelector<HTMLAnchorElement>("a[href*='#/']");
    expect(link).not.toBeNull();
  });
  return link!;
}

describe("footer Curation link", () => {
  it("opens the dataset on a dataset page addressed by short name", async () => {
    mount("/dataset/GSE11630");
    const link = await curationLink();
    await waitFor(() => expect(link.getAttribute("href")).toMatch(/\/#\/experiments\/1658$/));
    expect(link).toHaveAttribute("title", "Open GSE11630 in Curation");
  });

  it("opens the dataset on a dataset page addressed by id", async () => {
    mount("/dataset/1658");
    const link = await curationLink();
    await waitFor(() => expect(link.getAttribute("href")).toMatch(/\/#\/experiments\/1658$/));
  });

  it("shares the page's request for the dataset", async () => {
    mount("/dataset/GSE11630");
    const link = await curationLink();
    await waitFor(() => expect(link.getAttribute("href")).toMatch(/experiments\/1658$/));
    expect(stub!.requests(/\/rest\/v2\/datasets\/GSE11630(\?|$)/)).toHaveLength(1);
  });

  it("opens the dashboard anywhere else", async () => {
    mount("/browser");
    const link = await curationLink();
    expect(link.getAttribute("href")).toMatch(/\/#\/$/);
    expect(link).not.toHaveAttribute("title");
  });

  it("is not there for a visitor who is not signed in", async () => {
    mount("/dataset/GSE11630", false);
    expect(await screen.findByText("Internal")).toBeInTheDocument();
    expect(screen.queryByText("Curation")).toBeNull();
  });
});
