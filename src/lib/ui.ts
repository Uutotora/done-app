import { create } from 'zustand';
import type { ID, Item } from './types';
import { uid } from './utils';

export interface Toast {
  id: string;
  message: string;
  tone?: 'default' | 'success' | 'error';
  action?: { label: string; run: () => void };
  duration?: number;
}

interface CreateItemState {
  open: boolean;
  defaults?: Partial<Item>;
}

interface LinkDialogState {
  open: boolean;
  projectId?: ID;
  parentId?: ID;
  url?: string;
}

interface UIState {
  hydrated: boolean;
  mobileSidebarOpen: boolean;
  setMobileSidebar: (open: boolean) => void;
  peekItemId?: ID;
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  createItem: CreateItemState;
  linkDialog: LinkDialogState;
  previewId?: ID;
  toasts: Toast[];
  celebrate?: { key: number; x: number; y: number };

  openPeek: (id?: ID) => void;
  setPalette: (open: boolean) => void;
  setShortcuts: (open: boolean) => void;
  openCreateItem: (defaults?: Partial<Item>) => void;
  closeCreateItem: () => void;
  openLinkDialog: (opts?: Omit<LinkDialogState, 'open'>) => void;
  closeLinkDialog: () => void;
  openPreview: (id?: ID) => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
  fireCelebrate: (x: number, y: number) => void;
}

export const useUI = create<UIState>()((set) => ({
  hydrated: false,
  mobileSidebarOpen: false,
  setMobileSidebar: (open) => set({ mobileSidebarOpen: open }),
  paletteOpen: false,
  shortcutsOpen: false,
  createItem: { open: false },
  linkDialog: { open: false },
  toasts: [],

  openPeek: (id) => set({ peekItemId: id }),
  setPalette: (open) => set({ paletteOpen: open }),
  setShortcuts: (open) => set({ shortcutsOpen: open }),
  openCreateItem: (defaults) => set({ createItem: { open: true, defaults } }),
  closeCreateItem: () => set((s) => ({ createItem: { ...s.createItem, open: false } })),
  openLinkDialog: (opts) => set({ linkDialog: { open: true, ...opts } }),
  closeLinkDialog: () => set((s) => ({ linkDialog: { ...s.linkDialog, open: false } })),
  openPreview: (id) => set({ previewId: id }),
  toast: (t) => set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id: uid('t') }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  fireCelebrate: (x, y) => set({ celebrate: { key: Date.now(), x, y } }),
}));

export const toast = (t: Omit<Toast, 'id'>) => useUI.getState().toast(t);
