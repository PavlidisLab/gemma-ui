/** The comparison-view sources. Spec:
 *  ``docs/CURATION_COMPARISON_VIEW_2026_05_27.md``.
 *
 *  Three system-level sources (``empty``, ``preboard``,
 *  ``agent_proposal``) plus a dynamic ``polished:<curator>`` family
 *  driven by whichever curation packs have been loaded for the
 *  experiment. ``polished:curator-b`` and ``polished:curator-a`` are typical
 *  but not enumerated up front — any curator with a loaded polished
 *  pack appears as ``polished:<their_username>`` automatically.
 *  See memory ``polished-sources-are-dynamic-per-loaded-pack``.
 *
 *  Wire form (URL ``?base=`` and ``?cmp=``): the bare token strings.
 *  Stable across sessions; renaming a system-level token requires a
 *  migration step. Curator-specific tokens (``polished:foo``) don't
 *  need migrations — the curator name comes from the data. */
export type SystemSource = "empty" | "preboard" | "live" | "agent_proposal";
export type PolishedSource = `polished:${string}`;

/** A comparison source is identified by an OPAQUE curation_id
 *  string. Step 3b of the 2026-06-08 unified-curation-versions
 *  reframe widened this from a discriminated union to a generic
 *  string so any /curations row (unified-table UUID, legacy synthetic
 *  id like `live` / `polished:curator-b`, future producer kind) can sit
 *  in either chip-strip slot.
 *
 *  Recognized literal IDs the helpers still special-case for
 *  back-compat with hand-edited URLs and legacy slot rules:
 *  ``empty`` / ``preboard`` / ``live`` / ``agent_proposal`` /
 *  ``polished:<curator>``. Anything else is treated as an opaque
 *  curation_id whose label + producer + source_kind are resolved
 *  by looking it up in the experiment's /curations list.
 *
 *  Per memory project-curation-overlay-model: polished gold isn't
 *  architecturally special, it's just a named curation; the
 *  string-typed Source reflects that. */
export type Source = SystemSource | PolishedSource | (string & {});

/** System-level sources that are always part of the universe (their
 *  availability per-experiment depends on whether the data is there).
 *  The polished family is dynamic and not enumerated here.
 *
 *  ``live`` was added 2026-06-08 as part of the unified-curation-
 *  versions reframe — the live Gemma curation state is a first-class
 *  source (kind=live in /curation-versions). Before this change the
 *  chip strip defaulted to ``preboard`` as the baseline even when
 *  no preboard was available, which kept "Gemma preboard" stuck in
 *  the dropdown as the anchor selection. With ``live`` available
 *  the default falls through to it when polished isn't loaded. */
export const SYSTEM_SOURCES: readonly SystemSource[] = [
  "empty",
  "preboard",
  "live",
  "agent_proposal",
] as const;

/** True for any ``polished:<curator>`` token. */
export function isPolishedSource(s: Source): s is PolishedSource {
  return typeof s === "string" && s.startsWith("polished:");
}

/** Extract the curator username from a ``polished:<curator>`` token.
 *  Returns the empty string for non-polished sources. */
export function polishedCuratorOf(s: Source): string {
  if (!isPolishedSource(s)) return "";
  return s.slice("polished:".length);
}

/** Build a polished-source token for a given curator username. */
export function polishedSourceFor(curator: string): PolishedSource {
  return `polished:${curator}` as PolishedSource;
}

/** ``curator:gold`` → ``gold``. Producers arrive namespaced or bare
 *  depending on which endpoint served them — a ``/curations`` row says
 *  ``curator:gold`` where ``/curation-versions`` says ``gold`` — and the
 *  ``polished:<x>`` token carries the bare name. Fold both to the bare,
 *  lowercase form before comparing a producer to a curator. */
export function bareCurator(producer: string | null | undefined): string {
  return (producer ?? "")
    .replace(/^curator:/, "")
    .trim()
    .toLowerCase();
}

/** Title-Case a curator username for display. ``"curator-b"`` → ``"Curator-B"``;
 *  ``"jordan-doe"`` → ``"Jordan-Doe"``. Falls back to verbatim if the
 *  name is empty. */
function titleCaseCurator(name: string): string {
  if (!name) return "";
  return name
    .split(/([\s\-_])/)
    .map((part) =>
      /^[\s\-_]$/.test(part)
        ? part
        : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
    )
    .join("");
}

/** Minimal shape of a curation row from /curations — only the
 *  fields sourceLabel needs. Avoids a hard import of the full
 *  Curation type so this module stays standalone. */
