import { useCallback, useEffect, useRef, useState } from 'react';
import { useData } from './store';
import { isEditableTarget } from './utils';

export function useIsDark(): boolean {
  const theme = useData((s) => s.prefs.theme);
  const [systemDark, setSystemDark] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return theme === 'dark' || (theme === 'system' && systemDark);
}

export interface HotkeyOptions {
  /** Fire even when focus is inside an input/editor. */
  allowInInputs?: boolean;
  enabled?: boolean;
}

/**
 * Minimal hotkey hook. `combo` examples: "mod+k", "mod+\\", "c", "shift+?", "escape".
 * `mod` is ⌘ on macOS and Ctrl elsewhere.
 */
export function useHotkey(combo: string, handler: (e: KeyboardEvent) => void, opts: HotkeyOptions = {}) {
  const ref = useRef(handler);
  ref.current = handler;
  const { allowInInputs = false, enabled = true } = opts;
  useEffect(() => {
    if (!enabled) return;
    const parts = combo.toLowerCase().split('+');
    const key = parts[parts.length - 1];
    const needMod = parts.includes('mod');
    const needShift = parts.includes('shift');
    const needAlt = parts.includes('alt');
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (needMod !== mod) return;
      if (needAlt !== e.altKey) return;
      if (needShift && !e.shiftKey) return;
      const k = e.key.toLowerCase();
      const code = e.code.toLowerCase();
      const hit = k === key || code === `key${key}` || (key === '\\' && code === 'backslash') || (key === '/' && code === 'slash');
      if (!hit) return;
      if (!allowInInputs && !needMod && isEditableTarget(e.target)) return;
      ref.current(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [combo, allowInInputs, enabled]);
}

export function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastArgs = useRef<A | undefined>(undefined);
  useEffect(
    () => () => {
      // Flush on unmount so edits made right before navigating away are kept.
      if (timer.current && lastArgs.current) {
        clearTimeout(timer.current);
        fnRef.current(...lastArgs.current);
      }
    },
    [],
  );
  return useCallback(
    (...args: A) => {
      lastArgs.current = args;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = undefined;
        fnRef.current(...args);
      }, ms);
    },
    [ms],
  );
}

/** Tracks whether files are being dragged over an element and hands them over on drop. */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  return {
    over,
    bind: {
      onDragEnter: (e: React.DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current++;
        setOver(true);
      },
      onDragOver: (e: React.DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setOver(false);
      },
      onDrop: (e: React.DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(files);
      },
    },
  };
}
