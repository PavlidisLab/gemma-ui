/**
 * The disc beside an annotation that says where it came from.
 *
 * Renders NOTHING until a curator runs "populate provenance", and
 * nothing after it for an annotation with no recorded source — which
 * will be most of them for a long time. Same rule as `AuditDot`: a
 * marker that appears on everything says nothing, and a ring on every
 * chip to mean "we asked and nobody knew" is chrome charging rent.
 *
 * 🛑 **Provenance, not judgement** (2026-08-16). This surface
 * answers three questions and no others: **when was it added, by whom,
 * and did it come from an agent** — and then, the part that actually
 * earns the hover, **what evidence grounded it**. A paper quote or a
 * sample-characteristic quote is the useful payload; everything else
 * is packaging.
 *
 * Three things were here and are deliberately gone:
 *
 *  - **"not reviewed by a human."** The absence of a review is not a
 *    fact about the annotation, and stating it invites a curator to
 *    go fix something that isn't broken. We render events that
 *    happened, never the ones that didn't.
 *  - **The proposal's own headline** ("Add tag `developmental stage:
 *    prime adult stage`?"). It was added. Asking the question back at
 *    the curator, in the trace of the thing that exists, reads as a
 *    pending decision.
 *  - **The review-state tone axis** (emerald accepted / amber
 *    rejected). That was a verdict; the tone axis is now origin —
 *    agent or human — which is what the curator asked to see.
 */

import { StatusDisc, type StatusDiscTone } from "@/components/ui/StatusDisc";
import { Tooltip } from "@/components/ui/Tooltip";
import { evidenceCodeName } from "@/lib/evidenceCode";
import { evidenceSourceMeta } from "@/features/audit/evidenceSource";
import type {
  ProvenanceActor,
  ProvenanceEvent,
  ProvenanceTrace,
} from "@/api/provenance";

import { useTrace } from "./ProvenanceContext";

export function ProvenanceDot({
  refId,
  className,
}: {
  refId: string | null | undefined;
  className?: string;
}) {
  const trace = useTrace(refId);
  const origin = trace ? originOf(trace) : null;
  if (!trace || !origin) return null;
  return (
    <Tooltip
      label={<ProvenanceTraceCard origin={origin} />}
      interactive
      wide
      side="bottom"
    >
      <span className={className}>
        <StatusDisc tone={toneFor(origin)} title={originLine(origin)} />
      </span>
    </Tooltip>
  );
}

/**
 * Collapse events that are identical in every field.
 *
 * Measured on GSE12623's `assay: bulk RNA-seq assay`: one ref in the
 * request, three `agent_proposed` events out, two of them equal in
 * every field including the microsecond.
 *
 * ⚠️ **Nothing is written twice.** The lookup emits one event per
 * (finding × matching ref), so two findings in one report that both
 * match a ref produce two events from one stored record
 * (`local_api/provenance.py::_trace_for_refs`). The shared microsecond
 * is not evidence either way — `at` comes from the report's timestamp,
 * so any two events off one report carry the same one by construction.
 * Null `run_id` / actor name / head sha likewise just mean that report
 * was posted without run provenance.
 *
 * 🛑 So this may be collapsing two GENUINELY DIFFERENT findings — a
 * different judge, target and reasoning — because `ProvenanceEventD`
 * carries no finding identity and they are byte-identical on the wire.
 * The card renders kind, actor and date; two different findings had
 * already become the same sentence printed twice before this function
 * saw them. Collapsing loses the count, not the content.
 *
 * The fix is on the agents side: put the finding's `target_id` (and
 * `judge`) on the event. Then two real findings differ here and both
 * render, and a true duplicate stays truly identical. Asked for in
 * `handoffs/UIB_TO_CAB_2026_08_22_*`; delete nothing here when it
 * lands — this guard becomes exact rather than approximate.
 *
 * Identity only, in the meantime: two proposals differing in any field
 * — run, timestamp, actor — both survive.
 */
function dedupeEvents(events: ProvenanceEvent[]): ProvenanceEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    const key = JSON.stringify(e);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Where the annotation came from: agent, human, or the import. */
type OriginKind = "agent" | "curator" | "import" | "unknown";

interface Origin {
  kind: OriginKind;
  event: ProvenanceEvent;
  /** Later events that are also part of the story — a curator
   *  accepting the agent's proposal, a subsequent edit. Facts only. */
  rest: ProvenanceEvent[];
}

/**
 * The event that explains where this annotation came from, or null
 * when nothing recorded does.
 *
 * 🛑 A declined proposal is not an origin. If all we hold is an agent
 * proposing something and a curator saying no, the annotation is
 * exactly as unexplained as it was before — the agent didn't put it
 * there. Rendering a disc would be answering "where did this come
 * from" with "somebody argued about it", which is the judgement this
 * surface is not for.
 */
