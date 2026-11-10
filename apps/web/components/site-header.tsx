'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/projects/new', label: 'New scan' },
  { href: '/settings', label: 'Settings' },
];

export function SiteHeader() {
  const path = usePathname();
  const router = useRouter();
  const signedIn = useSession(path).status === 'in';

  return (
    <header className="border-b-2 border-border">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="text-xl font-extrabold">
          A11yAgents
        </Link>
        <nav aria-label="Main" className="flex flex-wrap items-center gap-1">
          {signedIn ? (
            <>
              {LINKS.map((l) => (
                <Link key={l.href} href={l.href} aria-current={path === l.href || path.startsWith(l.href + '/') ? 'page' : undefined} className={cn('inline-flex min-h-11 items-center rounded-md px-3 font-medium hover:bg-surface', path.startsWith(l.href) && 'underline decoration-2 underline-offset-4')}>
                  {l.label}
                </Link>
              ))}
              <button
                type="button"
                className="min-h-11 rounded-md px-3 font-medium hover:bg-surface"
                onClick={async () => {
                  await api('/auth/logout', { method: 'POST', quiet: true }).catch(() => undefined);
                  router.push('/');
                  router.refresh();
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <Link href="/login" className="inline-flex min-h-11 items-center rounded-md px-3 font-medium hover:bg-surface">
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
