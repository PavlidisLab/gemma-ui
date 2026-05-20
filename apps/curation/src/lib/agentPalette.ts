/**
 * Shared "agent identity" tint helper used by both the audit panel
 * and the proposal panel so a given AI model gets the same pill
 * colour across surfaces.
 *
 * Picks a stable palette index from the agent's base name —
 * trailing version markers (``-v5b``, ``_v3``, ``-2026-05-17``,
 * ``-2026-05-17-foo``) are stripped first so ``hybrid-v5b`` and
 * ``hybrid-v6`` map to the same colour. The hash is intentionally
 * cheap (additive char-code) — we only need stability, not
 * cryptographic spread.
 */

const PALETTES = [
  "bg-indigo-50 border-indigo-300 text-indigo-900 dark:bg-indigo-900/40 dark:border-indigo-700 dark:text-indigo-100",
  "bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-900/40 dark:border-amber-700 dark:text-amber-100",
  "bg-emerald-50 border-emerald-300 text-emerald-900 dark:bg-emerald-900/40 dark:border-emerald-700 dark:text-emerald-100",
  "bg-rose-50 border-rose-300 text-rose-900 dark:bg-rose-900/40 dark:border-rose-700 dark:text-rose-100",
  "bg-violet-50 border-violet-300 text-violet-900 dark:bg-violet-900/40 dark:border-violet-700 dark:text-violet-100",
  "bg-sky-50 border-sky-300 text-sky-900 dark:bg-sky-900/40 dark:border-sky-700 dark:text-sky-100",
  "bg-teal-50 border-teal-300 text-teal-900 dark:bg-teal-900/40 dark:border-teal-700 dark:text-teal-100",
];

export function normalizeAgentName(model: string): string {
  let s = (model || "").trim();
  const TAIL = /(?:[-_](?:v\d+[a-z]?|\d{4}-\d{2}-\d{2}(?:-[a-z0-9]+)?|\d{8}|\d+))+$/i;
  while (TAIL.test(s)) {
    s = s.replace(TAIL, "");
    if (!s) break;
  }
  return s.toLowerCase();
}

export function agentPalette(model: string): string {
  const key = normalizeAgentName(model || "agent");
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTES[h % PALETTES.length];
}

/** True when `model` is a human prose context label rather than an
 *  agent identifier. Agents-side builder writes prose like
 *  ``"inter-curator audit · cyan's curation applied · amanda reviews"``
 *  here for inter-curator audit packages, where "what model ran the
 *  audit" stops being the load-bearing identity for the surface and
 *  "who curated vs who reviews" takes over. The pill render switches
 *  off ``font-mono`` + drops the truncate cap when this returns true,
 *  and the tag-label flips from ``agent`` to ``review``.
 *
 *  Heuristic: prose contains spaces and/or middle-dot (``·``).
 *  Standard agent IDs like ``hybrid-v6`` / ``s2j-opus-pipeline`` /
 *  ``claude-opus-4-5`` have neither. */
export function isProseModel(model: string | null | undefined): boolean {
  if (!model) return false;
  return /\s/.test(model) || model.includes("·");
}
