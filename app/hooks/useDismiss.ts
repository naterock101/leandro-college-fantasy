import { useEffect } from "react";

/**
 * Closes an open thing, by pointer or by keyboard, and puts focus back where
 * it came from.
 *
 * This grew out of a `useClickAway` that only knew about the pointer. A menu
 * that can only be dismissed by clicking somewhere else is a trap for anyone
 * driving the page from the keyboard: the three dropdowns had `aria-expanded`
 * and nothing behind it, so there was no way out and, once out, no way back to
 * the control that had been pressed.
 *
 * Escape is listened for on the document rather than on the menu, because by
 * the time anyone wants to escape, focus is on a checkbox inside it - and it
 * still has to work when focus never left the trigger.
 *
 * Focus is only restored when it is inside the thing being closed. Clicking
 * elsewhere on the page is not a request to be sent back to the trigger; it is
 * a request to be somewhere else, and stealing focus back would undo it.
 *
 * `set` must be a state setter or another stable function, since the effect
 * resubscribes whenever it changes identity.
 */
export function useDismiss(
  open: boolean,
  ref: React.RefObject<HTMLElement | null>,
  set: (v: boolean) => void,
  trigger?: React.RefObject<HTMLElement | null>
) {
  useEffect(() => {
    if (!open) return;
    const inside = () =>
      !!ref.current && ref.current.contains(document.activeElement);
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) set(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      /* Only the innermost open thing should react, and only when the reader
         is actually in it. */
      if (!inside()) return;
      e.stopPropagation();
      set(false);
      trigger?.current?.focus();
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open, ref, set, trigger]);
}