export function originOf(trace: ProvenanceTrace): Origin | null {
  const events = dedupeEvents(
    (trace.events ?? []).filter((e) => e.kind !== "curator_rejected"),
  );
  if (events.length === 0) return null;
  // The server sends newest-first, so the origin is the last one.
  const event = events[events.length - 1];
  if (event.kind === "agent_proposed" && trace.review_state === "rejected") {
    // The only substantive thing on file is a proposal that lost.
    const survivedAnyway = events.some((e) => e.kind !== "agent_proposed");
    if (!survivedAnyway) return null;
  }
  return {
    kind: originKind(event),
    event,
    rest: events.slice(0, -1),
  };
}

/** The actor outranks the event name, because they can disagree and
 *  the actor is the one that answers "by whom". `agent_applied` is the
 *  case: it names the agent's proposal but its actor is the curator
 *  who accepted it, and on a trace where that is the ONLY event, a
 *  human is genuinely who put the annotation there. Where both events
 *  survive, the older `agent_proposed` wins the origin slot anyway and
 *  this never fires. */
function originKind(event: ProvenanceEvent): OriginKind {
  const actorKind = typeof event.actor === "object" ? event.actor?.kind : null;
  if (actorKind === "agent") return "agent";
  if (actorKind === "curator") return "curator";
  if (actorKind === "import" || event.kind === "imported") return "import";
  if (event.kind.startsWith("agent_")) return "agent";
  if (event.kind.startsWith("curator_")) return "curator";
  if (event.kind === "promoted") return "import";
  return "unknown";
}

/** Colour carries origin, not approval. Sky reads "machine", emerald
 *  "a person", slate "no person and no agent — the system holds this".
 *  Amber is gone with the verdict it used to mean, and stays gone: the
 *  house rule is that amber means warning.
 *
 *  🛑 Fill separates the two slates. An import is a KNOWN origin and
 *  gets the filled disc; the hollow ring is kept for `unknown`, where
 *  we hold an event we cannot attribute. They rendered identically —
 *  as the faintest glyph in the set — so the most common answer on the
 *  page ("GEO's submitter record says so") was the one nobody saw. */
function toneFor(origin: Origin): StatusDiscTone {
  switch (origin.kind) {
    case "agent":
      return "draft";
    case "curator":
      return "done";
    case "import":
      return "neutral";
    default:
      return "untouched";
  }
}

/** The one-line answer to "when, by whom, from an agent?" */
export function originLine(origin: Origin): string {
  const when = whenLine(origin.event);
  const who = actorLine(origin.event.actor);
  const lead =
    origin.kind === "agent"
      ? "From an agent"
      : origin.kind === "curator"
        ? who
          ? `Added by ${who}`
          : "Added by a curator"
        : origin.event.kind === "promoted"
          ? "Promoted from a sample characteristic"
          : origin.event.kind === "imported"
            ? "Imported with the dataset"
            : "Recorded source";
  return when ? `${lead} · ${when}` : lead;
}

/** The hover body: the origin line, who exactly, then the evidence —
 *  which is the reason to open this at all.
 *
 *  Exported for render tests. The tooltip portals its content only
 *  while open, so asserting on what a curator actually reads means
 *  rendering this directly — same affordance, same reason, as
 *  `ProvenanceRunContext`. Production only ever mounts it through
 *  {@link ProvenanceDot}. */
export function ProvenanceTraceCard({ origin }: { origin: Origin }) {
  const agentDetail =
    origin.kind === "agent" ? actorLine(origin.event.actor) : "";
  const detail = [
    agentDetail,
    confidenceText(origin.event),
    evidenceCodeText(origin.event),
  ].filter(Boolean);
  return (
    <div className="space-y-2 text-left">
      <div className="font-semibold">{originLine(origin)}</div>
      {detail.length ? (
        <div className="opacity-80 text-[11px]">{detail.join(" · ")}</div>
      ) : null}

      {/* The words whoever decided this gave for it. Rendered on the
          origin as well as on the later facts below — a trace whose
          only event IS the decision (a curator's accept, a publication
          link's stated basis) was dropping the one sentence that
          answers "on what grounds". */}
      {origin.event.reason ? (
        <div className="italic opacity-90">“{origin.event.reason}”</div>
      ) : null}

      <Evidence event={origin.event} />
      <Change event={origin.event} />

      {/* Later facts about the same annotation — who accepted it, who
          edited it. Stated as what happened, never as a verdict, and
          never as an absence. */}
      {origin.rest.map((e, i) => (
        <div key={i} className="opacity-90">
          <div>
            <span className="font-medium">{FACT_COPY[e.kind] ?? e.kind}</span>
            {actorLine(e.actor) ? (
              <span className="opacity-80"> · {actorLine(e.actor)}</span>
            ) : null}
            {whenLine(e) ? (
              <span className="opacity-60"> · {whenLine(e)}</span>
            ) : null}
          </div>
          {/* The curator's own words, where they gave any. */}
          {e.reason ? <div className="italic opacity-90">“{e.reason}”</div> : null}
          <Evidence event={e} />
        </div>
      ))}

      {origin.event.run_id ? (
        <div className="font-mono text-[9px] opacity-60">
          {origin.event.run_id}
        </div>
      ) : null}
    </div>
  );
}

