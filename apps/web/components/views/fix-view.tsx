'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import type { FixRecord } from '@/lib/types';

const STATUS: Record<string, string> = { proposed: 'Proposed, not yet sent to GitHub', pr_open: 'Pull request open', merged: 'Merged', closed: 'Closed without merging', failed: 'Failed' };

/** Each line carries a visible +/- marker, so the diff does not depend on colour (1.4.1). */
function DiffView({ diff }: { diff: string }) {
  const lines = diff.split('\n').filter((l) => !l.startsWith('===') && !l.startsWith('Index:'));
  return (
    <pre className="overflow-x-auto rounded border-2 border-border bg-surface p-3 text-sm" tabIndex={0} aria-label="Code changes">
      {lines.map((l, i) => {
        const kind = l.startsWith('+') && !l.startsWith('+++') ? 'added' : l.startsWith('-') && !l.startsWith('---') ? 'removed' : 'context';
        return (
          <span key={i} className={`block px-1 ${kind === 'added' ? 'bg-ok-bg text-ok' : kind === 'removed' ? 'bg-danger-bg text-danger' : ''}`}>
            {kind === 'added' && <span className="sr-only">Added: </span>}
            {kind === 'removed' && <span className="sr-only">Removed: </span>}
            {l || ' '}
          </span>
        );
      })}
    </pre>
  );
}

export function FixView({ fixId }: { fixId: string }) {
  const { data: fix, error, loading, setData, reload } = useLoad<FixRecord>(`/fixes/${fixId}`);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function openPr() {
    setBusy(true);
    setActionError(null);
    try {
      setData({ ...(fix as FixRecord), ...(await api<Partial<FixRecord>>(`/fixes/${fixId}/pr`, { method: 'POST' })) });
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p role="status">Loading fix…</p>;
  if (error || !fix) return <p role="alert" className="text-danger">{error ?? 'Fix not found'}</p>;

  return (
    <>
      <h1 className="text-3xl font-extrabold">Review fix</h1>
      <p className="mt-2">
        <Chip tone={fix.status === 'pr_open' || fix.status === 'merged' ? 'ok' : fix.status === 'failed' ? 'warn' : 'neutral'}>{STATUS[fix.status] ?? fix.status}</Chip>
      </p>

      <section aria-labelledby="fx-what" className="mt-6">
        <h2 id="fx-what" className="text-2xl font-bold">What changes</h2>
        <p className="mt-1">{fix.explanation}</p>
        <p className="mt-1 text-muted">File: <span className="font-mono">{fix.filePath}</span></p>
      </section>

      <section aria-labelledby="fx-diff" className="mt-6">
        <h2 id="fx-diff" className="text-2xl font-bold">Diff</h2>
        <div className="mt-2"><DiffView diff={fix.diff} /></div>
      </section>

      <section aria-labelledby="fx-pr" className="mt-6">
        <h2 id="fx-pr" className="text-2xl font-bold">Pull request</h2>
        {fix.status === 'proposed' && (
          <>
            <p className="mt-1 text-muted">This creates a branch and a pull request in your repository. It is never merged automatically.</p>
            <Button className="mt-3" onClick={openPr} disabled={busy}>{busy ? 'Opening pull request…' : 'Open pull request'}</Button>
          </>
        )}
        {fix.prUrl && (
          <p className="mt-2">
            <a href={fix.prUrl} className="font-semibold underline" target="_blank" rel="noreferrer">
              View pull request on GitHub<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </p>
        )}
        {fix.status === 'pr_open' && <Button variant="outline" className="mt-3" onClick={() => void reload()}>Refresh status</Button>}
        <div aria-live="polite">{actionError && <p role="alert" className="mt-3 font-medium text-danger"><span className="font-bold">Error: </span>{actionError}</p>}</div>
      </section>
    </>
  );
}
