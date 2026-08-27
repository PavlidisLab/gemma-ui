/**
 * Links into the Gemma 1.0 webapp (the JSP pages under
 * ``/expressionExperiment/*.html``, ``/gene/showGene.html``, …).
 *
 * These are no longer offered to the public: 1.0 is the thing this app
 * replaces, and a visitor who follows one lands in a different, older
 * interface with no way back. They stay reachable for admins, who do
 * still need the full 1.0 detail pages, and they say "Gemma 1.0" —
 * "Legacy browser" / "View in Gemma" didn't tell anyone where they
 * were about to end up.
 *
 * One hook so the gate and the wording can't drift apart across the
 * four surfaces that carry such a link.
 */

import { useMe } from "@/api/auth";
import { gemma1Url } from "@/lib/gemmaConfig";

/** What every Gemma 1.0 link is called, everywhere. */
export const GEMMA_1_LABEL = "Gemma 1.0";

/** Resolved Gemma 1.0 URL for ``path``, or null when the viewer isn't
 *  an admin — in which case the caller renders nothing at all. */
export function useGemma1Url(path: string): string | null {
  const me = useMe();
  const isAdmin = !!me.data?.authorities?.includes("GROUP_ADMIN");
  return isAdmin ? gemma1Url(path) : null;
}