/** What actually happened, in the past tense. No question marks: the
 *  annotation exists, so "was this added?" is not the sentence. */
const FACT_COPY: Partial<Record<ProvenanceEvent["kind"], string>> = {
  imported: "imported with the dataset",
  agent_proposed: "proposed by an agent",
  agent_applied: "applied",
  curator_added: "added by a curator",
  curator_edited: "edited",
  promoted: "promoted from a sample characteristic",
  removed: "removed",
  curator_rejected: "declined by a curator",
};

/** The verbatim quotes that grounded it — a paper sentence, a sample
 *  characteristic. This is the payload; the rest of the card is
 *  context for it. Rendered through the same per-source presentation
 *  the audit surfaces use so one source never gets described two
 *  ways. */
function Evidence({ event }: { event: ProvenanceEvent }) {
  const evidence = event.evidence ?? [];
  if (evidence.length === 0) return null;
  return (
    <div className="space-y-1">
      {evidence.map((ev, i) => {
        const meta = evidenceSourceMeta(ev.source, ev.location);
        return (
          <div key={i} className="space-y-0.5">
            <div className="text-[10px] opacity-70">
              Evidence: {meta.label}
              {ev.location ? (
                <span className="opacity-80"> — {ev.location}</span>
              ) : null}
            </div>
            {/* Monospace so the quote reads as something SOMEONE ELSE
                wrote, not as our prose about it. These are verbatim
                submitter strings — `BM age='11-15 weeks'` — where the
                exact characters carry the meaning, and a proportional
                face beside our own sentences invites skimming past a
                stray quote or bracket that matters. */}
            <div className="font-mono text-[11px] leading-snug">
              “{ev.quote}”
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** How sure the producer was, when it said. Prefers the word it used
 *  over a number it didn't — a bucket rendered as "0.9" is a precision
 *  nobody measured. Absent on everything today; shows up the moment a
 *  producer populates either field. */
function confidenceText(event: ProvenanceEvent): string {
  if (event.confidence_bucket) return `${event.confidence_bucket} confidence`;
  if (typeof event.confidence === "number") {
    return `confidence ${event.confidence.toFixed(2)}`;
  }
  return "";
}

/** How much anybody checked, in the code's own words. `IIA` on a
 *  publication link is the difference between "GEO said so" and "a
 *  human read both papers" — the distinction whose absence let a wrong
 *  link stand for four days (GSE227854). */
function evidenceCodeText(event: ProvenanceEvent): string {
  const code = (event.evidence_code ?? "").trim().toUpperCase();
  if (!code) return "";
  const name = evidenceCodeName(code);
  return name && name !== code ? `${code} — ${name}` : code;
}

function Change({ event }: { event: ProvenanceEvent }) {
  const before = (event.before?.label ?? "").trim();
  const after = (event.after?.label ?? "").trim();
  const text = before && after ? `${before} → ${after}` : "";
  if (!text) return null;
  return <div className="font-mono text-[10px] opacity-90">{text}</div>;
}

/** "which agent" is a fleet question — name the subagent when we have
 *  one, and keep the model beside it, because a run is a (model,
 *  build) pair and either alone has misidentified a run before. */
function actorLine(actor: ProvenanceEvent["actor"]): string {
  if (!actor) return "";
  if (typeof actor === "string") return actor;
  const a: ProvenanceActor = actor;
  const bits = [a.name, a.model].filter((s): s is string => !!s && !!s.trim());
  const sha = (a.head_sha ?? "").trim();
  if (sha) bits.push(sha.slice(0, 7));
  return bits.join(" · ");
}

/**
 * The date, and whether it is the date of the thing or of the note
 * about the thing.
 *
 * A producer that only knows when the basis was written down says so —
 * "recorded 2026-08-19" — because the bare date is read as when it
 * happened. On a paper GEO's submitter linked in 2018 and Gemma
 * asserted in a 2026 backfill, the unqualified line dated the import to
 * the backfill on every dataset in the corpus.
 */
function whenLine(event: ProvenanceEvent): string {
  const when = formatWhen(event.at);
  if (!when) return "";
  return event.at_is_record_time ? `recorded ${when}` : when;
}

/** Date only. A trace spans months; the minute it happened has never
 *  been the question, and a full timestamp crowds every row. */
function formatWhen(at: string | null | undefined): string {
  const raw = (at ?? "").trim();
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toISOString().slice(0, 10);
}
