'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Score } from '@/components/score';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/badge';
import { api, openRunStream } from '@/lib/api';
import type { Run } from '@/lib/types';
import { PERSONA_LABELS, fileUrl } from '@/lib/utils';

interface Card {
  persona: string;
  state: string;
  score: number | null;
  steps: { n: number; tool: string; result: string }[];
  shot?: { url: string; at: string };
}

const STATE_TEXT: Record<string, string> = { queued: 'Waiting to start', running: 'Running', done: 'Finished', failed: 'Failed' };

export function LiveView({ runId }: { runId: string }) {
  const [cards, setCards] = useState<Record<string, Card>>({});
  const [run, setRun] = useState<{ status: string; project?: Run['project']; task?: Run['task'] } | null>(null);
  const [announce, setAnnounce] = useState('');
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);

  useEffect(() => {
    const patch = (persona: string, f: (c: Card) => Card) => setCards((cur) => ({ ...cur, [persona]: f(cur[persona] ?? { persona, state: 'queued', score: null, steps: [] }) }));
    const es = openRunStream(runId);

    es.addEventListener('snapshot', (e) => {
      const r = JSON.parse((e as MessageEvent).data) as Run;
      setRun({ status: r.status, project: r.project, task: r.task });
      setCards(Object.fromEntries(r.personaRuns.map((p) => [p.personaType, { persona: p.personaType, state: p.status, score: p.score, steps: [] }])));
    });
    es.addEventListener('status', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      patch(d.persona, (c) => ({ ...c, state: d.state }));
    });
    es.addEventListener('step', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      patch(d.persona, (c) => ({ ...c, state: 'running', steps: [...c.steps.slice(-29), { n: d.n, tool: d.tool, result: d.result }] }));
    });
    es.addEventListener('screenshot', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      patch(d.persona, (c) => ({ ...c, shot: { url: `${fileUrl(d.url)}?t=${d.t}`, at: new Date().toLocaleTimeString() } }));
    });
    es.addEventListener('persona_done', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      patch(d.persona, (c) => ({ ...c, state: d.status, score: d.score ?? null }));
      setAnnounce(`${PERSONA_LABELS[d.persona] ?? d.persona} finished${d.score != null ? ` with a score of ${d.score}` : ''}.`);
    });
    es.addEventListener('run_done', (e) => {
      done.current = true;
      setRun((r) => ({ ...(r ?? { status: '' }), status: JSON.parse((e as MessageEvent).data).status }));
      setAnnounce('Scan complete. The report is ready.');
      es.close();
    });
    es.onerror = () => {
      // EventSource retries by itself; fall back to a one-off fetch so a finished run is never stuck.
      if (done.current) return;
      api<Run>(`/runs/${runId}`).then((r) => {
        setRun({ status: r.status, project: r.project, task: r.task });
        if (r.status !== 'running' && r.status !== 'queued') {
          done.current = true;
          es.close();
        }
      }).catch((err) => setError((err as Error).message));
    };
    return () => es.close();
  }, [runId]);

  const finished = run?.status === 'completed' || run?.status === 'failed';
  return (
    <>
      <h1 className="text-3xl font-extrabold">{finished ? 'Scan finished' : 'Scanning your site'}</h1>
      {run?.project && (
        <p className="mt-1 text-muted">
          {run.project.url}: {run.task?.name}
        </p>
      )}
      {/* One polite live region for milestones only; per-step logs below are not announced. */}
      <p role="status" aria-live="polite" className="mt-3 font-medium">
        {announce}
      </p>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {finished && (
        <Button asChild className="mt-3">
          <Link href={`/runs/${runId}/report`}>View report</Link>
        </Button>
      )}

      <ul className="mt-6 grid gap-6 lg:grid-cols-2">
        {Object.values(cards).map((c) => (
          <li key={c.persona}>
            <section aria-labelledby={`c-${c.persona}`} className="h-full rounded-lg border-2 border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id={`c-${c.persona}`} className="text-lg font-bold">
                  {PERSONA_LABELS[c.persona] ?? c.persona}
                </h2>
                <Chip tone={c.state === 'done' ? 'ok' : c.state === 'failed' ? 'warn' : 'neutral'}>{STATE_TEXT[c.state] ?? c.state}</Chip>
              </div>
              {c.persona === 'blind' ? (
                <p className="mt-3 rounded bg-surface p-3 text-muted">This persona browses without sight, so there is no picture. Its steps are listed below.</p>
              ) : c.shot ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.shot.url} alt={`Latest view seen by the ${PERSONA_LABELS[c.persona] ?? c.persona} agent, captured at ${c.shot.at}`} className="mt-3 max-h-72 w-full rounded border-2 border-border object-contain object-top" />
              ) : (
                <p className="mt-3 rounded bg-surface p-3 text-muted">Waiting for the first screenshot…</p>
              )}
              {c.score !== null && (
                <p className="mt-3">
                  <Score score={c.score} />
                </p>
              )}
              <h3 className="mt-4 font-semibold">Steps</h3>
              {c.steps.length === 0 ? (
                <p className="text-muted">No steps yet.</p>
              ) : (
                <ol className="mt-1 max-h-48 space-y-1 overflow-y-auto text-sm" tabIndex={0} aria-label={`${PERSONA_LABELS[c.persona] ?? c.persona} step log`}>
                  {c.steps.map((s) => (
                    <li key={s.n}>
                      <span className="font-mono font-semibold">{s.tool}</span>: {s.result.slice(0, 140)}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </li>
        ))}
      </ul>
    </>
  );
}
