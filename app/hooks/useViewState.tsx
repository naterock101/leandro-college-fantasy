"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

/**
 * `useState` that survives its component being unmounted and mounted again.
 *
 * This exists because of something the component split would otherwise have
 * taken away quietly. When the whole page was one component, every control's
 * state lived in it: expand your row on the leaderboard, look at All teams,
 * come back, and your row was still open, your week was still selected and the
 * team you had typed into the search box was still typed. Sections are their
 * own components now, so switching tabs unmounts them, and all of that would
 * have reset - a regression nobody would have written down, arrived at by
 * tidying up.
 *
 * The store is a ref on the shell rather than a module-level map, so it lives
 * exactly as long as the page does: a reload starts clean, and two renders in
 * a test do not leak into each other.
 *
 * Deliberately not `sessionStorage`. Nothing here is worth restoring after a
 * reload - a stale search term reappearing in an empty-looking table is worse
 * than an empty box - and this way there is nothing to serialise, nothing to
 * version, and nothing to fail in a private window.
 */
const Store = createContext<Map<string, unknown> | null>(null);

export function ViewState({ children }: { children: React.ReactNode }) {
  const store = useRef(new Map<string, unknown>());
  return <Store.Provider value={store.current}>{children}</Store.Provider>;
}

export function useViewState<T>(key: string, initial: T) {
  const store = useContext(Store);
  const [value, setValue] = useState<T>(() =>
    store && store.has(key) ? (store.get(key) as T) : initial
  );
  const set = useCallback(
    (next: T | ((prev: T) => T)) =>
      setValue((prev) => {
        const v = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        store?.set(key, v);
        return v;
      }),
    [store, key]
  );
  return [value, set] as const;
}
