import { useState } from 'react';

/**
 * A small per-device preference (a list's view, its sort), kept in localStorage. There is no
 * account-wide column for these, so they are remembered on this device only. Reading or writing
 * storage can fail (private mode); the setting then simply lasts for this visit.
 */
export function useDeviceSetting<T extends string>(key: string, initial: T, valid: (v: string) => v is T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored && valid(stored) ? stored : initial;
    } catch {
      return initial;
    }
  });
  const set = (v: T) => {
    setValue(v);
    try { window.localStorage.setItem(key, v); } catch { /* not persisted */ }
  };
  return [value, set] as const;
}
