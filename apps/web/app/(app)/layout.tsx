'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useSession } from '@/lib/session';

/** Everything under (app) needs a session; the API cookie decides, not client-side storage. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const session = useSession();
  useEffect(() => {
    if (session.status === 'out') router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [session.status, router, path]);
  return session.status === 'in' ? <>{children}</> : <p role="status">Checking your session…</p>;
}
