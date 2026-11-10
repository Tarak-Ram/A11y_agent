'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { safeNext } from '@/lib/api';

/** The API has already set the httpOnly session cookie; just return to where the user was heading. */
export default function Callback() {
  const router = useRouter();
  useEffect(() => {
    let next: string | null = null;
    try {
      next = sessionStorage.getItem('a11y_next');
      sessionStorage.removeItem('a11y_next');
    } catch {
      /* ignore */
    }
    router.replace(safeNext(next));
  }, [router]);
  return (
    <p role="status" aria-live="polite">
      Signing you in…
    </p>
  );
}
