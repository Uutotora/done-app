import { useCallback, useState } from 'react';

/** Per-view UI settings (zoom, grouping, filters) remembered in localStorage. */
export function useViewState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const storageKey = `done:view:${key}`;
  const read = (): T => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? { ...initial, ...JSON.parse(raw) } : initial;
    } catch {
      return initial;
    }
  };
  const [state, setValue] = useState(() => ({ key: storageKey, value: read() }));
  let value = state.value;
  if (state.key !== storageKey) {
    value = read();
    setValue({ key: storageKey, value });
  }
  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev.value) : v;
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* storage may be unavailable */
        }
        return { key: storageKey, value: next };
      });
    },
    [storageKey],
  );
  return [value, set];
}
