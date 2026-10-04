'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export interface ViewerState {
  status: 'loading' | 'anonymous' | 'signed-in';
  user: { id: string; email: string; name: string | null; role: string; locale: string } | null;
  preferences: { topics: string[]; sourceIds: string[] };
  refresh: () => Promise<void>;
}

const empty = { topics: [], sourceIds: [] };
const ViewerContext = createContext<ViewerState>({
  status: 'loading',
  user: null,
  preferences: empty,
  refresh: async () => {},
});

/**
 * Pages are cached and identical for everyone; who is signed in is fetched
 * once in the browser from /api/v1/me.
 */
export function ViewerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<ViewerState, 'refresh'>>({
    status: 'loading',
    user: null,
    preferences: empty,
  });
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/me', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) {
        setState({ status: 'anonymous', user: null, preferences: empty });
        return;
      }
      const body = await response.json();
      setState({ status: 'signed-in', user: body.user, preferences: body.preferences });
    } catch {
      setState({ status: 'anonymous', user: null, preferences: empty });
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return <ViewerContext.Provider value={{ ...state, refresh }}>{children}</ViewerContext.Provider>;
}

export const useViewer = () => useContext(ViewerContext);
