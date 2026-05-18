/**
 * Bloom variant — curves + multi-colour, pulled from Gemma's
 * sunburst favicon (warm amber/coral rays + teal/blue counter-rays
 * + green/magenta/violet inner petals).
 *
 * Design intent:
 *   - Hero is an SVG sunburst that's literally a stylized re-draw
 *     of Gemma's mark — variant-specific but recognisable, so the
 *     page reads as "Gemma's home" not "generic landing."
 *   - Sections wrap in soft curved (rounded-3xl / rounded-full)
 *     containers with gradient backgrounds. Calming, not flashy.
 *   - Pastel saturation; no neon. Each surface tile gets its own
 *     hue, drawn from the sunburst slice it sits under.
 *   - Inter for everything, generous leading.
 */

import { Link } from "@tanstack/react-router";
import { COPY, SURFACES } from "../copy";
import { useGemmaSummary, fmtCount } from "../useGemmaSummary";

// Palette pulled from the favicon — warm to cool. Used by stat
// tiles and surface tiles in order so adjacent siblings get visually
// distinct petals.
const PETAL = [
  { bg: "bg-amber-50",  ink: "text-amber-900",   accent: "bg-amber-400",   ring: "ring-amber-200/60" },
  { bg: "bg-rose-50",   ink: "text-rose-900",    accent: "bg-rose-400",    ring: "ring-rose-200/60" },
  { bg: "bg-emerald-50",ink: "text-emerald-900", accent: "bg-emerald-400", ring: "ring-emerald-200/60" },
  { bg: "bg-sky-50",    ink: "text-sky-900",     accent: "bg-sky-400",     ring: "ring-sky-200/60" },
  { bg: "bg-violet-50", ink: "text-violet-900",  accent: "bg-violet-400",  ring: "ring-violet-200/60" },
  { bg: "bg-pink-50",   ink: "text-pink-900",    accent: "bg-pink-400",    ring: "ring-pink-200/60" },
];

export function HomeBloom() {
  const s = useGemmaSummary();
  return (
    <div
      className="h-full overflow-y-auto text-slate-900"
      style={{
        fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif',
        // Soft multi-stop gradient — warm in the top-left, cool
        // bottom-right. Whole page sits inside this wash.
        background:
          "radial-gradient(ellipse at 12% 0%, #fff7ed 0%, transparent 55%), radial-gradient(ellipse at 100% 90%, #ecfeff 0%, transparent 60%), linear-gradient(180deg, #fefce8 0%, #fdf2f8 100%)",
      }}
    >
      <div className="max-w-6xl mx-auto px-6 py-10 space-y-8">
        {/* Hero — sunburst + tagline */}
        <section className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
          <div className="md:col-span-5 flex items-center justify-center">
            <Sunburst />
          </div>
          <div className="md:col-span-7 space-y-4">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium tracking-tight text-slate-800">
                Gemma
              </span>
              <span className="text-xs text-slate-500">
                — curated expression data
              </span>
            </div>
            <h1 className="text-4xl leading-[1.1] tracking-tight text-slate-900 font-medium">
              {COPY.tagline}
            </h1>
            <p className="text-base leading-relaxed text-slate-700 max-w-2xl">
              {COPY.about}
            </p>
          </div>
        </section>

        {/* Stat petals — rounded cards in three petal hues */}
        <section className="grid grid-cols-3 gap-4">
          <StatPetal label="Datasets" value={fmtCount(s.datasets, "full", s.isLoading)} petal={PETAL[0]} />
          <StatPetal label="Platforms" value={fmtCount(s.platforms, "full", s.isLoading)} petal={PETAL[2]} />
          <StatPetal label="Samples" value={fmtCount(s.samples, "full", s.isLoading)} petal={PETAL[3]} />
        </section>

        {/* Surface tiles — each in its own petal hue, rounded-3xl
            corners, soft ring on hover. */}
        <section>
          <div className="text-xs uppercase tracking-wide font-medium text-slate-500 mb-3 px-1">
            Explore
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {SURFACES.map((surf, i) => (
              <SurfaceTile
                key={surf.label}
                surface={surf}
                petal={PETAL[(i + 1) % PETAL.length]}
              />
            ))}
          </div>
        </section>

        {/* Footer — soft pill */}
        <footer className="bg-white/70 backdrop-blur rounded-full px-5 py-3 border border-slate-200 flex items-baseline justify-between gap-4 flex-wrap text-xs text-slate-600">
          <span>Pavlidis Lab · UBC</span>
          <div className="flex items-center gap-4">
            <a href={COPY.links.docs} target="_blank" rel="noreferrer" className="text-slate-700 hover:text-slate-900">Docs</a>
            <a href={COPY.links.rest} target="_blank" rel="noreferrer" className="text-slate-700 hover:text-slate-900">REST</a>
            <a href={COPY.links.github} target="_blank" rel="noreferrer" className="text-slate-700 hover:text-slate-900">GitHub</a>
          </div>
        </footer>
      </div>
    </div>
  );
}