export interface CurationLabelLookup {
  curation_id: string;
  label?: string;
  producer?: string;
  source_kind?: string;
  /** Run timestamp (ISO). Used to make agent-run labels human-readable
   *  ("agent <sha> <m/d>"). Optional — label degrades to "agent <sha>"
   *  when absent. */
  created_at?: string | null;
  /** Source-specific extras off the /curations row. For agent
   *  proposals this carries a self-documenting ``run_provenance`` block
   *  (run_id / run_sha / ran_at / model / batch_id / git_describe /
   *  git_dirty) that ``sourceTooltip`` surfaces on hover so the full
   *  run identity is one hover away, never something to hunt for. */
  metadata?: Record<string, unknown> | null;
}

/** The self-documenting run-provenance block stamped on an agent
 *  proposal's /curations metadata (agents-side
 *  ``local_api/curation_versions.py``). Every field optional — old
 *  rows predating the provisioning carry none. */
export interface RunProvenance {
  run_id?: string;
  run_sha?: string;
  ran_at?: string;
  model?: string;
  batch_id?: string;
  git_describe?: string;
  git_dirty?: boolean;
}

/** Pull the ``run_provenance`` block off a lookup's metadata, if any.
 *  Defensive against missing / wrong-shaped metadata. */
export function runProvenanceOf(
  lookup: CurationLabelLookup | undefined,
): RunProvenance | null {
  const meta = lookup?.metadata;
  if (!meta || typeof meta !== "object") return null;
  const prov = (meta as Record<string, unknown>).run_provenance;
  if (!prov || typeof prov !== "object") return null;
  return prov as RunProvenance;
}

/** ISO timestamp → short, tz-free "M/D" (no leading zeros, no year).
 *  "2026-06-22T01:09:57Z" → "6/22". "" when absent/unparseable. */
