import { describe, expect, it } from "vitest";
import { resolveGemmaMode } from "./gemmaMode";

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
