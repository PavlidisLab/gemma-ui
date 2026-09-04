/** Types for the plain-JS favicon emitter, so each app's
 *  `faviconEmit.test.ts` can import it without a `@ts-expect-error` — that
 *  suppression sat on its own line above the import and prettier reflowed
 *  the import under it, which moved the suppression onto the wrong
 *  statement and broke the typecheck. */
export type FaviconVariant = "colour" | "mono";
export declare const MARK_PATH: string;
export declare const VARIANTS: FaviconVariant[];
export declare function buildFaviconSvg(
  markSvg: string,
  variant?: FaviconVariant,
): string;
