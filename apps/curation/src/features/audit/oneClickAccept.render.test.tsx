/**
 * @vitest-environment jsdom
 *
 * One-click Accept, over the agents' kind list: in remote mode, every
 * kind the agent executes renders an Accept that calls
 * `POST /curation-apply` exactly once, and touches neither the design
 * draft nor the disposition PATCH — the agent does both.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

const { post } = vi.hoisted(() => ({
  post: vi.fn<(url: string, body?: unknown) => Promise<unknown>>(),
}));
vi.mock("@/api/client", async (orig) => {
  const actual = await orig<typeof import("@/api/client")>();
  return { ...actual, api: { ...actual.api, post } };
});
vi.mock("@/lib/gemmaMode", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/gemmaMode")>("@/lib/gemmaMode");
  return { ...actual, useGemmaMode: vi.fn() };
});

import type { AuditFinding, AuditReport } from "@/api/auditTypes";
import { ApiError } from "@/api/client";
import type { Design } from "@/features/experiment/types";
import { resolveGemmaMode, useGemmaMode } from "@/lib/gemmaMode";

import { FindingActionRow } from "./findingCard";
import { EXECUTING_KINDS } from "./oneClickApply";
import {
  makeAuditCtx,
  makeDraftCtx,
  makeToastCtx,
  renderWithProviders,
} from "./testRender";

function findingFor(kind: string): AuditFinding {
  return {
    finding_id: `f-${kind}`,
    target_kind: "experiment",
    target_id: `experiment:one-click-${kind}`,
    severity: "major",
    issue_code: "one_click_test",
    rationale: "test",
    rationale_summary: "",
    rationale_bin: "",
    citation: "",
    citation_url: "",
    supporting_evidence: [],
    why: null,
    reviews: [],
    comparison: null,
    apply_action: { kind },
  } as unknown as AuditFinding;
}

function emptyDraft(): Design {
  return {
    tags: [],
    factors: [],
    biomaterials: [],
    publications: [],
  } as unknown as Design;
}

function mount(
  finding: AuditFinding,
  opts: { dirty?: boolean; reviewer?: string } = {},
) {
  const setDisposition = vi.fn().mockResolvedValue(undefined);
  const applyDraft = vi.fn();
  const reload = vi.fn();
  const toast = makeToastCtx();
  const report = {
    audit_id: "123",
    experiment_id: 1,
    experiment_short_name: "GSE0",
    findings: [finding],
    evidence: { comparison_proposal: null },
  } as unknown as AuditReport;
  renderWithProviders(<FindingActionRow finding={finding} />, {
    audit: {
      ...makeAuditCtx({ findings: [finding], report, setDisposition }),
      reviewer: opts.reviewer ?? "alice",
    },
    draft: makeDraftCtx(emptyDraft(), {
      apply: applyDraft,
      reload,
      diff: { isDirty: !!opts.dirty } as never,
    }),
    toast,
  });
  return { setDisposition, applyDraft, reload, toast };
}

function setMode(mode: "remote" | "local") {
  vi.mocked(useGemmaMode).mockReturnValue({ ...resolveGemmaMode(), mode });
}

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({ status: "ready", detail: "adds a pair", verified: true });
  setMode("remote");
});
afterEach(cleanup);

describe("one-click Accept — every executing kind", () => {
  for (const kind of [...EXECUTING_KINDS].sort()) {
    it(`${kind}: one call to the route, no draft edit, no PATCH`, async () => {
      const { setDisposition, applyDraft, reload, toast } = mount(
        findingFor(kind),
      );

      fireEvent.click(screen.getByTestId("one-click-accept"));

      await waitFor(() => expect(toast.show).toHaveBeenCalledTimes(1));
      expect(post).toHaveBeenCalledTimes(1);
      // Refetch, not reload: a reload waits for a CHANGED design and
      // strands the page when the apply changed nothing.
      expect(reload).not.toHaveBeenCalled();
      expect(post.mock.calls[0][0]).toBe(
        `/curation-apply/123/f-${kind}?onBehalfOf=alice`,
      );
      expect(applyDraft).not.toHaveBeenCalled();
      expect(setDisposition).not.toHaveBeenCalled();
    });
  }
});

describe("one-click Accept — the curator's reason", () => {
  it("an agent-extra asks why first, and the note travels with the apply", async () => {
    const finding = {
      ...findingFor("add_tag"),
      issue_code: "calibration_agent_extra",
    } as AuditFinding;
    const { toast } = mount(finding);

    fireEvent.click(screen.getByTestId("one-click-accept"));
    expect(post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText("note (optional)"), {
      target: { value: "named in the methods" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));

    await waitFor(() => expect(toast.show).toHaveBeenCalled());
    expect(post).toHaveBeenCalledTimes(1);
    expect(String(post.mock.calls[0][0])).toContain("/curation-apply/123/");
    expect(post.mock.calls[0][1]).toEqual({
      reason: expect.stringContaining("named in the methods"),
    });
  });
});

describe("one-click Accept — when it does not run", () => {
  it("local mode keeps the existing path", () => {
    setMode("local");
    mount(findingFor("remove_tag"));
    expect(screen.queryByTestId("one-click-accept")).toBeNull();
  });

  it("a kind the agent does not execute keeps the existing path", () => {
    mount(findingFor("needs_curator_decision"));
    expect(screen.queryByTestId("one-click-accept")).toBeNull();
  });

  it("uncommitted design edits block the click and say why", async () => {
    const { toast } = mount(findingFor("remove_tag"), { dirty: true });
    fireEvent.click(screen.getByTestId("one-click-accept"));
    await waitFor(() => expect(toast.show).toHaveBeenCalled());
    expect(post).not.toHaveBeenCalled();
    expect(String(toast.show.mock.calls[0][0])).toMatch(/design edits/);
  });

  it("a refusal says so and writes nothing", async () => {
    post.mockRejectedValue(
      new ApiError("422", 422, "Unprocessable", "{}", {
        detail: { error: "refused", detail: "the finding names no pair to delete" },
      }),
    );
    const { toast } = mount(findingFor("drop_statements"));
    fireEvent.click(screen.getByTestId("one-click-accept"));
    await waitFor(() => expect(toast.show).toHaveBeenCalled());
    expect(String(toast.show.mock.calls[0][0])).toContain(
      "nothing written: the finding names no pair to delete",
    );
  });
});
