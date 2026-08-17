/**
 * The disc beside an annotation that says where it came from.
 *
 * Renders NOTHING until a curator runs "populate provenance", and
 * nothing after it for an annotation with no recorded trace — which
 * will be most of them for a long time. Same rule as `AuditDot`: a
 * marker that appears on everything says nothing, and a ring on every
 * chip to mean "we asked and nobody knew" is chrome charging rent. The
 * panel's tally carries the "we asked" half.
 *
 * Reuses `StatusDisc` rather than drawing a fifth dot glyph — the
 * codebase already has one 4-tone disc and a second would drift. The
 * tone axis here is **who blessed this**, which is the question Paul
 * asks first ("which agent, when, and was it reviewed by a human?"):
 *
 *   ◐ sky      unreviewed        — an agent proposed it, nobody signed off
 *   ● emerald  a human owns it   — accepted, authored, or edited by a curator
 *   ● amber    rejected          — recorded objection; rare on a live annotation
 *   ○ slate    traced, no verdict — events exist, review state unknown
 *
 * Hover gives the detail. Reading like the proposal card was the ask,
 * with one addition it doesn't have: a human half. Curator events are
 * not footnotes on the agent's reasoning — for an annotation somebody
 * typed by hand, they are the whole trace.
 */

import { StatusDisc, type StatusDiscTone } from "@/components/ui/StatusDisc";
import { Tooltip } from "@/components/ui/Tooltip";
import { evidenceSourceMeta } from "@/features/audit/evidenceSource";
import type {
  ProvenanceActor,
  ProvenanceEvent,
  ProvenanceReviewState,
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
  if (!trace) return null;
  return (
    <Tooltip label={<TraceCard trace={trace} />} interactive wide side="bottom">
      <span className={className}>
        <StatusDisc
          tone={toneFor(trace.review_state)}
          title={reviewStateCopy(trace.review_state)}
        />
      </span>
    </Tooltip>
  );
}

function toneFor(state: ProvenanceReviewState | null | undefined): StatusDiscTone {
  switch (state) {
    case "accepted":
    case "curator_authored":
    case "curator_edited":
      return "done";
    case "rejected":
      return "uncommitted";
    case "unreviewed":
      return "draft";
    default:
      // Events exist but the server didn't compute a state — say
      // nothing about review rather than guessing "unreviewed", which
      // would be a claim about a human we have no evidence for.
      return "untouched";
  }
}

export function reviewStateCopy(
  state: ProvenanceReviewState | null | undefined,
): string {
  switch (state) {
    case "accepted":
      return "a curator accepted this";
    case "curator_authored":
      return "a curator wrote this";
    case "curator_edited":
      return "a curator changed this";
    case "rejected":
      // 🛑 NOT "this annotation is rejected". The disposition is about
      // the agent's PROPOSAL; the annotation itself survived it, and a
      // curator looked at it to say so. Live rows made the difference
      // matter — GSE17646's `factor:1` is a sound factor whose disc
      // read as a defect under the old wording.
      return "a curator declined the change proposed here";
    case "unreviewed":
      return "proposed, not reviewed by a human";
    default:
      return "source recorded; review state unknown";
  }
}

/** The hover body. Newest first — "what happened to this" is usually
 *  the question, and the origin is one scroll away at the bottom. */
function TraceCard({ trace }: { trace: ProvenanceTrace }) {
  const events = trace.events ?? [];
  return (
    <div className="space-y-2 text-left">
      <div className="font-semibold">{reviewStateCopy(trace.review_state)}</div>
      {events.map((e, i) => (
        <EventRow key={i} event={e} />
      ))}
      {/* What a trace can and can't answer today. Everything here is
          reconstructed from curation reviews, so an annotation a
          curator typed straight into the editor leaves nothing behind
          — "unreviewed" means no review decided it, NOT that no human
          ever touched it. Until the append-only event table exists,
          saying so is the difference between a trace a curator can
          rely on and one they have to second-guess. */}
      <div className="opacity-70 text-[10px]">
        From the audit and proposal reviews on file — a change made outside a
        review leaves no trace yet.
      </div>
    </div>
  );
}

const KIND_COPY: Record<ProvenanceEvent["kind"], string> = {
  imported: "imported with the dataset",
  agent_proposed: "proposed",
  agent_applied: "agent proposal applied",
  curator_added: "added by a curator",
  curator_edited: "edited",
  promoted: "promoted from a sample characteristic",
  removed: "removed",
  curator_rejected: "declined by a curator",
};

function EventRow({ event }: { event: ProvenanceEvent }) {
  const actor = actorLine(event.actor);
  const when = formatWhen(event.at);
  const change = changeLine(event);
  return (
    <div className="border-l-2 border-slate-300 dark:border-slate-600 pl-2 space-y-0.5">
      <div>
        <span className="font-medium">{KIND_COPY[event.kind] ?? event.kind}</span>
        {actor ? <span className="opacity-80"> · {actor}</span> : null}
        {when ? <span className="opacity-60"> · {when}</span> : null}
      </div>
      {event.summary ? <div className="opacity-90">{event.summary}</div> : null}
      {change ? <div className="font-mono text-[10px] opacity-90">{change}</div> : null}
      {/* The curator's own words, where they gave any. On a dismissed
          or accepted annotation this is the answer to "why", and it
          outranks anything the agent said. */}
      {event.reason ? <div className="italic opacity-90">“{event.reason}”</div> : null}
      {(event.evidence ?? []).map((ev, i) => {
        const meta = evidenceSourceMeta(ev.source);
        return (
          <div key={i} className="opacity-90">
            <span className="uppercase tracking-wide text-[9px] opacity-70">
              {meta.label}
            </span>{" "}
            <span>“{ev.quote}”</span>
            {ev.location ? (
              <span className="opacity-60"> — {ev.location}</span>
            ) : null}
          </div>
        );
      })}
      {event.run_id ? (
        <div className="font-mono text-[9px] opacity-60">{event.run_id}</div>
      ) : null}
    </div>
  );
}

/** "which agent" is a fleet question — name the subagent when we have
 *  one, and keep the model beside it, because a run is a (model, build)
 *  pair and either alone has misidentified a run before. */
function actorLine(actor: ProvenanceEvent["actor"]): string {
  if (!actor) return "";
  if (typeof actor === "string") return actor;
  const a: ProvenanceActor = actor;
  const bits = [a.name, a.model].filter((s): s is string => !!s && !!s.trim());
  const sha = (a.head_sha ?? "").trim();
  if (sha) bits.push(sha.slice(0, 7));
  return bits.join(" · ");
}

function changeLine(event: ProvenanceEvent): string {
  const before = (event.before?.label ?? "").trim();
  const after = (event.after?.label ?? "").trim();
  if (before && after) return `${before} → ${after}`;
  if (after) return after;
  return "";
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
