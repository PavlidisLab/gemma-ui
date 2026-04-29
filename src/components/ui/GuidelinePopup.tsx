import { HelpPopup } from "./HelpPopup";
import type { GuidelineSnippet } from "@/lib/guidelines";

/**
 * `<HelpPopup/>` filled in from a `GuidelineSnippet`. Renders bullets,
 * examples, and "don't" rules with consistent styling. Use this
 * everywhere a curator might want a quick refresher on the rule
 * for the surface they're looking at.
 */
export function GuidelinePopup({
  snippet,
  size = "md",
  align = "left",
}: {
  snippet: GuidelineSnippet;
  size?: "sm" | "md" | "lg";
  align?: "left" | "right";
}) {
  return (
    <HelpPopup
      title={snippet.title}
      source={snippet.source}
      sourceUrl={snippet.sourceUrl}
      size={size}
      align={align}
    >
      {snippet.bullets.length ? (
        <ul className="list-disc list-inside space-y-1">
          {snippet.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      ) : null}
      {snippet.examples?.length ? (
        <div>
          <div className="font-medium text-slate-600 mt-1">Examples</div>
          <ul className="list-disc list-inside space-y-0.5 text-slate-600">
            {snippet.examples.map((b, i) => (
              <li key={i}>
                <code className="font-mono text-[11px]">{b}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {snippet.donts?.length ? (
        <div>
          <div className="font-medium text-rose-700 mt-1">Don't</div>
          <ul className="list-disc list-inside space-y-0.5 text-rose-800">
            {snippet.donts.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </HelpPopup>
  );
}
