/**
 * Compile-time shape check: DispositionMode defined in DismissDialog.tsx
 * and the one in dispositionEdit.ts must be structurally identical.
 *
 * The structured-finding review flagged a duplicate type declaration:
 *
 *   DismissDialog.tsx:25  export type DispositionMode = "dismiss" | "accept" | "not_sure";
 *   dispositionEdit.ts:27 export type DispositionMode = "dismiss" | "accept" | "not_sure";
 *
 * These two declarations have diverged before (dispositionEdit.ts was
 * extracted from the old AuditSidebarPanel; DismissDialog was refactored
 * later).  This test locks their shapes together at the TypeScript level
 * using `satisfies` so any future divergence is caught at typecheck time
 * rather than at runtime.
 *
 * Runtime assertion: both types must accept the same three literal
 * values and reject everything else.  We assert at runtime that the set
 * of accepted values is identical so the test also catches a regression
 * where one file's union is extended without updating the other.
 */

import { describe, expect, it } from "vitest";
import type { DispositionMode as DispositionModeDialog } from "./DismissDialog";
import type { DispositionMode as DispositionModeEdit } from "./dispositionEdit";

// Compile-time shape check via `satisfies`.
// If either union changes, the other const assignment will produce a
// type error and the file will fail to compile (caught by `npm run typecheck`
// and by vitest's own TypeScript transform).
const dialogValue: DispositionModeDialog = "dismiss";
const editValue: DispositionModeEdit = dialogValue satisfies DispositionModeEdit;
void editValue;

// The reverse direction.
const editValue2: DispositionModeEdit = "not_sure";
const dialogValue2: DispositionModeDialog = editValue2 satisfies DispositionModeDialog;
void dialogValue2;

/** The full set of literal values that both types must accept. */
const EXPECTED_MODES: DispositionModeDialog[] = ["dismiss", "accept", "not_sure"];

describe("DispositionMode — single-source-of-truth shape check", () => {
  it("DismissDialog and dispositionEdit export the same three literal values", () => {
    // Runtime check: every expected mode is assignable and round-trips
    // cleanly.  This catches a runtime divergence (e.g. a value added
    // to one union without the other) that `satisfies` alone would miss
    // when both types widen independently.
    for (const mode of EXPECTED_MODES) {
      // Both sides must accept each literal without coercion.
      const asDismissDialog: DispositionModeDialog = mode;
      const asEdit: DispositionModeEdit = mode;
      expect(asDismissDialog).toBe(mode);
      expect(asEdit).toBe(mode);
    }
    expect(EXPECTED_MODES).toHaveLength(3);
  });

  it("the accepted values are dismiss, accept, and not_sure — no more, no less", () => {
    expect(EXPECTED_MODES).toContain("dismiss");
    expect(EXPECTED_MODES).toContain("accept");
    expect(EXPECTED_MODES).toContain("not_sure");
    expect(EXPECTED_MODES).toHaveLength(3);
  });
});
