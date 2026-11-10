'use client';
import { useEffect, useState } from 'react';
import { api } from './api';
import type { Me } from './types';

export type Session = { status: 'loading' } | { status: 'out' } | { status: 'in'; me: Me };

/** Asks the API who we are (the cookie is invisible to scripts). Re-checks whenever `dep` changes, e.g. on navigation. */
export function useSession(dep?: unknown): Session {
  const [s, setS] = useState<Session>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    api<{ me: Me | null }>('/auth/session', { quiet: true })
      .then(({ me }) => live && setS(me ? { status: 'in', me } : { status: 'out' }))
      .catch(() => live && setS({ status: 'out' }));
    return () => {
      live = false;
    };
  }, [dep]);
  return s;
}
