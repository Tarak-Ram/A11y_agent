'use client';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { Score } from '@/components/score';
import { Button } from '@/components/ui/button';
import { Chip, SeverityBadge } from '@/components/ui/badge';
import { Drawer } from '@/components/ui/drawer';
import { Field, Select } from '@/components/ui/field';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import type { Finding, FindingDetail, Run } from '@/lib/types';
import { PERSONA_LABELS, SEVERITIES, fileUrl } from '@/lib/utils';

type Row = Finding & { persona: string };
const SEV_ORDER = Object.fromEntries(SEVERITIES.map((s, i) => [s, i]));

export function ReportView({ runId }: { runId: string }) {
  const { data: run, error, loading } = useLoad<Run>(`/runs/${runId}`);
  const [sev, setSev] = useState('');
  const [rule, setRule] = useState('');
  const [persona, setPersona] = useState('');
  const [evidence, setEvidence] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const lastTrigger = useRef<HTMLElement | null>(null);

  const rows: Row[] = useMemo(() => (run?.personaRuns ?? []).flatMap((p) => p.findings.map((f) => ({ ...f, persona: p.personaType }))).sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]), [run]);
  const rules = useMemo(() => [...new Set(rows.map((r) => r.axeRuleId ?? r.wcagRule))].sort(), [rows]);
  const shown = rows.filter((r) => (!sev || r.severity === sev) && (!rule || (r.axeRuleId ?? r.wcagRule) === rule) && (!persona || r.persona === persona) && (!evidence || (evidence === 'axe' ? r.confirmedByAxe : !r.confirmedByAxe)));

  if (loading) return <p role="status">Loading report…</p>;
  if (error || !run) return <p role="alert" className="text-danger">{error ?? 'Report not found'}</p>;

  return (
    <>
      <h1 className="text-3xl font-extrabold">Accessibility report</h1>
      <p className="mt-1 text-muted">
        {run.project.url}: {run.task.name} ({new Date(run.startedAt).toLocaleString()})
      </p>

      <section aria-labelledby="scores" className="mt-6">
        <h2 id="scores" className="text-2xl font-bold">
          Scores
        </h2>
        <div className="mt-3 flex flex-wrap gap-8">
          <div>
            <p className="font-semibold">Overall</p>
            <Score score={run.overallScore} large />
          </div>
          <ul className="grid flex-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {run.personaRuns.map((p) => (
              <li key={p.id} className="rounded-lg border-2 border-border p-3">
                <p className="font-semibold">{PERSONA_LABELS[p.personaType] ?? p.personaType}</p>
                <Score score={p.score} />
                <p className="mt-1 text-sm text-muted">{p.status === 'failed' ? 'Run failed' : p.success ? 'Completed the task' : 'Could not complete the task'}</p>
                {p.summary && <p className="mt-1 text-sm">{p.summary}</p>}
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-4">
          {run.summary.findings} findings: {run.summary.critical} critical, {run.summary.serious} serious, {run.summary.moderate} moderate, {run.summary.minor} minor.
        </p>
      </section>

      <section aria-labelledby="findings" className="mt-10">
        <h2 id="findings" className="text-2xl font-bold">
          Findings
        </h2>
        <form className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filter findings" onSubmit={(e) => e.preventDefault()}>
          <Field id="f-sev" label="Severity">
            {(p) => (
              <Select {...p} value={sev} onChange={(e) => setSev(e.target.value)}>
                <option value="">All</option>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="f-rule" label="Rule">
            {(p) => (
              <Select {...p} value={rule} onChange={(e) => setRule(e.target.value)}>
                <option value="">All</option>
                {rules.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="f-persona" label="Persona">
            {(p) => (
              <Select {...p} value={persona} onChange={(e) => setPersona(e.target.value)}>
                <option value="">All</option>
                {run.personaRuns.map((r) => (
                  <option key={r.personaType} value={r.personaType}>
                    {PERSONA_LABELS[r.personaType] ?? r.personaType}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="f-ev" label="Evidence">
            {(p) => (
              <Select {...p} value={evidence} onChange={(e) => setEvidence(e.target.value)}>
                <option value="">All</option>
                <option value="axe">Confirmed by axe</option>
                <option value="agent">Agent-only (video proof)</option>
              </Select>
            )}
          </Field>
        </form>
        <p role="status" aria-live="polite" className="mt-3 font-medium">
          Showing {shown.length} of {rows.length} findings.
        </p>

        <div className="relative mt-2 overflow-x-auto">
          <table className="w-full min-w-[48rem] border-collapse text-left">
            <caption className="sr-only">Accessibility findings, most severe first</caption>
            <thead>
              <tr className="border-b-2 border-border">
                <th scope="col" className="p-2">Severity</th>
                <th scope="col" className="p-2">Persona</th>
                <th scope="col" className="p-2">Rule</th>
                <th scope="col" className="p-2">Problem</th>
                <th scope="col" className="p-2">Evidence</th>
                <th scope="col" className="p-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((f) => (
                <tr key={f.id} className="border-b border-border align-top">
                  <td className="p-2"><SeverityBadge severity={f.severity} /></td>
                  <td className="p-2">{PERSONA_LABELS[f.persona] ?? f.persona}</td>
                  <td className="p-2 font-mono text-sm">{f.axeRuleId ?? f.wcagRule}<span className="block text-muted">WCAG {f.wcagRule}</span></td>
                  <td className="max-w-md p-2">{f.description}</td>
                  <td className="p-2">{f.confirmedByAxe ? <Chip tone="ok">Confirmed by axe</Chip> : <Chip tone="warn">Agent-only</Chip>}</td>
                  <td className="p-2">
                    <Button
                      variant="outline"
                      onClick={(e) => {
                        lastTrigger.current = e.currentTarget;
                        setOpenId(f.id);
                      }}
                    >
                      Details<span className="sr-only">: {f.description.slice(0, 60)}</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <FindingDrawer id={openId} onClose={() => setOpenId(null)} returnFocusTo={lastTrigger} projectHasRepo={Boolean(run.project.repoFullName)} />
    </>
  );
}

function FindingDrawer({ id, onClose, projectHasRepo, returnFocusTo }: { id: string | null; onClose: () => void; projectHasRepo: boolean; returnFocusTo: React.RefObject<HTMLElement | null> }) {
  const { data: f, error, loading, reload } = useLoad<FindingDetail>(id ? `/findings/${id}` : null);
  const [busy, setBusy] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);

  async function generate() {
    if (!id) return;
    setBusy(true);
    setFixError(null);
    try {
      await api(`/findings/${id}/fix`, { method: 'POST' });
      await reload();
    } catch (e) {
      setFixError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open={Boolean(id)} onOpenChange={(o) => !o && onClose()} returnFocusTo={returnFocusTo} title={f?.explanation.title ?? 'Finding details'}>
      {loading && <p role="status">Loading…</p>}
      {error && <p role="alert" className="text-danger">{error}</p>}
      {f && (
        <>
          <div className="flex flex-wrap gap-2">
            <SeverityBadge severity={f.severity} />
            {f.confirmedByAxe ? <Chip tone="ok">Confirmed by axe-core</Chip> : <Chip tone="warn">Agent-only: see the video</Chip>}
            <Chip>WCAG {f.wcagRule}</Chip>
          </div>

          <section aria-labelledby="d-why">
            <h3 id="d-why" className="text-lg font-bold">What this means</h3>
            <p className="mt-1">{f.description}</p>
            <p className="mt-2">{f.explanation.why}</p>
            <h3 className="mt-4 text-lg font-bold">How to fix it</h3>
            <p className="mt-1">{f.explanation.howToFix}</p>
          </section>

          {f.selector && (
            <section aria-labelledby="d-el">
              <h3 id="d-el" className="text-lg font-bold">Element</h3>
              <p className="mt-1 break-all font-mono text-sm">{f.selector}</p>
              {f.html && <pre className="mt-2 overflow-x-auto rounded bg-surface p-3 text-sm" tabIndex={0}>{f.html}</pre>}
            </section>
          )}

          {f.screenshotUrl && (
            <section aria-labelledby="d-shot">
              <h3 id="d-shot" className="text-lg font-bold">Screenshot</h3>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileUrl(f.screenshotUrl)} alt={`Screenshot of the page where the ${PERSONA_LABELS[f.personaRun.personaType] ?? 'agent'} persona hit this problem`} className="mt-2 w-full rounded border-2 border-border" />
            </section>
          )}

          {f.personaRun.videoUrl && (
            <section aria-labelledby="d-video">
              <h3 id="d-video" className="text-lg font-bold">Video of the whole session</h3>
              <video controls preload="metadata" src={fileUrl(f.personaRun.videoUrl)} className="mt-2 w-full rounded border-2 border-border" aria-label="Recording of the persona's browser session">
                Your browser cannot play this video.
              </video>
              <p className="mt-1 text-sm text-muted">The recording has no audio. Use the controls to pause and step through.</p>
            </section>
          )}

          <section aria-labelledby="d-fix">
            <h3 id="d-fix" className="text-lg font-bold">Fix</h3>
            {f.fixes.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {f.fixes.map((x) => (
                  <li key={x.id}>
                    <Link className="font-semibold underline" href={`/fixes/${x.id}`}>Review fix for {x.filePath}</Link> ({x.status.replace('_', ' ')})
                  </li>
                ))}
              </ul>
            ) : projectHasRepo ? (
              <>
                <p className="mt-1 text-muted">Gemini proposes the smallest change in your repository. Nothing is pushed until you open a pull request.</p>
                <Button className="mt-2" onClick={generate} disabled={busy}>{busy ? 'Generating fix…' : 'Generate fix'}</Button>
              </>
            ) : (
              <p className="mt-1 text-muted">Connect a GitHub repository to this project in <Link className="font-semibold underline" href="/settings">Settings</Link> to generate fixes.</p>
            )}
            <div aria-live="polite">{fixError && <p role="alert" className="mt-2 font-medium text-danger"><span className="font-bold">Error: </span>{fixError}</p>}</div>
          </section>
        </>
      )}
    </Drawer>
  );
}
