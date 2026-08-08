/**
 * Curator feedback ON THE AGENT'S JUDGEMENT — "this call was useful"
 * (endorse) or "this call was wrong" (flag).
 *
 * Distinct from a disposition. A disposition says what happens to the
 * DESIGN (agree / dismiss / park); this says what the curator thinks of
 * the AGENT, and changes nothing about the experiment. So it must never
 * ride on the disposition record: those drive finalize / gold, and an
 * opinion about the reasoning is not a decision about the data.
 *
 * Entirely optional and expected to be rare — a curator reaches for it
 * when the agent did something notably good or notably wrong, not on
 * every verdict. Nothing in the UI requires it and nothing is gated on
 * it.
 *
 * ## Where it lives
 *
 * localStorage, for now. The store has no sink for this: the only write
 * on an audit is the disposition PATCH, whose field set is fixed. There
 * IS precedent for curator state parked client-side until the wire
 * catches up (``paperDismissal.ts``, and the proposal feedback under
 * ``gemma-proposal-feedback``), and this follows the same conventions:
 *
 *   - **Keyed by experiment** so a per-experiment reset can clear it
 *     without touching other experiments.
 *   - **Self-validating on read** — a malformed or forward-drifted
 *     entry is dropped rather than trusted, so a shape change can't
 *     resurrect junk.
 *
 * ``exportAgentFeedback`` hands the whole set over in one object, which
 * is what a future ``POST /audits/{id}/agent-feedback`` will send. Ask
 * filed in ``handoffs/AGENT_FEEDBACK_ENDPOINT_2026_08_08.md``.
 */

const PREFIX = "gca:agent-feedback:";

/** Which way the curator leaned. Deliberately only two — a rating
 *  scale invites deliberation on a control that should cost nothing. */
export type FeedbackStance = "endorse" | "flag";

/** WHICH AGENT produced the judgement being rated. Only ``boss_critic``
 *  is wired today; the field exists so defender / arbiter verdicts can
 *  share the same store and the same endpoint rather than growing
 *  parallel ones.
 *
 *  Named ``judge`` to reuse the vocabulary the store already has on
 *  ``curation_review_disposition.judge`` (empty on every existing row,
 *  so nothing to migrate) instead of minting a third way to say "which
 *  agent said this" alongside that and ``AttachedDefenderVerdict.side``.
 *  NOT ``subject``: in this codebase ``subject`` is the S of an S-P-O
 *  statement in several hundred places, and overloading it here would
 *  make ``feedback.subject`` and ``statement.subject`` read as the same
 *  kind of thing. Settled with the agents side 2026-08-08. */
export type FeedbackJudge = "boss_critic";

export interface AgentFeedbackEntry {
  stance: FeedbackStance;
  judge: FeedbackJudge;
  /** Audit the judgement belongs to — carried so the eventual POST can
   *  be grouped per audit without re-deriving it. */
  auditId: string;
  /** ISO timestamp of the curator's click. */
  at: string;
  /** Optional free text. Empty when the curator just clicked. */
  note?: string;
}

/** ``verdictKey`` → entry. The key is the grouped boss review's own
 *  ``key`` (its ``finding_key``, or the canonical target_id when the
 *  wire predates that field) — stable across renders and rounds. */
export type AgentFeedbackMap = Record<string, AgentFeedbackEntry>;

export function agentFeedbackKey(experimentId: number | string): string {
  return `${PREFIX}${experimentId}`;
}

function isStance(v: unknown): v is FeedbackStance {
  return v === "endorse" || v === "flag";
}

/** Validate one entry on the way out of storage. Anything that doesn't
 *  match the current shape is dropped — a stale entry written by an
 *  older build must not be read as if it meant what it means now. */
function validEntry(raw: unknown): AgentFeedbackEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Partial<AgentFeedbackEntry>;
  if (!isStance(e.stance)) return null;
  if (e.judge !== "boss_critic") return null;
  if (typeof e.auditId !== "string" || !e.auditId) return null;
  if (typeof e.at !== "string" || !e.at) return null;
  const note = typeof e.note === "string" ? e.note : undefined;
  return {
    stance: e.stance,
    judge: e.judge,
    auditId: e.auditId,
    at: e.at,
    ...(note ? { note } : {}),
  };
}

export function readAgentFeedback(
  experimentId: number | string,
): AgentFeedbackMap {
  try {
    const raw = window.localStorage.getItem(agentFeedbackKey(experimentId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: AgentFeedbackMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = validEntry(v);
      if (entry) out[k] = entry;
    }
    return out;
  } catch {
    return {};
  }
}

function write(experimentId: number | string, map: AgentFeedbackMap): void {
  try {
    if (Object.keys(map).length === 0) {
      window.localStorage.removeItem(agentFeedbackKey(experimentId));
      return;
    }
    window.localStorage.setItem(
      agentFeedbackKey(experimentId),
      JSON.stringify(map),
    );
  } catch {
    // Storage full / disabled — the control is optional, so losing it
    // is survivable. Never let it break the surrounding card.
  }
}

/** Toggle the stance on one judgement. Clicking the stance that's
 *  already set CLEARS it, so a misclick costs one click to undo and the
 *  curator is never stuck having said something they didn't mean.
 *  Returns the new map so the caller can hold it in state. */
export function setAgentFeedback(
  experimentId: number | string,
  verdictKey: string,
  next: {
    stance: FeedbackStance;
    judge: FeedbackJudge;
    auditId: string;
    note?: string;
    /** Injected so tests are deterministic; defaults to now. */
    at?: string;
  },
): AgentFeedbackMap {
  const map = readAgentFeedback(experimentId);
  const current = map[verdictKey];
  if (current && current.stance === next.stance && !next.note) {
    delete map[verdictKey];
  } else {
    map[verdictKey] = {
      stance: next.stance,
      judge: next.judge,
      auditId: next.auditId,
      at: next.at ?? new Date().toISOString(),
      ...(next.note ? { note: next.note } : {}),
    };
  }
  write(experimentId, map);
  return map;
}

/** Drop every entry for one experiment. Wire to the same Reset that
 *  clears the design draft — curator feedback about an agent run is
 *  meaningless once that run's context is gone. */
export function clearAgentFeedback(experimentId: number | string): void {
  try {
    window.localStorage.removeItem(agentFeedbackKey(experimentId));
  } catch {
    // ignore
  }
}

/** The payload shape a future endpoint receives. Exported now so the
 *  handoff can quote something concrete, and so a curator's feedback is
 *  recoverable by hand in the meantime. */
export function exportAgentFeedback(experimentId: number | string): {
  experiment_id: number | string;
  entries: (AgentFeedbackEntry & { verdict_key: string })[];
} {
  const map = readAgentFeedback(experimentId);
  return {
    experiment_id: experimentId,
    entries: Object.entries(map).map(([verdict_key, e]) => ({
      verdict_key,
      ...e,
    })),
  };
}
