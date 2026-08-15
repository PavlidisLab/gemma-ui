import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());
vi.mock("./client", () => ({ api: { get } }));

import { queueGeneFetch } from "./genes";

function row(ncbiId: number, symbol: string, common: string, sci: string) {
  return {
    ncbi_id: ncbiId,
    official_symbol: symbol,
    official_name: `${symbol} name`,
    aliases: [],
    taxon: { common_name: common, scientific_name: sci },
  };
}

const ESR1_HUMAN = row(2099, "ESR1", "human", "Homo sapiens");
const ESR1_MOUSE = row(13982, "Esr1", "mouse", "Mus musculus");
const ESR1_RAT = row(24890, "Esr1", "rat", "Rattus norvegicus");

describe("gene lookup batching", () => {
  beforeEach(() => {
    get.mockReset();
  });

  it("asks for genes raised in the same tick in ONE request", async () => {
    get.mockResolvedValue([ESR1_HUMAN, ESR1_MOUSE, ESR1_RAT]);
    const all = await Promise.all([
      queueGeneFetch("2099"),
      queueGeneFetch("13982"),
      queueGeneFetch("24890"),
    ]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toBe("/rest/v2/genes/2099,13982,24890");
    expect(all.map((g) => g?.taxonCommonName)).toEqual([
      "human",
      "mouse",
      "rat",
    ]);
  });

  it("hands each waiter ITS gene, not the first row", async () => {
    // The whole surface exists to catch a species that belongs to a
    // different gene; handing chip B row A would manufacture exactly
    // that error.
    get.mockResolvedValue([ESR1_HUMAN, ESR1_MOUSE]);
    const [human, mouse] = await Promise.all([
      queueGeneFetch("2099"),
      queueGeneFetch("13982"),
    ]);
    expect(human?.taxonScientificName).toBe("Homo sapiens");
    expect(mouse?.taxonScientificName).toBe("Mus musculus");
  });

  it("resolves the same gene asked for twice from one request", async () => {
    get.mockResolvedValue([ESR1_HUMAN]);
    const [a, b] = await Promise.all([
      queueGeneFetch("2099"),
      queueGeneFetch("2099"),
    ]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(a?.symbol).toBe("ESR1");
    expect(b?.symbol).toBe("ESR1");
  });

  it("resolves every waiter to null when the batch fails", async () => {
    // Not a rejection: a chip that can't reach the catalogue falls back
    // to its label and flags, which is the degraded path it already has.
    get.mockRejectedValue(new Error("network"));
    const all = await Promise.all([
      queueGeneFetch("2099"),
      queueGeneFetch("13982"),
    ]);
    expect(all).toEqual([null, null]);
  });

  it("resolves a gene the batch didn't answer for to null", async () => {
    get.mockResolvedValue([ESR1_HUMAN]);
    const [known, missing] = await Promise.all([
      queueGeneFetch("2099"),
      queueGeneFetch("99999999"),
    ]);
    expect(known?.symbol).toBe("ESR1");
    expect(missing).toBeNull();
  });

  it("starts a fresh batch after one flushes", async () => {
    get.mockResolvedValue([ESR1_HUMAN]);
    await queueGeneFetch("2099");
    get.mockResolvedValue([ESR1_MOUSE]);
    await queueGeneFetch("13982");
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1][0]).toBe("/rest/v2/genes/13982");
  });
});
