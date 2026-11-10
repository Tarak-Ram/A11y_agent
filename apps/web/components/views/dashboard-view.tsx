'use client';
import Link from 'next/link';
import { Score } from '@/components/score';
import { Button } from '@/components/ui/button';
import { useLoad } from '@/lib/hooks';
import type { Project } from '@/lib/types';
import { PERSONA_LABELS } from '@/lib/utils';

export function DashboardView() {
  const { data, error, loading } = useLoad<Project[]>('/projects');
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-extrabold">Your projects</h1>
        <Button asChild>
          <Link href="/projects/new">New scan</Link>
        </Button>
      </div>
      {loading && <p role="status">Loading projects…</p>}
      {error && (
        <p role="alert" className="mt-4 text-danger">
          {error}
        </p>
      )}
      {data && data.length === 0 && (
        <p className="mt-6 text-lg">
          No projects yet. <Link href="/projects/new" className="font-semibold underline">Scan your first site</Link>.
        </p>
      )}
      <ul className="mt-6 space-y-6">
        {data?.map((p) => (
          <li key={p.id}>
            <article aria-labelledby={`p-${p.id}`} className="rounded-lg border-2 border-border p-5">
              <h2 id={`p-${p.id}`} className="text-xl font-bold">
                {p.name}
              </h2>
              <p className="text-muted">{p.url}</p>
              {p.latestRun ? (
                <>
                  <p className="mt-3">
                    Latest scan: {new Date(p.latestRun.startedAt).toLocaleString()} ({p.latestRun.status}).{' '}
                    <Link className="font-semibold underline" href={p.latestRun.status === 'running' ? `/runs/${p.latestRun.id}` : `/runs/${p.latestRun.id}/report`}>
                      {p.latestRun.status === 'running' ? 'Watch live' : 'Open report'}
                    </Link>
                  </p>
                  <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {p.latestRun.scores.map((s) => (
                      <div key={s.personaType}>
                        <dt className="font-semibold">{PERSONA_LABELS[s.personaType] ?? s.personaType}</dt>
                        <dd>{s.score !== null ? <Score score={s.score} /> : <span className="text-muted">{s.status === 'failed' ? 'Failed' : 'Running…'}</span>}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              ) : (
                <p className="mt-3 text-muted">Never scanned.</p>
              )}
            </article>
          </li>
        ))}
      </ul>
    </>
  );
}
