/**
 * What comes back from localStorage is whatever was in the browser the
 * last time any version of this app wrote it — a hand-edited value, a
 * shape from an older build, or nothing at all. `parsePinned` is the
 * boundary that decides what the dashboard's ordering is allowed to see,
 * and every case below is one that would otherwise reach it.
 */
import { describe, expect, it } from "vitest";

import { parsePinned } from "./pinnedTickets";

const ids = (raw: string | null) => [...parsePinned(raw)].sort((a, b) => a - b);

describe("parsePinned", () => {
  it("reads a list of ticket ids", () => {
    expect(ids("[3,1,2]")).toEqual([1, 2, 3]);
  });

  it("treats an absent or empty value as no pins", () => {
    expect(ids(null)).toEqual([]);
    expect(ids("")).toEqual([]);
    expect(ids("[]")).toEqual([]);
  });

  it("survives a value that is not JSON at all", () => {
    expect(ids("not json")).toEqual([]);
    expect(ids("{")).toEqual([]);
  });

  it("drops entries that are not ticket ids, keeping the ones that are", () => {
    expect(ids('[1,"2",null,3.5,true,{"id":4},[5],6]')).toEqual([1, 6]);
  });

  it("ignores a JSON value of the wrong shape", () => {
    expect(ids('{"3":true}')).toEqual([]);
    expect(ids('"3"')).toEqual([]);
    expect(ids("3")).toEqual([]);
  });

  it("dedupes", () => {
    expect(ids("[7,7,7]")).toEqual([7]);
  });
});
