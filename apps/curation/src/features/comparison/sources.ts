/** The comparison-view sources. Spec:
 *  ``docs/CURATION_COMPARISON_VIEW_2026_05_27.md``.
 *
 *  Three system-level sources (``empty``, ``preboard``,
 *  ``agent_proposal``) plus a dynamic ``polished:<curator>`` family
 *  driven by whichever curation packs have been loaded for the
 *  experiment. ``polished:cyan`` and ``polished:amanda`` are typical
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
 *  id like `live` / `polished:cyan`, future producer kind) can sit
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

/** Title-Case a curator username for display. ``"cyan"`` → ``"Cyan"``;
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
      if (producer && kind) return `${producer} (${kind})`;
      if (producer) return producer;
      if (kind) return kind;
    }
  }
  if (s === "empty") return "(empty)";
  // Was "Gemma" — misleading: preboard is the GEO-only pre-curation
  // snapshot, not the live Gemma curation state. Per Paul 2026-06-08
  // (chip-strip showed "Gemma / Gemma" with no agent option, and the
  // baseline was actually the preboard). "Gemma preboard" distinguishes
  // from live Gemma / polished sets once the unified curation-versions
  // model lands. See HANDOFF_2026-06-08_UNIFIED_CURATION_VERSIONS.md.
  if (s === "preboard") return "Gemma preboard";
  if (s === "live") return "Gemma (live)";
  if (s === "agent_proposal") return "agent original proposal";
  if (isPolishedSource(s)) {
    const curator = polishedCuratorOf(s);
    // Consensus-producer rows are routed through the polished
    // channel until step 3b drops the Source enum (2026-06-08).
    // Their tokens are slugified consensus:<id> → polished:consensus_<id>;
    // unslug back to the canonical "consensus:<id>" form for display
    // so the chip reads honestly.
    if (curator.startsWith("consensus_")) {
      return curator.replace(/^consensus_/, "consensus:");
    }
    return `${titleCaseCurator(curator)} polished`;
  }
  return s;
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
    // ``empty`` isn't a legitimate baseline (Paul 2026-05-29: "there
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
 *  - ``review``: post-curation evaluation. Open into "where did the
 *    agent go wrong" → <first available polished curator> vs agent
 *    proposal. Falls back to ``preboard`` vs agent proposal when no
 *    polished pack is loaded yet.
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
  },
): { baseline: Source; comparator: Source } {
  const av = options?.availability;
  const isAvail = (s: Source): boolean =>
    av ? (av[s]?.available ?? true) : true;

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
