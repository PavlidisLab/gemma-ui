import { useTicket } from "@/api/tickets";
import {
  defaultSlots,
  isSourceValidInSlot,
  parseSource,
  type FlowKind,
  type Source,
} from "./sources";
import {
  usePolishedCuratorList,
  useSourceUniverse,
} from "./useSourceAvailability";

/** Read-only resolver for the active chip-strip baseline source —
 *  the same calculation `useChipState` does internally, exposed at
 *  the App level so DesignDraftProvider can route its ``saved``
 *  source through it BEFORE FlowProvider is mounted in the tree.
 *
 *  Returns undefined when the resolution isn't ready (universe still
 *  loading, etc.). Consumers should fall back to whichever behaviour
 *  they had pre-chip-routing.
 *
 *  NB: this is the READ side only — chip clicks still write back via
 *  ``useChipState`` below the FlowProvider. The URL is the single
 *  source of truth either way, so calling both here and there reads
 *  the same value.
 */
export function useActiveBaselineSource(args: {
  experimentId: number | string;
  /** URL-set baseline. Pulled from the parsed route at App level. */
  urlBaseline: Source | undefined;
  /** Ticket id for flow resolution. Pulled from
   *  ``route.ticketContext``. ``null`` when the route doesn't carry
   *  one — flow then defaults to ``review``. */
  ticketIdNumeric: number | null;
}): Source | undefined {
  const { experimentId, urlBaseline, ticketIdNumeric } = args;
  const activeTicket = useTicket(
    Number.isFinite(ticketIdNumeric) ? ticketIdNumeric : null,
  );
  const flow: FlowKind =
    activeTicket.data?.flow === "edit" ? "edit" : "review";

  const universe = useSourceUniverse(experimentId);
  const polishedCurators = usePolishedCuratorList(experimentId);

  if (urlBaseline) {
    const parsed = parseSource(urlBaseline);
    if (parsed && isSourceValidInSlot("baseline", parsed)) {
      return parsed;
    }
  }
  if (universe.isLoading) return undefined;
  const defaults = defaultSlots(flow, {
    polishedCurators,
    availability: universe.availability,
  });
  return defaults.baseline;
}
