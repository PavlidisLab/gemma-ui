/**
 * @vitest-environment jsdom
 *
 * The base handed to a third party is not the base this app talks to.
 *
 * UCSC fetches the PSL custom track itself, and got
 * `http://frink.msl.ubc.ca:8080/rest/v2/...` — the dev proxy target —
 * answering "connection timed out: either the server is offline or a
 * firewall between UCSC and the server blocks the connection". These
 * pin the separation so the internal address can't come back.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const PATH = "/rest/v2/platforms/1/elements/22283/pslTrack";

/** Re-import with a given configured base + page origin. The module
 *  reads both at load, so each case needs a fresh module registry. */
async function load(opts: { baseUrl?: string; origin?: string; publicUrl?: string }) {
  vi.resetModules();
  vi.stubGlobal("__GEMMA_TARGET__", opts.baseUrl ?? "");
  vi.stubEnv("VITE_GEMMA_BASE_URL", "");
  vi.stubEnv("VITE_GEMMA_PUBLIC_URL", opts.publicUrl ?? "");
  if (opts.origin) {
    Object.defineProperty(window, "location", {
      value: { origin: opts.origin },
      writable: true,
    });
  }
  return await import("./gemmaConfig");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("publicGemmaUrl", () => {
  it("refuses the internal dev target that UCSC could not reach", async () => {
    const { publicGemmaUrl } = await load({
      baseUrl: "http://frink.msl.ubc.ca:8080",
      origin: "http://localhost:5183",
    });
    expect(publicGemmaUrl(PATH)).toBe("");
  });

  it("uses a public https base when that is what is configured", async () => {
    const { publicGemmaUrl } = await load({
      baseUrl: "https://gemma2.msl.ubc.ca",
      origin: "http://localhost:5183",
    });
    expect(publicGemmaUrl(PATH)).toBe("https://gemma2.msl.ubc.ca" + PATH);
  });

  it("uses the page's own origin in production, needing no config", async () => {
    // Served from the public Gemma — its origin IS the public base, and
    // it wins over whatever the app proxies to.
    const { publicGemmaUrl } = await load({
      baseUrl: "http://frink.msl.ubc.ca:8080",
      origin: "https://gemma2.msl.ubc.ca",
    });
    expect(publicGemmaUrl(PATH)).toBe("https://gemma2.msl.ubc.ca" + PATH);
  });

  it("refuses a dev server reached over the network, not just loopback", async () => {
    // `npm run dev -- --host`, opened from another machine. Not
    // loopback, so an origin check that only excluded localhost let
    // this through — and UCSC cannot reach a LAN address any more than
    // it could reach frink.
    for (const origin of [
      "http://192.168.1.50:5183",
      "http://dev-box.msl.ubc.ca:5183",
    ]) {
      const { publicGemmaUrl } = await load({
        baseUrl: "http://frink.msl.ubc.ca:8080",
        origin,
      });
      expect(publicGemmaUrl(PATH)).toBe("");
    }
  });

  it("falls through to the configured base when served over https on loopback", async () => {
    const { publicGemmaUrl } = await load({
      baseUrl: "https://gemma2.msl.ubc.ca",
      origin: "https://localhost:5183",
    });
    expect(publicGemmaUrl(PATH)).toBe("https://gemma2.msl.ubc.ca" + PATH);
  });

  it("lets an explicit public URL override everything", async () => {
    const { publicGemmaUrl } = await load({
      baseUrl: "http://frink.msl.ubc.ca:8080",
      origin: "http://localhost:5183",
      publicUrl: "https://elsewhere.example/",
    });
    expect(publicGemmaUrl(PATH)).toBe("https://elsewhere.example" + PATH);
  });
});