/** Stylized re-draw of Gemma's sunburst favicon — 16 rays alternating
 *  warm + cool, six-pointed inner petals in jewel tones, central
 *  white-ish disc. Pure SVG, no external asset. */
function Sunburst() {
  const cx = 100;
  const cy = 100;
  const rays = 16;
  const innerR = 38;
  const midR = 58;
  const outerR = 92;
  const ringColors = ["#f97316", "#3b82f6"]; // amber + blue — favicon ray hues
  const petalColors = ["#ef4444", "#f59e0b", "#22c55e", "#14b8a6", "#8b5cf6", "#ec4899"];
  return (
    <svg viewBox="0 0 200 200" className="w-full max-w-[18rem] aspect-square">
      {/* Rays */}
      <g>
        {Array.from({ length: rays }, (_, i) => {
          const a = (i * 2 * Math.PI) / rays - Math.PI / 2;
          const x1 = cx + Math.cos(a) * midR;
          const y1 = cy + Math.sin(a) * midR;
          const x2 = cx + Math.cos(a) * outerR;
          const y2 = cy + Math.sin(a) * outerR;
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={ringColors[i % 2]}
              strokeWidth="6"
              strokeLinecap="round"
            />
          );
        })}
      </g>
      {/* Six-petal inner flower */}
      <g>
        {petalColors.map((c, i) => {
          const a = (i * 2 * Math.PI) / 6 - Math.PI / 2;
          const px = cx + Math.cos(a) * (innerR - 6);
          const py = cy + Math.sin(a) * (innerR - 6);
          return (
            <circle
              key={i}
              cx={px}
              cy={py}
              r={16}
              fill={c}
              opacity={0.92}
            />
          );
        })}
      </g>
      {/* Center disc */}
      <circle cx={cx} cy={cy} r={14} fill="#fff" stroke="#1f2937" strokeWidth="1.5" />
    </svg>
  );
}

function StatPetal({
  label,
  value,
  petal,
}: {
  label: string;
  value: string;
  petal: (typeof PETAL)[number];
}) {
  return (
    <div
      className={`rounded-3xl px-5 py-4 ${petal.bg} border border-white/60 shadow-sm`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={`inline-block w-2 h-2 rounded-full ${petal.accent}`} />
        <span className="text-[10px] uppercase tracking-wide text-slate-600">{label}</span>
      </div>
      <div className={`text-3xl font-semibold tabular-nums ${petal.ink}`}>{value}</div>
    </div>
  );
}

function SurfaceTile({
  surface,
  petal,
}: {
  surface: (typeof SURFACES)[number];
  petal: (typeof PETAL)[number];
}) {
  const inner = (
    <div className={`rounded-3xl px-6 py-5 ${petal.bg} border border-white/60`}>
      <div className="flex items-baseline gap-2 mb-1">
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${petal.accent}`} />
        <span className={`text-lg font-semibold tracking-tight ${petal.ink}`}>
          {surface.label}
        </span>
        {surface.to ? <span className={`ml-auto ${petal.ink} opacity-50`}>→</span> : null}
      </div>
      <div className="text-sm text-slate-600 leading-snug">
        {surface.blurb}
      </div>
    </div>
  );
  if (!surface.to) {
    return <div className="opacity-50 cursor-not-allowed">{inner}</div>;
  }
  return (
    <Link
      to={surface.to}
      className={`block hover:no-underline hover:ring-4 ${petal.ring} rounded-3xl transition-shadow`}
    >
      {inner}
    </Link>
  );
}
