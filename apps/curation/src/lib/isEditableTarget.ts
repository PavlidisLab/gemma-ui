/**
 * Is the event target a place where the user is typing?
 *
 * Global key bindings must stand down inside text fields — the browser
 * owns undo there, and a curator typing a note should not have the page
 * navigate out from under them. Non-text inputs (checkbox, radio,
 * button) don't own these keys, so bindings still fire.
 *
 * Shared so every global binding answers the question the same way; the
 * undo/redo handler and the candidate-to-candidate navigation both use
 * it.
 */
export function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "SELECT") return true;
  if (tag === "INPUT") {
    const t = (el as HTMLInputElement).type;
    return ![
      "checkbox",
      "radio",
      "button",
      "submit",
      "reset",
      "range",
      "color",
    ].includes(t);
  }
  return false;
}
