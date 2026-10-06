import { useSyncExternalStore } from 'react';
import { getSession, refreshSession, subscribeSession } from './api';

/** The signed-in player: undefined while the session is read, null when signed out of wiki-masters. */
export function useSession() {
  return useSyncExternalStore(subscribeSession, getSession);
}

/** On load: the wiki-masters session (read by the extension's background) signs the player in. */
export function bootstrapSession() {
  void refreshSession();
}
