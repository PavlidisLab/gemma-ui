/**
 * Cross-tab "scroll to a specific BM in the samples table" plumbing.
 *
 * Use case: an audit finding (target_kind=assignment) or a proposal's
 * per-sample reassignment shows a sample short_name. The curator
 * clicks it; the app switches to the Samples tab and scrolls that
 * row into view (highlighted briefly).
 *
 * Implementation is window events, not React context, so a click
 * deep inside the audit sidebar can reach the experiment Shell + the
 * SampleDetailsPanel without threading callbacks through a dozen
 * components. Two events:
 *
 *   - `gemma:request-sample-scroll`  — fired by callers (audit /
 *     proposal cards). The Shell listens, switches to the samples
 *     tab if the experiment matches, then re-fires the row event.
 *
 *   - `gemma:samples-scroll-row`  — fired by the Shell after the tab
 *     switch is in flight. SampleDetailsPanel listens, scrolls the
 *     matching `<tr data-bm-shortname=…>` into view, and flashes a
 *     ring on it for ~2s so the curator's eye lands on it.
 *
 * The two-step bounce exists because the panel may not be mounted
 * yet when the request fires — switching to the samples tab triggers
 * a render, then the Shell re-dispatches a frame later when the
 * panel's listener is attached.
 */

const REQUEST_EVENT = "gemma:request-sample-scroll";
const ROW_EVENT = "gemma:samples-scroll-row";

export interface RequestSampleScrollDetail {
  experimentId: number | string;
  shortName: string;
}

export interface SamplesScrollRowDetail {
  shortName: string;
}

/** Caller-facing API: ask the app to scroll a specific BM into view
 *  in the samples table. No-op when no Shell is mounted (e.g. the
 *  audit detail page outside an experiment). */
export function requestSampleScroll(
  experimentId: number | string,
  shortName: string,
): void {
  window.dispatchEvent(
    new CustomEvent<RequestSampleScrollDetail>(REQUEST_EVENT, {
      detail: { experimentId, shortName },
    }),
  );
}

export function onRequestSampleScroll(
  handler: (detail: RequestSampleScrollDetail) => void,
): () => void {
  function listener(e: Event) {
    handler((e as CustomEvent<RequestSampleScrollDetail>).detail);
  }
  window.addEventListener(REQUEST_EVENT, listener);
  return () => window.removeEventListener(REQUEST_EVENT, listener);
}

/** Shell-facing: re-dispatch as a row-scroll event once the samples
 *  tab is mounted. Wrap in a frame delay so the panel's listener is
 *  attached before the dispatch fires. */
export function dispatchSamplesScrollRow(shortName: string): void {
  // Two RAFs: first lets React commit the tab switch; second lets
  // the panel mount its useEffect listener. Empirically reliable.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent<SamplesScrollRowDetail>(ROW_EVENT, {
          detail: { shortName },
        }),
      );
    });
  });
}

export function onSamplesScrollRow(
  handler: (detail: SamplesScrollRowDetail) => void,
): () => void {
  function listener(e: Event) {
    handler((e as CustomEvent<SamplesScrollRowDetail>).detail);
  }
  window.addEventListener(ROW_EVENT, listener);
  return () => window.removeEventListener(ROW_EVENT, listener);
}
