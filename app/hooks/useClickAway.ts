import { useEffect } from "react";

/**
 * Closes an open thing when the pointer goes somewhere else.
 *
 * `set` must be a state setter or another stable function, since the effect
 * resubscribes whenever it changes identity.
 */
export function useClickAway(
  open: boolean,
  ref: React.RefObject<HTMLElement | null>,
  set: (v: boolean) => void
) {
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) set(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open, ref, set]);
}
