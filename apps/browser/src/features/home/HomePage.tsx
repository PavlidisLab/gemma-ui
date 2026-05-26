/**
 * Home — single canonical layout (was a variant switcher across 14
 * design experiments; consolidated 2026-05-26 to the Brutalist
 * variant which became the site-wide aesthetic). The wrapper stays
 * so the route / consumers don't have to know about the variant
 * file name.
 */

import { HomeBrutalist } from "./variants/HomeBrutalist";

export function HomePage() {
  return <HomeBrutalist />;
}
