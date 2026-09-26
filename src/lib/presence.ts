import { create } from 'zustand';

/** A teammate with Done open right now, and the page they are on. */
export interface Peer {
  id: string;
  name: string;
  path: string;
  at: number;
}

interface PresenceState {
  /** True while the live event stream is connected. */
  live: boolean;
  peers: Peer[];
}

export const usePresence = create<PresenceState>(() => ({ live: false, peers: [] }));

/** Sections that count as "the same page" for presence: a project, a document or a task. */
export function presenceScope(path: string): string {
  const m = /^\/(p|docs|items)\/([^/?#]+)/.exec(path);
  return m ? `${m[1]}/${m[2]}` : path;
}
