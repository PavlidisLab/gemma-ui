/**
 * An in-app navigation target that is a real link.
 *
 * The app has had two shapes for going somewhere, and each was missing
 * half of what a link does:
 *
 *  - a `<button onClick={() => navigate(…)}>` — runs the unsaved-changes
 *    blockers, but the browser does not know it is a link, so there is
 *    no right-click → "Open in new tab", no cmd/ctrl-click, no
 *    middle-click, and no status-bar target on hover;
 *  - a bare `<a href="#/…">` — opens in a new tab correctly, but sets
 *    the hash directly and so walks past the blockers in `routes.ts`.
 *
 * This is both: an anchor the browser treats as an anchor, whose PLAIN
 * left click is handled by `navigate()` so a dirty draft still gets to
 * object. A modified click (cmd / ctrl / shift / alt) and a
 * middle-click fall through untouched — those open a NEW document, so
 * there is nothing to guard: the current tab keeps its draft and stays
 * where it is.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { navigate } from "@/routes";

export interface HashLinkProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick"> {
  /** Hash route, e.g. `#/` or `#/tickets/12`. */
  to: string;
  children: ReactNode;
}

/** True when the browser should handle the click itself — the user has
 *  asked for a new tab / window, and taking it over would silently
 *  refuse them. */
function opensElsewhere(e: React.MouseEvent<HTMLAnchorElement>): boolean {
  return (
    e.metaKey ||
    e.ctrlKey ||
    e.shiftKey ||
    e.altKey ||
    // 0 is the main button; anything else (middle-click paste-and-go,
    // back/forward thumb buttons) is not ours to intercept.
    e.button !== 0
  );
}

export function HashLink({ to, children, ...rest }: HashLinkProps) {
  return (
    <a
      {...rest}
      href={to}
      onClick={(e) => {
        if (opensElsewhere(e)) return;
        // A `target` the caller set (`_blank`) is also the user asking
        // for another document — same reasoning as a modified click.
        if (rest.target && rest.target !== "_self") return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
