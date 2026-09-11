/**
 * @vitest-environment jsdom
 *
 * What "add to ticket / scratchpad" actually puts on the wire.
 *
 * 🛑 `client.ts` snakeifies RESPONSES only; request bodies go out
 * verbatim. So the two backends need two bodies for the same call: the
 * store reads `target_type` / `target_id`, Gemma reads `targetType` /
 * `targetId` and answers *"Each target requires targetType and
 * targetId"* when it gets the other spelling — which is the failure
 * `gemmaCreateBody` was written for, and which this route skipped.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";

const mode = vi.hoisted(() => ({ current: "remote" as "remote" | "local" }));
vi.mock("@/lib/gemmaMode", async (orig) => {
  const actual = await orig<typeof import("@/lib/gemmaMode")>();
  return {
    ...actual,
    resolveGemmaMode: () => ({ ...actual.resolveGemmaMode(), mode: mode.current }),
    useGemmaMode: () => ({ ...actual.resolveGemmaMode(), mode: mode.current }),
  };
});

const sent = vi.hoisted(() => ({ calls: [] as Array<[string, unknown]> }));
vi.mock("@/api/client", async (orig) => {
  const actual = await orig<typeof import("@/api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      post: async (url: string, body: unknown) => {
        sent.calls.push([url, body]);
        return { added: [], already_present: [], ticket: { id: 7 } };
      },
    },
  };
});

import { gemmaTargets, useAddTicketTargets } from "./tickets";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

async function addTargets(to: "remote" | "local") {
  mode.current = to;
  sent.calls.length = 0;
  const { result } = renderHook(() => useAddTicketTargets(7), { wrapper });
  await act(async () => {
    await result.current.mutateAsync([{ target_id: 861 }]);
  });
  return sent.calls[0];
}

beforeEach(() => {
  sent.calls.length = 0;
});

describe("gemmaTargets", () => {
  it("rewrites the store's key names", () => {
    expect(
      gemmaTargets([{ target_type: "EXPRESSION_EXPERIMENT", target_id: 861 }]),
    ).toEqual([{ targetType: "EXPRESSION_EXPERIMENT", targetId: 861 }]);
  });

  it("names EXPRESSION_EXPERIMENT when the caller left it off", () => {
    expect(gemmaTargets([{ target_id: 861 }])).toEqual([
      { targetType: "EXPRESSION_EXPERIMENT", targetId: 861 },
    ]);
  });

  it("carries a status only when one was set", () => {
    expect(gemmaTargets([{ target_id: 1, status: "DONE" }])[0].status).toBe("DONE");
    expect(gemmaTargets([{ target_id: 1 }])[0]).not.toHaveProperty("status");
  });

  it("🛑 refuses a target type Gemma's enum does not have", () => {
    // GEO_ACCESSION is the store's synthetic triage row — an accession
    // Gemma has not imported, which by construction cannot exist there.
    expect(() =>
      gemmaTargets([{ target_type: "GEO_ACCESSION", target_id: 3 }]),
    ).toThrow(/GEO_ACCESSION/);
  });

  it("🛑 emits no snake_case key at all", () => {
    const [t] = gemmaTargets([{ target_id: 861, status: "NOT_DONE" }]);
    expect(Object.keys(t).filter((k) => k.includes("_"))).toEqual([]);
  });
});

describe("useAddTicketTargets", () => {
  it("🛑 sends camelCase to Gemma", async () => {
    const [url, body] = await addTargets("remote");
    expect(url).toBe("/rest/v2/tickets/7/targets");
    expect(body).toEqual({
      targets: [{ targetType: "EXPRESSION_EXPERIMENT", targetId: 861 }],
    });
  });

  it("sends snake_case to the store", async () => {
    const [url, body] = await addTargets("local");
    expect(url).toBe("/curation/v1/tickets/7/targets");
    expect(body).toEqual({
      targets: [{ target_type: "EXPRESSION_EXPERIMENT", target_id: 861 }],
    });
  });
});
