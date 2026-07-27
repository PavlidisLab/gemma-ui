/**
 * Dev-time schema-drift check for the AgentRunDialog.
 *
 * The agents side ships `/propose/schema` + `/audit/schema` as JSON-schema
 * introspection endpoints (companion to the full `/openapi.json`).
 * We fetch them on first dialog open and compare the field set to
 * what the dialog actually sends — any field we send that's no
 * longer accepted upstream surfaces as a console.warn so we catch
 * silent contract drift before it hits a curator.
 *
 * Why warn-only and not throw: the agent declares `extra="ignore"`,
 * so a UI-side field that vanished server-side is silently dropped
 * rather than rejected. The contract still holds for the agent's
 * advertised fields. We just want to know about it.
 *
 */

import { useQuery } from "@tanstack/react-query";

/** Minimal JSON-schema shape we care about. */
export interface AgentRequestSchema {
  properties?: Record<string, unknown>;
  required?: string[];
  // Pydantic emits a lot more; we ignore the rest.
}

/** Fields the UI sends when kind=proposal. Keep this in sync with
 *  `App.submitAgentRun`. */
export const UI_PROPOSAL_FIELDS: string[] = [
  "tier",
  "fresh_preboarding",
  "refresh_cache",
  "prior_feedback",
];

/** Fields the UI sends when kind=audit. Keep this in sync with
 *  `App.submitAgentRun`. */
export const UI_AUDIT_FIELDS: string[] = [
  "tier",
  "scope",
  "with_comparison",
  "refresh_cache",
  "prior_feedback",
];

async function fetchSchema(path: string): Promise<AgentRequestSchema | null> {
  try {
    // No bearer needed — `/{propose,audit}/schema` are public per
    // the agents-side response.
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as AgentRequestSchema;
  } catch {
    return null;
  }
}

export function useProposeSchema() {
  return useQuery({
    queryKey: ["agent-schema", "propose"],
    queryFn: () => fetchSchema("/propose/schema"),
    // Schemas don't drift mid-session; one fetch is enough.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useAuditSchema() {
  return useQuery({
    queryKey: ["agent-schema", "audit"],
    queryFn: () => fetchSchema("/audit/schema"),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** Pure: given the agent's advertised schema and the field set the
 *  UI sends, return the list of UI fields the agent no longer
 *  accepts. Empty array = no drift. Returns `null` when the schema
 *  fetch failed (can't infer drift). */
export function findMissingFields(
  schema: AgentRequestSchema | null | undefined,
  uiFields: string[],
): string[] | null {
  if (!schema || !schema.properties) return null;
  const advertised = new Set(Object.keys(schema.properties));
  return uiFields.filter((f) => !advertised.has(f));
}

/** Dev-only console.warn when the UI sends fields the agent no
 *  longer advertises. Caller invokes this once per kind on dialog
 *  open. Idempotent — uses a module-level seen set so we don't spam
 *  the console with the same warning every time the dialog opens.
 *  Reset across reloads is fine. */
const warnedKinds = new Set<string>();
export function warnOnSchemaDrift(
  kind: "propose" | "audit",
  schema: AgentRequestSchema | null | undefined,
  uiFields: string[],
): void {
  if (warnedKinds.has(kind)) return;
  const missing = findMissingFields(schema, uiFields);
  if (missing === null) return; // schema not loaded yet
  warnedKinds.add(kind);
  if (missing.length === 0) return;
   
  console.warn(
    `[AgentRunDialog] schema drift on ${kind}: UI sends ${missing.join(", ")} but ` +
      `the agent's /${kind}/schema doesn't advertise it. The agent will silently ignore ` +
      `(extra="ignore") but the dialog's UX may be sending dead fields.`,
  );
}
