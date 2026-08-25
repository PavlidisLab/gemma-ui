/**
 * @vitest-environment jsdom
 *
 * Choosing the run, and what actually goes on the wire.
 *
 * The dialog's contract is that an option left alone is OMITTED, not
 * restated. Both endpoints resolve their own defaults, so a UI that
 * echoes them back pins today's defaults into the client and the two
 * drift apart silently the moment the agent changes one.
 *
 * The scope checkboxes carry a sharper version of the same rule: the
 * audit endpoint rejects `scope: []` with a 400, so "nothing ticked"
 * has to mean "send no scope at all". That is one wrong line away from
 * a run that always fails.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  AgentRunDialog,
  defaultRunKind,
  type AgentRunRequest,
} from "./AgentRunDialog";

vi.mock("@/api/agentConfig", () => ({
  useAgentConfig: () => ({ data: null }),
}));

const onSubmit = vi.fn();

beforeEach(() => onSubmit.mockReset());

function open(
  props: Partial<Parameters<typeof AgentRunDialog>[0]> = {},
) {
  return render(
    <AgentRunDialog
      open
      kind="proposal"
      mode="fresh"
      experimentShortName="GSE3253"
      hasCuratedFactors={false}
      agentStatus="up"
      busy={false}
      onCancel={vi.fn()}
      onSubmit={onSubmit}
      {...props}
    />,
  );
}

const submitted = (): AgentRunRequest => onSubmit.mock.calls[0][0];
const go = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /^(propose|run audit)$/i }));

describe("defaultRunKind", () => {
  it("audits where curated factors exist, proposes where they don't", () => {
    expect(defaultRunKind(true)).toBe("audit");
    expect(defaultRunKind(false)).toBe("proposal");
  });
});

describe("AgentRunDialog — what it sends", () => {
  it("sends the run alone when the curator touches nothing", async () => {
    const user = userEvent.setup();
    open();
    await go(user);
    // No tier, no refresh_cache, no withhold_publication — the agent's
    // own defaults stand.
    expect(submitted()).toEqual({ kind: "proposal", mode: "fresh" });
  });

  it("carries a chosen tier and leaves 'agent default' unsent", async () => {
    const user = userEvent.setup();
    open();
    await user.selectOptions(screen.getByRole("combobox"), "strong");
    await go(user);
    expect(submitted().tier).toBe("strong");

    onSubmit.mockReset();
    await user.selectOptions(screen.getByRole("combobox"), "");
    await go(user);
    expect(submitted()).not.toHaveProperty("tier");
  });

  it("carries refresh_cache only when ticked", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("checkbox", { name: /refresh cache/i }));
    await go(user);
    expect(submitted().refresh_cache).toBe(true);
  });

  it("carries withhold-publication when ticked on a proposal", async () => {
    const user = userEvent.setup();
    open();
    await user.click(
      screen.getByRole("checkbox", { name: /withhold publication/i }),
    );
    await go(user);
    expect(submitted().withhold_publication).toBe(true);
  });

  it("does not offer withhold-publication on an audit", () => {
    // Audit has no publication controls at all — the flag is a
    // proposer-side ablation and the endpoint would ignore it.
    open({ kind: "audit" });
    expect(
      screen.queryByRole("checkbox", { name: /withhold publication/i }),
    ).toBeNull();
  });
});

describe("AgentRunDialog — audit scope", () => {
  it("omits scope entirely when nothing is ticked (an empty one 400s)", async () => {
    const user = userEvent.setup();
    open({ kind: "audit" });
    await go(user);
    const req = submitted();
    expect(req.kind).toBe("audit");
    expect(req).not.toHaveProperty("scope");
  });

  it("sends only the ticked subset", async () => {
    const user = userEvent.setup();
    open({ kind: "audit" });
    await user.click(screen.getByRole("checkbox", { name: "tags" }));
    await user.click(screen.getByRole("checkbox", { name: "fvs" }));
    await go(user);
    expect(submitted().scope).toEqual(["tags", "fvs"]);
  });

  it("drops back to omitted when the curator unticks the last one", async () => {
    const user = userEvent.setup();
    open({ kind: "audit" });
    const tags = screen.getByRole("checkbox", { name: "tags" });
    await user.click(tags);
    await user.click(tags);
    await go(user);
    expect(submitted()).not.toHaveProperty("scope");
  });
});

describe("AgentRunDialog — the run selector", () => {
  it("marks the suggested run and lets the curator take the other one", async () => {
    const user = userEvent.setup();
    open({ kind: "audit", hasCuratedFactors: true });

    const auditChoice = screen.getByRole("button", { name: /^Audit/ });
    expect(auditChoice).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: /Blind proposal/ }));
    await go(user);
    expect(submitted().kind).toBe("proposal");
  });

  it("warns that a blind proposal will not see the curation that is there", async () => {
    const user = userEvent.setup();
    open({ kind: "audit", hasCuratedFactors: true });
    expect(screen.queryByText(/strips them first/i)).toBeNull();

    await user.click(screen.getByRole("button", { name: /Blind proposal/ }));
    expect(screen.getByText(/strips them first/i)).toBeTruthy();
  });

  it("says an audit has little to judge on an uncurated experiment", () => {
    open({ kind: "audit", hasCuratedFactors: false });
    expect(screen.getByText(/little to\s+judge/i)).toBeTruthy();
  });

  it("re-arms options on reopen so a withheld paper can't leak into the next run", async () => {
    const user = userEvent.setup();
    const { rerender } = open();
    await user.click(
      screen.getByRole("checkbox", { name: /withhold publication/i }),
    );

    const props = {
      kind: "proposal" as const,
      mode: "fresh" as const,
      experimentShortName: "GSE999",
      hasCuratedFactors: false,
      agentStatus: "up" as const,
      busy: false,
      onCancel: vi.fn(),
      onSubmit,
    };
    rerender(<AgentRunDialog open={false} {...props} />);
    rerender(<AgentRunDialog open {...props} />);

    expect(
      screen.getByRole("checkbox", { name: /withhold publication/i }),
    ).not.toBeChecked();
  });
});
