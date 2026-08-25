/**
 * @vitest-environment jsdom
 *
 * Importing an experiment from Gemma into a review ticket.
 *
 * Two things are pinned here because both are invisible in the UI and
 * both would be silent if they broke:
 *
 *  - the body carries the accession and NOTHING else by default. The
 *    server owns the `REVIEW` / `review` / `strip_curation=false`
 *    defaults; a client-side copy of them is a second definition free
 *    to drift, and `strip_curation` in particular decides whether the
 *    curator reviews Gemma's curation or a stripped experiment.
 *  - a failed import leaves the modal open with the fields intact. No
 *    ticket is created when the import fails, so retrying is safe, and
 *    the likeliest fix is an edit to the accession the curator just
 *    typed.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { ApiError } from "@/api/client";
import {
  CreateReviewTicketModal,
  importErrorMessage,
} from "./CreateReviewTicketModal";

const mutate = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({
  isPending: false,
  isError: false,
  error: null as unknown,
}));

vi.mock("@/api/tickets", () => ({
  useCreateTicketFromAccession: () => ({
    mutate,
    reset: vi.fn(),
    isPending: state.isPending,
    isError: state.isError,
    error: state.error,
  }),
}));

beforeEach(() => {
  mutate.mockReset();
  state.isPending = false;
  state.isError = false;
  state.error = null;
});

function open(onCreated = vi.fn()) {
  return render(
    <CreateReviewTicketModal open onClose={vi.fn()} onCreated={onCreated} />,
  );
}

describe("CreateReviewTicketModal", () => {
  it("sends the accession alone when title and note are blank", async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText(/accession/i), "GSE12345");
    await user.click(screen.getByRole("button", { name: /import & open/i }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const body = mutate.mock.calls[0][0];
    // Exactly one key. Not `title: ""` (the server derives a name from
    // the imported design, which it knows and we don't), and above all
    // no `strip_curation` / `type` / `flow`.
    expect(body).toEqual({ accession: "GSE12345" });
  });

  it("trims the accession and carries a title and note when given", async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText(/accession/i), "  GSE9 ");
    await user.type(screen.getByLabelText(/title/i), "Vaccine study");
    await user.type(screen.getByLabelText(/note/i), "second pass");
    await user.click(screen.getByRole("button", { name: /import & open/i }));

    expect(mutate.mock.calls[0][0]).toEqual({
      accession: "GSE9",
      title: "Vaccine study",
      body: "second pass",
    });
  });

  it("won't submit an empty accession", async () => {
    const user = userEvent.setup();
    open();

    const submit = screen.getByRole("button", { name: /import & open/i });
    expect(submit).toBeDisabled();
    await user.click(submit);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("keeps the typed accession on screen after a failed import", async () => {
    const user = userEvent.setup();
    const { rerender } = open();

    await user.type(screen.getByLabelText(/accession/i), "GSE404");

    state.isError = true;
    state.error = new ApiError("not found", 404, "Not Found", "no such accession");
    rerender(
      <CreateReviewTicketModal open onClose={vi.fn()} onCreated={vi.fn()} />,
    );

    await waitFor(() =>
      expect(screen.getByText(/no experiment with that accession/i)).toBeTruthy(),
    );
    // Still there to be corrected, and the button invites another go.
    expect(screen.getByLabelText(/accession/i)).toHaveValue("GSE404");
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("names the experiment being fetched while the import runs", async () => {
    const user = userEvent.setup();
    const { rerender } = open();
    await user.type(screen.getByLabelText(/accession/i), "GSE777");

    state.isPending = true;
    rerender(
      <CreateReviewTicketModal open onClose={vi.fn()} onCreated={vi.fn()} />,
    );

    expect(screen.getByText(/fetching GSE777 from gemma/i)).toBeTruthy();
  });
});

describe("importErrorMessage", () => {
  it("tells a 404 apart from a 502 — one is the accession, one is Gemma", () => {
    expect(
      importErrorMessage(new ApiError("x", 404, "Not Found", "unknown GSE")),
    ).toMatch(/no experiment with that accession/i);

    const upstream = importErrorMessage(
      new ApiError("x", 502, "Bad Gateway", "upstream Gemma error: timeout"),
    );
    expect(upstream).toMatch(/couldn't be reached/i);
    // The server's detail survives — it names which upstream failed.
    expect(upstream).toMatch(/timeout/);
  });

  it("passes any other ApiError's detail through rather than flattening it", () => {
    expect(
      importErrorMessage(new ApiError("x", 400, "Bad Request", "accession must not be empty")),
    ).toBe("accession must not be empty");
  });

  it("falls back to the message on a non-ApiError", () => {
    expect(importErrorMessage(new Error("network down"))).toBe("network down");
    expect(importErrorMessage("nope")).toBe("Import failed.");
  });
});
