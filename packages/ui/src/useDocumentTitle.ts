import { useEffect } from "react";

/**
 * Set the browser tab title while a component is mounted, restoring the
 * previous one on unmount.
 *
 * Both apps shipped a single static `<title>` from `index.html` — every
 * tab read "Gemma Browser" or "Gemma curation" no matter what was on
 * screen, so a curator with several datasets open had a row of
 * identical tabs and no way to tell them apart ("the tab title should
 * be the GSE when appropriate — make it more informative", Paul,
 * 2026-08-16).
 *
 * Shared rather than written twice: the two apps are one product, and a
 * tab title is exactly the kind of thing that drifts into two different
 * formats when each side owns its own copy.
 *
 * Pass `null` to leave the title alone — a page that hasn't loaded its
 * subject yet should keep the app name rather than flashing "undefined"
 * and then correcting itself.
 */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = title;
    // Restoring matters for SPA navigation: without it, leaving a
    // dataset page for a list would strand the dataset's title on a tab
    // that no longer shows it.
    return () => {
      document.title = previous;
    };
  }, [title]);
}

/**
 * Compose a tab title as `subject · App Name`, dropping the separator
 * when there is no subject.
 *
 * The subject leads because tabs truncate from the right, and the whole
 * point is that the accession survives a narrow tab.
 */
export function pageTitle(
  subject: string | null | undefined,
  appName: string,
): string {
  const s = (subject ?? "").trim();
  return s ? `${s} · ${appName}` : appName;
}
