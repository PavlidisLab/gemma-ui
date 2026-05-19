/**
 * Home — variant switcher.
 *
 * Five design directions live under `./variants/`. The active one is
 * chosen by `?v=<key>` on the URL (so a link can pin a variant) with
 * a fallback to localStorage (so reloads stick) and then to "cards"
 * (the v0 baseline) when neither is set.
 *
 * A small picker pinned to the top-right lets the curator flip
 * variants without losing context. Click outside / Esc to dismiss.
 *
 * To add a new variant: drop it under `./variants/<Name>.tsx`,
 * register it in `VARIANTS` below, ship.
 */

import { useEffect, useRef, useState } from "react";
import { HomeCards } from "./variants/HomeCards";
import { HomeEditorial } from "./variants/HomeEditorial";
import { HomeTerminal } from "./variants/HomeTerminal";
import { HomeBrutalist } from "./variants/HomeBrutalist";
import { HomeMinimal } from "./variants/HomeMinimal";
import { HomeDashboard } from "./variants/HomeDashboard";
import { HomeAcademicPoster } from "./variants/HomeAcademicPoster";
import { HomeSpecimenPlate } from "./variants/HomeSpecimenPlate";
import { HomeLibraryCatalog } from "./variants/HomeLibraryCatalog";
import { HomeAtlas } from "./variants/HomeAtlas";
import { HomeHeatmap } from "./variants/HomeHeatmap";
import { HomeBloom } from "./variants/HomeBloom";
import { HomeCosmos } from "./variants/HomeCosmos";
import { HomeTidepool } from "./variants/HomeTidepool";

type VariantKey =
  | "cards"
  | "editorial"
  | "terminal"
  | "brutalist"
  | "minimal"
  | "dashboard"
  | "poster"
  | "specimen"
  | "catalog"
  | "atlas"
  | "heatmap"
  | "bloom"
  | "cosmos"
  | "tidepool";

const VARIANTS: Record<
  VariantKey,
  { label: string; subtitle: string; Component: () => React.ReactElement }
> = {
  cards: {
    label: "Cards",
    subtitle: "v0 baseline — search hero + nav grid",
    Component: HomeCards,
  },
  editorial: {
    label: "Editorial",
    subtitle: "serif masthead, multi-column lede",
    Component: HomeEditorial,
  },
  terminal: {
    label: "Terminal",
    subtitle: "monospace, dense, command-line",
    Component: HomeTerminal,
  },
  brutalist: {
    label: "Brutalist",
    subtitle: "sharp blocks, oversized type, asymmetric grid",
    Component: HomeBrutalist,
  },
  minimal: {
    label: "Minimal",
    subtitle: "quiet, whitespace, Stripe / Linear register",
    Component: HomeMinimal,
  },
  dashboard: {
    label: "Dashboard",
    subtitle: "stats are the hero, taxon table",
    Component: HomeDashboard,
  },
  poster: {
    label: "Academic poster",
    subtitle: "conference-poster columns, abstract, figure callouts",
    Component: HomeAcademicPoster,
  },
  specimen: {
    label: "Specimen plate",
    subtitle: "monograph aesthetic, SVG specimen plate hero",
    Component: HomeSpecimenPlate,
  },
  catalog: {
    label: "Library catalog",
    subtitle: "tan index cards, typewriter type, pseudo-Dewey",
    Component: HomeLibraryCatalog,
  },
  atlas: {
    label: "Atlas",
    subtitle: "cartographic — compass rose, contour plate, scale bar",
    Component: HomeAtlas,
  },
  heatmap: {
    label: "Heatmap",
    subtitle: "the page IS the visualization — coverage matrix hero",
    Component: HomeHeatmap,
  },
  bloom: {
    label: "Bloom",
    subtitle: "curves + Gemma sunburst palette — pastel, organic",
    Component: HomeBloom,
  },
  cosmos: {
    label: "Cosmos",
    subtitle: "dark, glowing, nebula gradients + star field",
    Component: HomeCosmos,
  },
  tidepool: {
    label: "Tidepool",
    subtitle: "calming watercolor wash, serif italics, wave dividers",
    Component: HomeTidepool,
  },
};

const LS_KEY = "gemma-home-variant";
const URL_PARAM = "v";

function readInitialVariant(): VariantKey {
  if (typeof window === "undefined") return "brutalist";
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get(URL_PARAM);
  if (fromUrl && fromUrl in VARIANTS) return fromUrl as VariantKey;
  try {
    const fromStorage = window.localStorage.getItem(LS_KEY);
    if (fromStorage && fromStorage in VARIANTS) return fromStorage as VariantKey;
  } catch {
    /* localStorage disabled — silently fall through */
  }
  return "brutalist";
}

export function HomePage() {
  const [variant, setVariant] = useState<VariantKey>(readInitialVariant);

  // Persist the choice + sync the URL so the variant is shareable.
  useEffect(() => {
    try {
      window.localStorage.setItem(LS_KEY, variant);
    } catch {
      /* ignore */
    }
    const url = new URL(window.location.href);
    if (url.searchParams.get(URL_PARAM) !== variant) {
      url.searchParams.set(URL_PARAM, variant);
      window.history.replaceState({}, "", url.toString());
    }
  }, [variant]);

  const { Component } = VARIANTS[variant];

  return (
    <div className="relative h-full">
      <Component />
      <VariantPicker active={variant} onPick={setVariant} />
    </div>
  );
}

function VariantPicker({
  active,
  onPick,
}: {
  active: VariantKey;
  onPick: (k: VariantKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="fixed top-16 right-3 z-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-slate-300 bg-white/95 backdrop-blur text-slate-700 hover:text-slate-900 hover:border-slate-500 shadow-sm"
        title="switch home design"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        <span className="font-mono">v: {VARIANTS[active].label}</span>
        <span className="text-slate-400">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div className="mt-1 w-64 rounded border border-slate-300 bg-white shadow-lg text-sm overflow-hidden">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-slate-500 border-b border-slate-100">
            Home design — try one
          </div>
          {(Object.keys(VARIANTS) as VariantKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                onPick(k);
                setOpen(false);
              }}
              className={
                "w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100 last:border-b-0 " +
                (k === active ? "bg-emerald-50/60" : "")
              }
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-slate-900">{VARIANTS[k].label}</span>
                {k === active ? (
                  <span className="text-[10px] text-emerald-700 font-mono">active</span>
                ) : null}
              </div>
              <div className="text-xs text-slate-500 leading-snug mt-0.5">
                {VARIANTS[k].subtitle}
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
