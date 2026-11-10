'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';

/** Landing-page "scan your site free": carries the URL through sign-in into the wizard. */
export function ScanForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const raw = String(new FormData(e.currentTarget).get('url') ?? '').trim();
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const u = new URL(url);
      if (!u.hostname.includes('.') && u.hostname !== 'localhost') throw new Error('bad host');
    } catch {
      setError('Enter a full website address, for example https://example.com');
      return;
    }
    setError(null);
    const target = `/projects/new?url=${encodeURIComponent(url)}`;
    router.push(target); // the signed-in area redirects to /login (and back) when there is no session
  }

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-xl space-y-4" aria-label="Scan your site">
      <Field id="scan-url" label="Your website address" hint="We will open it in a real browser as six different users." error={error}>
        {(p) => <Input {...p} name="url" type="text" inputMode="url" autoComplete="url" placeholder="https://example.com" />}
      </Field>
      <Button type="submit">Scan your site free</Button>
    </form>
  );
}
