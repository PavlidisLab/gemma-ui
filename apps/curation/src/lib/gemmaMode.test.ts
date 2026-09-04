import { afterEach, describe, expect, it } from "vitest";
import { resolveGemmaMode, setRuntimeConfig } from "./gemmaMode";

/**
 * Pin the runtime > build-time > default precedence the runtime-config
 * change introduced.
 *
 * The build-time layer (``import.meta.env.VITE_*``) may or may not be
 * set in a given runner, so we assert against the no-arg *baseline*
 * rather than a hardcoded default — the env-independent invariant is
 * "a runtime value overrides the baseline; an absent one does not."
 */
describe("resolveGemmaMode — runtime config precedence", () => {
  const baseline = resolveGemmaMode();

  it("a runtime ontology host overrides the build-time / default baseline", () => {
    const r = resolveGemmaMode({
      gemmaOntologyUrl: "http://example-ontology.test:9999",
    });
    expect(r.ontologyUrl).toBe("http://example-ontology.test:9999");
    expect(r.ontologyHost).toBe("example-ontology.test:9999");
    expect(r.ontologyHost).not.toBe(baseline.ontologyHost);
  });

  it("an absent / null / empty runtime value leaves the baseline untouched", () => {
    expect(resolveGemmaMode().ontologyHost).toBe(baseline.ontologyHost);
    expect(resolveGemmaMode(null).ontologyHost).toBe(baseline.ontologyHost);
    expect(resolveGemmaMode({}).ontologyHost).toBe(baseline.ontologyHost);
    expect(resolveGemmaMode({ gemmaOntologyUrl: "" }).ontologyHost).toBe(
      baseline.ontologyHost,
    );
    expect(resolveGemmaMode({}).mode).toBe("local");
  });

  it("runtime mode=remote points ontology at the gemma base host", () => {
    const r = resolveGemmaMode({
      mode: "remote",
      gemmaBaseUrl: "https://gemma.msl.ubc.ca",
    });
    expect(r.mode).toBe("remote");
    expect(r.baseHost).toBe("gemma.msl.ubc.ca");
    // Remote: the same Gemma host serves ontologies, so no split.
    expect(r.ontologyHost).toBe("gemma.msl.ubc.ca");
    expect(r.ontologySplit).toBe(false);
    expect(r.isProd).toBe(true);
  });

  it("ignores runtime gemmaBaseUrl in local mode (it's the proposer's remote target, not the UI backend)", () => {
    const r = resolveGemmaMode({
      gemmaBaseUrl: "http://example-ontology-host.test:8080",
    });
    expect(r.mode).toBe("local");
    expect(r.baseHost).not.toBe("example-ontology-host.test:8080");
  });
});

/**
 * Which tier a remote host lands in.
 *
 * 🛑 This describe exists because the previous rule could not fire for
 * the host we actually point at. ``PROD_GEMMA_HOSTS`` held only the
 * Gemma 1.x names, and the staging fallback was
 * ``baseHost.includes("gemma.msl.ubc.ca")`` — false for the string
 * "gemma2.msl.ubc.ca". So remote mode against production took the
 * mildest tier the chip had, and no test said otherwise.
 *
 * Measured 2026-08-28: ``/rest/v2/datasets/count`` returns 25,694 on
 * gemma.msl.ubc.ca and 25,695 on gemma2.msl.ubc.ca as ``administrator``
 * — both the real corpus, one dataset apart.
 */
describe("resolveGemmaMode — host tier", () => {
  const remote = (gemmaBaseUrl: string) =>
    resolveGemmaMode({ mode: "remote", gemmaBaseUrl });

  it("gemma2 is production — the case that used to fall through both tiers", () => {
    const r = remote("https://gemma2.msl.ubc.ca");
    expect(r.baseHost).toBe("gemma2.msl.ubc.ca");
    expect(r.isProd).toBe(true);
    expect(r.isUnverified).toBe(false);
  });

  it("gemma (1.x) is production", () => {
    const r = remote("https://gemma.msl.ubc.ca");
    expect(r.isProd).toBe(true);
    expect(r.isUnverified).toBe(false);
  });

  it("an unrecognized remote host fails CLOSED to the warning tier", () => {
    const r = remote("http://localhost:8081");
    expect(r.baseHost).toBe("localhost:8081");
    expect(r.isProd).toBe(false);
    expect(r.isUnverified).toBe(true);
  });

  it("a prod-suffixed host does not inherit the prod tier", () => {
    // staging-gemma.msl.ubc.ca ends in the prod hostname. Substring
    // matching would have called it prod; the set does not.
    const r = remote("https://staging-gemma.msl.ubc.ca");
    expect(r.isProd).toBe(false);
    expect(r.isUnverified).toBe(true);
  });

  it("local mode is in neither tier", () => {
    const r = resolveGemmaMode({ mode: "local" });
    expect(r.isProd).toBe(false);
    expect(r.isUnverified).toBe(false);
  });
});

describe("runtime config reaches callers outside React", () => {
  afterEach(() => setRuntimeConfig(null));

  // 🛑 The mode had two answers before this: `useGemmaMode()` read the
  // runtime config through the provider while a plain
  // `resolveGemmaMode()` in a queryFn saw only the build-time env. A
  // bundle built remote whose runtime config says local then fetched
  // Gemma paths while the chip read LOCAL. Caught 2026-09-03 by four
  // @critical specs timing out on an aborted `annotation-sets` call.
  it("lets a published runtime config decide the mode", () => {
    setRuntimeConfig({ mode: "remote", gemmaBaseUrl: "https://gemma2.msl.ubc.ca" });
    expect(resolveGemmaMode().mode).toBe("remote");
    setRuntimeConfig({ mode: "local" });
    expect(resolveGemmaMode().mode).toBe("local");
  });

  it("still answers from build-time env when asked with an explicit null", () => {
    setRuntimeConfig({ mode: "remote", gemmaBaseUrl: "https://gemma2.msl.ubc.ca" });
    // `null` is the deliberate "ignore the cache" call; `undefined`
    // (the usual one) consults it.
    expect(resolveGemmaMode(null).mode).toBe("local");
  });

  it("falls back to build-time when nothing has been published", () => {
    expect(resolveGemmaMode().mode).toBe("local");
  });
});
