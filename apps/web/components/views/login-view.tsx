'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { API_URL, api, safeNext } from '@/lib/api';

function Inner() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const devLogin = process.env.NEXT_PUBLIC_DEV_LOGIN === '1';

  // The OAuth callback lands on /auth/callback; remember where to go afterwards.
  const oauth = (p: 'google' | 'github') => {
    try {
      sessionStorage.setItem('a11y_next', next);
    } catch {
      /* ignore */
    }
    window.location.assign(`${API_URL}/auth/${p}`);
  };

  async function onDev(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/dev-login', { method: 'POST', json: { email: String(new FormData(e.currentTarget).get('email')) }, quiet: true });
      router.push(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md space-y-6">
      <h1 className="text-3xl font-extrabold">Sign in</h1>
      <div className="flex flex-col gap-3">
        <Button type="button" variant="outline" onClick={() => oauth('google')}>
          Continue with Google
        </Button>
        <Button type="button" variant="outline" onClick={() => oauth('github')}>
          Continue with GitHub
        </Button>
      </div>
      {devLogin && (
        <form onSubmit={onDev} className="space-y-4 border-t-2 border-border pt-6" aria-label="Development sign in">
          <h2 className="text-xl font-bold">Development sign in</h2>
          <Field id="dev-email" label="Email" error={error}>
            {(p) => <Input {...p} name="email" type="email" required autoComplete="email" />}
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      )}
    </div>
  );
}

export function LoginView() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <Inner />
    </Suspense>
  );
}