function shortRunDate(iso?: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${+m[2]}/${+m[3]}` : "";
}

/** Human-facing label for a source.
 *
 *  When `curations` is supplied AND the source matches one of the
 *  curation_ids, use that row's `label` (or derive `${producer}
 *  (${source_kind})` if label is empty). This is the step-3b path
 *  — labels come from /curations, not from hard-coded enum cases.
 *
 *  Falls through to the legacy enum-based label for back-compat
 *  with code that doesn't pass curations and for the legacy
 *  literal IDs (preboard / live / agent_proposal / polished:*). */
export function sourceLabel(
  s: Source,
  curations?: readonly CurationLabelLookup[],
): string {
  if (curations) {
    const match = curations.find((c) => c.curation_id === s);
    if (match) {
      if (match.label && match.label.trim()) return match.label;
      const producer = match.producer || "";
      const kind = match.source_kind || "";
      // Agent runs identify by run sha; drop the redundant
      // "(agent_proposal)" kind — ``agent:<sha>`` → "agent <sha>"
      // (design review 2026-06-19: "proposal" is noise when a sha names the run).
      if (kind === "agent_proposal" || /^agent[:_-]/.test(producer)) {
        const raw = producer.replace(/^agent[:_-]?/, "").trim();
        // A bare git sha shortens to 7; a build identity token
        // (``v1.1-87-g5344f2e``) is shown in full — slicing it to 7
        // would drop the part that distinguishes two builds.
        const sha = /^[0-9a-f]{12,}$/i.test(raw) ? raw.slice(0, 7) : raw;
        const date = shortRunDate(match.created_at);
        const parts = ["agent", sha, date].filter(Boolean);
        // Need at least a sha or date to be unique; else fall back.
        return parts.length > 1 ? parts.join(" ") : "agent proposal";
      }
      if (producer && kind) return `${producer} (${kind})`;
      if (producer) return producer;
      if (kind) return kind;
    }
  }
  if (s === "empty") return "(empty)";
  // Was "Gemma" — misleading: preboard is the GEO-only pre-curation
  // snapshot, not the live Gemma curation state. Per design review 2026-06-08
  // (chip-strip showed "Gemma / Gemma" with no agent option, and the
  // baseline was actually the preboard). "Gemma preboard" distinguishes
  // from live Gemma / polished sets once the unified curation-versions
  // model lands.
  if (s === "preboard") return "Gemma preboard";
  // "Gemma" without a "(live)" qualifier — the chip strip fetches a
  // snapshot, not a live stream, and curators read "live" as real-
  // time which isn't accurate. Agent should supply a friendlier name
  // via the /curations row's ``label`` field; this fallback fires
  // only when ``label`` is empty (pre-step-3b enum path). Per design review
  // 2026-06-12.
  if (s === "live") return "Gemma";
  if (s === "agent_proposal") return "agent proposal";
  if (isPolishedSource(s)) {
    const curator = polishedCuratorOf(s);
    // Consensus-producer rows are routed through the polished
    // channel until step 3b drops the Source enum (2026-06-08).
    // Their tokens are slugified consensus:<id> → polished:consensus_<id>.
    // Drop the redundant "consensus" prefix and de-slug for a direct
    // display name: ``polished:consensus_strict_consensus`` → "strict
    // consensus" (design review 2026-06-19 — the prefix was just noise).
    if (curator.startsWith("consensus_")) {
      return curator.replace(/^consensus_/, "").replace(/_/g, " ");
    }
    return `${titleCaseCurator(curator)} polished`;
  }
  return s;
}

/** Self-documenting hover text for a source. For agent proposals
 *  carrying a ``run_provenance`` block this is the full run identity
 *  (run id, sha, date, model, batch, git describe, dirty flag) so
 *  hovering the chip reveals everything without hunting through
 *  sidecar files. Returns the empty string when there's nothing
 *  richer to show than the label itself (callers can fall back to the
 *  label as the title).
 *
 *  Plain text with newline separators — fine for a native ``title=``
 *  attribute. Structured enough that a richer expandable popover could
 *  later be built from the same ``runProvenanceOf`` block. */
export function sourceTooltip(
  s: Source,
  curations?: readonly CurationLabelLookup[],
): string {
  if (!curations) return "";
  const match = curations.find((c) => c.curation_id === s);
  if (!match) return "";
  const prov = runProvenanceOf(match);
  if (!prov) return "";
  const lines: string[] = ["Agent run provenance"];
  const add = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === "") return;
    lines.push(`${k}: ${v}`);
  };
  add("run id", prov.run_id);
  add("sha", prov.run_sha);
  // Prefer the provenance ran_at; fall back to the row's created_at.
  add("date", prov.ran_at || match.created_at || "");
  add("model", prov.model);
  add("batch", prov.batch_id);
  add("git describe", prov.git_describe);
  if (prov.git_dirty) lines.push("git: dirty (uncommitted changes)");
  // Only "Agent run provenance" header → nothing useful; return blank.
  return lines.length > 1 ? lines.join("\n") : "";
}

/** Slot identifier — drives validity rules + default selection. */
export type SlotKind = "baseline" | "comparator";

/** Which sources may legitimately occupy each slot. Mirrors the
 *  slot-validity table in the spec.
 *
 *  Returns ``true`` if the source is *intrinsically* valid for the
 *  slot — i.e. independent of what the other slot holds. The
 *  ``comparator = preboard`` case is conditional on the other slot
 *  being non-empty; that constraint is enforced by
 *  ``isPairAllowed``, not here. */
export function isSourceValidInSlot(slot: SlotKind, source: Source): boolean {
  if (slot === "baseline") {
    // ``empty`` isn't a legitimate baseline (design review 2026-05-29: "there
    // is always going to be a preboard with at least the title").
    // The agent's proposal is a proposal, not a canonical state —
    // never a legitimate baseline. Everything else (preboard +
    // polished:* + opaque curation_ids) is. Step 3b: an opaque
    // curation_id whose source_kind is `agent_proposal` could in
    // principle also be filtered here, but the chip-strip rules
    // are advisory anyway — wrong baseline picks render
    // harmlessly. Leave to default-allow.
    return source !== "agent_proposal" && source !== "empty";
  }
  // Comparator slot: empty | preboard | polished | proposal |
  // opaque curation_id all OK.
  return true;
}

/** Are these two slot occupants allowed to co-exist? Catches the
 *  ``baseline=empty + comparator=preboard`` case the spec calls out
 *  as conceptually muddled (preboard isn't a *proposal*; it's a
 *  *state*, and pure-proposal mode is for proposed changes only).
 *  All other pairs are accepted — including identity pairs (which
 *  are the regression-test corollary). */
export function isPairAllowed(baseline: Source, comparator: Source): boolean {
  if (baseline === "empty" && comparator === "preboard") return false;
  return true;
}

/** Modes the spec derives from slot population. Used purely for
 *  card-framing / panel-header text; not load-bearing for chip logic. */
export type ComparisonMode =
  | "proposal"   // baseline empty,  comparator populated
  | "bare"       // baseline populated, comparator empty
  | "audit"      // both populated, different sources
  | "identity"   // both populated, same source (regression-test mode)
  | "degenerate"; // both empty

export function modeOf(baseline: Source, comparator: Source): ComparisonMode {
  const b = baseline !== "empty";
  const c = comparator !== "empty";
  if (!b && !c) return "degenerate";
  if (!b && c) return "proposal";
  if (b && !c) return "bare";
  if (baseline === comparator) return "identity";
  return "audit";
}

/** Default slot occupants by curation-flow context. Spec ``Defaults``
 *  section.
 *
 *  - ``review``: post-curation evaluation. Open on the curator's OWN
 *    polished row when they have one — that is what the page edits, so
 *    it is what the chip should name. Otherwise "where did the agent go
 *    wrong" → <first available polished curator> vs agent proposal,
 *    falling back to ``preboard`` vs agent proposal when no polished
 *    pack is loaded yet.
 *  - ``edit``: curator working their assigned calibration package.
 *    Open into "agent's proposal against the bare Gemma state".
 *
 *  Defaults are advisory — the URL ``?base=``/``?cmp=`` params win
 *  if set. Callers pass the loaded-curators list so the default
 *  baseline can pick the first available polished source. */
export type FlowKind = "review" | "edit";

export function defaultSlots(
  flow: FlowKind,
  options?: {
    polishedCurators?: readonly string[];
    /** Per-source availability from useSourceUniverse. Lets the
     *  default fall through when the preferred source isn't loaded
     *  for this experiment — e.g. v6 calibration pack has no
     *  preboard but does have live + agent_proposal, so the
     *  baseline default falls through to ``live`` instead of
     *  sticking on the unavailable ``preboard``. Optional for
     *  back-compat with callers that don't have the availability
     *  map. */
    availability?: Partial<Record<Source, { available: boolean }>>;
    /** The baseline the active ticket pins — the source its findings
     *  were computed against. Wins over every flow default, because a
     *  ticket-scoped review that opens on a different baseline asks
     *  the curator about differences the findings never saw
     *  (handoff ``AGENTS_ASK_2026_08_09_TICKET_SHOULD_PIN_ITS_BASELINE``).
     *  Ignored when the source isn't loaded for this experiment —
     *  a baseline that resolves to nothing is worse than the flow
     *  default, and the chip strip says so rather than silently
     *  substituting. */
    pinnedBaseline?: Source | null;
    /** The current curator's username. When they hold a polished row
     *  for this experiment, that row becomes the review-flow baseline
     *  — above the ticket pin. Omitted / unknown ⇒ no preference, and
     *  every other rule below applies unchanged. */
    ownPolishedCurator?: string | null;
  },
): { baseline: Source; comparator: Source } {
  const av = options?.availability;
  const isAvail = (s: Source): boolean =>
    av ? (av[s]?.available ?? true) : true;

  // The curator's OWN polished row wins in review flow whenever it
  // exists. ``commit()`` mirrors every commit into it and nothing else
  // writes one — a pack import does not — so its presence means "I have
  // already curated here", and from that point the page edits /design
  // rather than the seed. Landing on the seed's name while editing your
  // own design is the confusion this closes: an experiment curated on
  // top of gold reopened with the chip reading "Gold polished" and only
  // a small neutral note saying otherwise.
  //
  // Above the ticket pin deliberately. The pin names what a curation was
  // STARTED from, not a view to return to (2026-08-10: "reopening a
  // ticket lands on the committed work, never back on gold") — that has
  // been true of the CONTENT since ``seededFromBaseline`` landed, and
  // this makes it true of the chip. Where the two differ,
  // ``PinnedBaselineNote`` names the baseline the findings used and
  // restores it in one click.
  const own = bareCurator(options?.ownPolishedCurator);
  if (flow === "review" && own) {
    const mine = options?.polishedCurators?.find(
      (c) => bareCurator(c) === own,
    );
    if (mine) {
      const source = polishedSourceFor(mine);
      if (isAvail(source)) {
        return { baseline: source, comparator: "agent_proposal" };
      }
    }
  }

  const pinned = options?.pinnedBaseline;
  if (
    pinned &&
    isSourceValidInSlot("baseline", pinned) &&
    isAvail(pinned)
  ) {
    // Comparator is the agent's proposal in both flows — the pin only
    // speaks to the baseline slot.
    return { baseline: pinned, comparator: "agent_proposal" };
  }

  if (flow === "edit") {
    // Edit flow: prefer preboard → live → first polished.
    let baseline: Source = "preboard";
    if (!isAvail(baseline)) {
      if (isAvail("live")) {
        baseline = "live";
      } else {
        const first = options?.polishedCurators?.[0];
        if (first) baseline = polishedSourceFor(first);
      }
    }
    return { baseline, comparator: "agent_proposal" };
  }
  // Review flow: prefer first polished → live → preboard.
  const first = options?.polishedCurators?.[0];
  let baseline: Source;
  if (first) {
    baseline = polishedSourceFor(first);
  } else if (isAvail("live")) {
    baseline = "live";
  } else {
    baseline = "preboard";
  }
  return { baseline, comparator: "agent_proposal" };
}

/** Token → Source parser. Accepts any ``polished:<curator>`` token
 *  (the curator name is data, not a literal). Returns ``null`` on
 *  unknown input so the URL layer can fall back to the default rather
 *  than crash. */
export function parseSource(s: string | null | undefined): Source | null {
  if (!s) return null;
  // Step 3b: any non-empty string is a valid Source (opaque
  // curation_id). Legacy literals continue to be recognised by
  // the helpers; unknown strings resolve via the curations list
  // lookup at render time. Empty / whitespace-only strings still
  // return null so the URL layer can fall back to the default.
  const trimmed = s.trim();
  return trimmed.length > 0 ? trimmed : null;
}
