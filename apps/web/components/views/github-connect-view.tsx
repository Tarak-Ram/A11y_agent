'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api } from '@/lib/api';

function Inner() {
  const q = useSearchParams();
  const router = useRouter();
  const [msg, setMsg] = useState('Connecting GitHub…');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api(`/github/connect?installation_id=${encodeURIComponent(q.get('installation_id') ?? '')}&code=${encodeURIComponent(q.get('code') ?? '')}`, { method: 'POST' })
      .then(() => router.replace('/settings'))
      .catch((e) => {
        setFailed(true);
        setMsg((e as Error).message);
      });
  }, [q, router]);
  return <p role={failed ? 'alert' : 'status'} className={failed ? 'text-danger' : ''}>{msg}</p>;
}

/** Setup URL of the GitHub App. */
export function GithubConnectView() {
  return <Suspense fallback={<p>Loading…</p>}><Inner /></Suspense>;
}
