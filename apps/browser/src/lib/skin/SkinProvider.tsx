import { createContext, useContext, useEffect, useState } from "react";

/**
 * Skin system.
 *
 * A skin is a small bundle of CSS-variable overrides scoped to a
 * ``html.skin-<name>`` class. The tokens themselves are declared in
 * ``src/index.css``; ``tailwind.config.js`` reads them via
 * ``rgb(var(--skin-X) / <alpha-value>)`` so every gemma-* utility
 * automatically re-paints when the skin flips.
 *
 * Add a new skin in three places:
 *
 *   1. ``SKINS`` below — id + label + tagline.
 *   2. ``src/index.css`` — append ``html.skin-<id> { … overrides … }``.
 *   3. (optional) Targeted Tailwind-utility overrides in index.css
 *      for any chrome cues the token swap can't reach
 *      (corner radius, font size, etc.).
 *
 * Picked skin persists to localStorage (``gemma-browser-skin``) and
 * is restored on next mount. Defaults to ``default``.
 */

export type SkinId =
  | "default"
  | "extjs"
  | "ink"
  | "crt"
  | "riso"
  | "swiss"
  | "vapor"
  | "brutal";

interface SkinDef {
  id: SkinId;
  label: string;
  tagline: string;
}

export const SKINS: readonly SkinDef[] = [
  {
    id: "default",
    label: "Modern",
    tagline: "current Gemma 2.0 look",
  },
  {
    id: "extjs",
    label: "ExtJS classic",
    tagline: "Gemma 1.x retro",
  },
  {
    id: "ink",
    label: "Ink",
    tagline: "paper + warm type",
  },
  {
    id: "crt",
    label: "CRT",
    tagline: "phosphor terminal, scanlines",
  },
  {
    id: "riso",
    label: "Riso",
    tagline: "two-ink duotone print",
  },
  {
    id: "swiss",
    label: "Swiss",
    tagline: "International style, hairlines",
  },
  {
    id: "vapor",
    label: "Vapor",
    tagline: "neon synthwave, midnight",
  },
  {
    id: "brutal",
    label: "Brutalist",
    tagline: "concrete, heavy rules",
  },
];

const STORAGE_KEY = "gemma-browser-skin";
const CLASS_PREFIX = "skin-";

interface SkinCtx {
  skin: SkinId;
  setSkin: (id: SkinId) => void;
}

const SkinContext = createContext<SkinCtx | null>(null);

function readStoredSkin(): SkinId {
  if (typeof window === "undefined") return "default";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored && SKINS.some((s) => s.id === stored)) return stored as SkinId;
  return "default";
}

function applySkinClass(skin: SkinId) {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  // Strip any existing skin-* class and add the new one. Done in one
  // pass so the page never holds two skin classes simultaneously.
  const next: string[] = [];
  for (const cls of html.classList) {
    if (!cls.startsWith(CLASS_PREFIX)) next.push(cls);
  }
  if (skin !== "default") next.push(`${CLASS_PREFIX}${skin}`);
  html.className = next.join(" ");
}

export function SkinProvider({ children }: { children: React.ReactNode }) {
  const [skin, setSkinState] = useState<SkinId>(readStoredSkin);

  useEffect(() => {
    applySkinClass(skin);
    try {
      window.localStorage.setItem(STORAGE_KEY, skin);
    } catch {
      /* sandboxed env — ignore */
    }
  }, [skin]);

  return (
    <SkinContext.Provider value={{ skin, setSkin: setSkinState }}>
      {children}
    </SkinContext.Provider>
  );
}

export function useSkin(): SkinCtx {
  const ctx = useContext(SkinContext);
  if (!ctx)
    throw new Error("useSkin must be used inside a <SkinProvider>");
  return ctx;
}
