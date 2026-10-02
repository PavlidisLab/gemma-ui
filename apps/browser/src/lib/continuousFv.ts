/**
 * Display value for a measurement-backed (continuous-factor) FactorValue.
 *
 * Mirrors the curation app's ``continuousFvValue``
 * (``apps/curation/src/features/diagnostics/heatmapPayload.ts``) — same
 * bug, same fix, different wire shape: this app's design endpoint is the
 * real Gemma REST API, which puts the scalar on ``measurement.value``
 * (a string) and leaves ``value``/``characteristics``/``statements``
 * empty for these FVs. ``summary`` still renders as "category: value"
 * ("age: 13"), number trailing — a plain ``Number(raw)`` or
 * leading-number match on ``summary`` reads every value as non-numeric
 * (verified against gemma2.msl.ubc.ca, experiment 93630's age factor,
 * FV 382639 etc. — all 71 values shaped exactly this way).
 */

interface MeasurementFv {
  value?: string | null;
  summary?: string | null;
  measurement?: { value?: string | null; unit?: string | null } | null;
  characteristics?: { value?: string | null }[] | null;
  statements?: { subject?: string | null }[] | null;
}

/** Parsed numeric value, or ``null`` when nothing on the FV parses —
 *  the honest answer for a continuous factor whose measurement was
 *  never filled in. */
export function continuousFvNumeric(fv: MeasurementFv): number | null {
  const mv = fv.measurement?.value;
  if (typeof mv === "string" && mv.trim() !== "") {
    const n = Number(mv);
    if (Number.isFinite(n)) return n;
  }
  const candidates = [
    fv.summary,
    fv.value,
    fv.characteristics?.find((c) => (c.value ?? "").trim())?.value,
    fv.statements?.find((s) => (s.subject ?? "").trim())?.subject,
  ];
  for (const c of candidates) {
    const n = parseTrailingNumber(String(c ?? "").trim());
    if (n != null) return n;
  }
  return null;
}

/** Leading number, so "86 years" still reads as 86. But a plain
 *  characteristic's ``summary`` renders as "category: value"
 *  ("age: 13"), number trailing — retry past the last colon before
 *  giving up, so the category name doesn't block the value behind it. */
function parseTrailingNumber(raw: string): number | null {
  if (raw === "") return null;
  const m = raw.match(/^[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/);
  if (m) return Number(m[0]);
  if (raw.includes(":")) {
    const afterColon = raw.slice(raw.lastIndexOf(":") + 1).trim();
    const m2 = afterColon.match(/^[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/);
    if (m2) return Number(m2[0]);
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Display label for a measurement FV: the parsed number (plus unit,
 *  when Gemma supplied one), never the raw "category: value" summary.
 *  Falls back to ``null`` so a caller can keep its own non-numeric
 *  fallback (e.g. a stray free-text measurement) rather than hiding it. */
export function continuousFvLabel(fv: MeasurementFv): string | null {
  const n = continuousFvNumeric(fv);
  if (n == null) return null;
  // Cap at 3 sig figs for non-integers (dose, time post infection, …)
  // so float artifacts never leak into the display.
  const formatted = Number.isInteger(n)
    ? String(n)
    : n.toPrecision(3).replace(/\.?0+$/, "");
  const unit = fv.measurement?.unit;
  return unit ? `${formatted} ${unit}` : formatted;
}
