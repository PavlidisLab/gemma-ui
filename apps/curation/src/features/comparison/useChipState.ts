import { useCallback, useEffect, useState } from "react";
import {
  defaultSlots,
  isPairAllowed,
  isSourceValidInSlot,
  type FlowKind,
  type Source,
} from "./sources";
import { useSourceUniverse, usePolishedCuratorList } from "./useSourceAvailability";
import { experimentRoute, navigate, parseRoute } from "../../routes";

/** Comparison-view chip state. Mirrors the URL ``?base=`` /
 *  ``?cmp=`` query params; defaults from the ``flow`` argument when
 *  the URL doesn't pin a selection. */
export interface ChipState {
  baseline: Source;
  comparator: Source;
  /** Switch the baseline slot. No-op if the chosen source isn't
   *  valid for that slot (defensive — the chip menu shouldn't
   *  expose invalid entries, but the URL might be hand-edited). */
  setBaseline: (s: Source) => void;
  /** Switch the comparator slot. */
  setComparator: (s: Source) => void;
}

/** Reads the chip selection out of the URL; falls back to
 *  ``defaultSlots(flow)`` when the URL doesn't pin one or the URL
 *  selection violates a slot-validity rule. Writes are pushed back
 *  via ``navigate(experimentRoute(...))`` so the route stays the
 *  single source of truth — refresh + back-button work for free.
 *
 *  Threads ``experimentId``, ``tab``, ``groupContext``,
 *  ``ticketContext`` through every write so other route state isn't
 *  clobbered when the curator flips a chip. */
export function useChipState(args: {
  experimentId: number | string;
  flow: FlowKind;
  tab?: string;
  groupContext?: string;
  ticketContext?: string;
}): ChipState {
  const { experimentId, flow, tab, groupContext, ticketContext } = args;
  // Pass availability + polished curators to defaultSlots so the
  // default baseline falls through ("polished -> live -> preboard")
  // based on what's actually loaded for this experiment, instead of
  // sticking on an unavailable `preboard` and leaving the chip
  // strip showing "Gemma preboard" as the anchor. Per design review
  // 2026-06-08: chip strip showed "Gemma preboard" for the v6 pack
  // even though the unified /curation-versions endpoint reported
  // no preboard.
  const universe = useSourceUniverse(experimentId);
  const polishedCurators = usePolishedCuratorList(experimentId);
  const defaults = defaultSlots(flow, {
    polishedCurators,
    availability: universe.availability,
  });

  const [route, setRoute] = useState(() => parseRoute());

  useEffect(() => {
    function onHashChange() {
      setRoute(parseRoute());
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const fromUrl =
    route.kind === "experiment" && String(route.id) === String(experimentId)
      ? {
          baseline: route.baselineSource,
          comparator: route.comparatorSource,
        }
      : { baseline: undefined, comparator: undefined };

  // Apply slot-validity gate: an invalid URL selection collapses
  // back to the default. We don't auto-rewrite the URL here — that
  // would race with the user's first interaction. parseRoute will
  // pick up the next change.
  const baseline: Source =
    fromUrl.baseline && isSourceValidInSlot("baseline", fromUrl.baseline)
      ? fromUrl.baseline
      : defaults.baseline;
  const comparator: Source = fromUrl.comparator ?? defaults.comparator;

  const writeUrl = useCallback(
    (next: { baseline: Source; comparator: Source }) => {
      // The pair rule may forbid the requested combination
      // (e.g. baseline=empty, comparator=preboard). When so, force
      // the comparator to empty rather than persist a forbidden
      // state. UI should suppress the option anyway; this is a
      // defensive guard.
      const safeCmp = isPairAllowed(next.baseline, next.comparator)
        ? next.comparator
        : "empty";
      navigate(
        experimentRoute(
          experimentId,
          tab as never,
          groupContext,
          ticketContext,
          {
            base: next.baseline === defaults.baseline ? undefined : next.baseline,
            cmp: safeCmp === defaults.comparator ? undefined : safeCmp,
          },
        ),
      );
    },
    [experimentId, tab, groupContext, ticketContext, defaults.baseline, defaults.comparator],
  );

  const setBaseline = useCallback(
    (s: Source) => {
      if (!isSourceValidInSlot("baseline", s)) return;
      writeUrl({ baseline: s, comparator });
    },
    [writeUrl, comparator],
  );

  const setComparator = useCallback(
    (s: Source) => {
      if (!isSourceValidInSlot("comparator", s)) return;
      writeUrl({ baseline, comparator: s });
    },
    [writeUrl, baseline],
  );

  return { baseline, comparator, setBaseline, setComparator };
}
