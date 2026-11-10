'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { api } from '@/lib/api';
import { useFocusOnChange } from '@/lib/hooks';
import { PERSONA_DESCRIPTIONS, PERSONA_LABELS } from '@/lib/utils';

type Task = { name: string; goal: string };
const STEPS = ['Website', 'Task', 'Personas', 'Review'] as const;

function Wizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [url, setUrl] = useState(useSearchParams().get('url') ?? '');
  const [suggested, setSuggested] = useState<Task[]>([]);
  const [taskIdx, setTaskIdx] = useState<number | 'custom'>(0);
  const [custom, setCustom] = useState<Task>({ name: '', goal: '' });
  const [personas, setPersonas] = useState<string[]>(['blind', 'low_vision', 'motor_tremor']);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const headingRef = useFocusOnChange<HTMLHeadingElement>(step);

  const task: Task | null = taskIdx === 'custom' ? (custom.name && custom.goal ? custom : null) : suggested[taskIdx] ?? null;

  async function toTasks() {
    setBusy(true);
    setError(null);
    try {
      const { tasks } = await api<{ tasks: Task[] }>('/projects/suggest-tasks', { method: 'POST', json: { url } });
      setSuggested(tasks);
      setTaskIdx(0);
      setStep(1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (!task) return;
    setBusy(true);
    setError(null);
    try {
      const project = await api<{ id: string }>('/projects', { method: 'POST', json: { url } });
      const t = await api<{ id: string }>(`/projects/${project.id}/tasks`, { method: 'POST', json: task });
      const run = await api<{ id: string }>('/runs', { method: 'POST', json: { projectId: project.id, taskId: t.id, personas } });
      router.push(`/runs/${run.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const toggle = (p: string) => setPersonas((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-extrabold">New scan</h1>
      <ol className="mt-4 flex flex-wrap gap-x-6 gap-y-1" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? 'step' : undefined} className={i === step ? 'font-bold underline decoration-2 underline-offset-4' : 'text-muted'}>
            {i + 1}. {s}
            {i < step && <span className="sr-only"> (done)</span>}
          </li>
        ))}
      </ol>

      <h2 ref={headingRef} tabIndex={-1} className="mt-6 text-2xl font-bold focus:outline-none">
        {['Which website?', 'What should the testers try to do?', 'Who should test it?', 'Ready to scan'][step]}
      </h2>

      <div aria-live="polite" className="min-h-6">
        {error && (
          <p role="alert" className="mt-2 font-medium text-danger">
            <span className="font-bold">Error: </span>
            {error}
          </p>
        )}
      </div>

      {step === 0 && (
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void toTasks();
          }}
        >
          <Field id="wiz-url" label="Website address" hint="Must be reachable from the internet.">
            {(p) => <Input {...p} type="url" required value={url} onChange={(e) => setUrl(e.target.value)} autoComplete="url" placeholder="https://example.com" />}
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? 'Reading your homepage…' : 'Suggest tasks'}
          </Button>
        </form>
      )}

      {step === 1 && (
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (task) setStep(2);
          }}
        >
          <fieldset className="space-y-3">
            <legend className="font-semibold">Pick one task (suggested from your homepage)</legend>
            {suggested.map((t, i) => (
              <label key={t.name} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border-2 border-border p-3">
                <input type="radio" name="task" className="mt-1.5 h-5 w-5" checked={taskIdx === i} onChange={() => setTaskIdx(i)} />
                <span>
                  <span className="block font-semibold">{t.name}</span>
                  <span className="block text-muted">{t.goal}</span>
                </span>
              </label>
            ))}
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border-2 border-border p-3">
              <input type="radio" name="task" className="h-5 w-5" checked={taskIdx === 'custom'} onChange={() => setTaskIdx('custom')} />
              <span className="font-semibold">Write my own</span>
            </label>
          </fieldset>
          {taskIdx === 'custom' && (
            <div className="space-y-4">
              <Field id="ct-name" label="Task name">
                {(p) => <Input {...p} value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} required maxLength={100} />}
              </Field>
              <Field id="ct-goal" label="What should the tester do?" hint="For example: add a pair of shoes to the cart and reach the payment step.">
                {(p) => <Input {...p} value={custom.goal} onChange={(e) => setCustom({ ...custom, goal: e.target.value })} required maxLength={1000} />}
              </Field>
            </div>
          )}
          <div className="flex gap-3">
            <Button type="button" variant="outline" onClick={() => setStep(0)}>
              Back
            </Button>
            <Button type="submit" disabled={!task}>
              Next
            </Button>
          </div>
        </form>
      )}

      {step === 2 && (
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (personas.length) setStep(3);
          }}
        >
          <fieldset className="space-y-3">
            <legend className="font-semibold">Choose at least one</legend>
            {Object.keys(PERSONA_LABELS).map((p) => (
              <label key={p} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border-2 border-border p-3">
                <input type="checkbox" className="mt-1.5 h-5 w-5" checked={personas.includes(p)} onChange={() => toggle(p)} />
                <span>
                  <span className="block font-semibold">{PERSONA_LABELS[p]}</span>
                  <span className="block text-muted">{PERSONA_DESCRIPTIONS[p]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="flex gap-3">
            <Button type="button" variant="outline" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button type="submit" disabled={!personas.length}>
              Next
            </Button>
          </div>
        </form>
      )}

      {step === 3 && (
        <div className="mt-4 space-y-4">
          <dl className="space-y-2">
            <div>
              <dt className="font-semibold">Website</dt>
              <dd>{url}</dd>
            </div>
            <div>
              <dt className="font-semibold">Task</dt>
              <dd>{task?.name}: {task?.goal}</dd>
            </div>
            <div>
              <dt className="font-semibold">Personas</dt>
              <dd>{personas.map((p) => PERSONA_LABELS[p]).join(', ')}</dd>
            </div>
          </dl>
          <div className="flex gap-3">
            <Button type="button" variant="outline" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button type="button" onClick={start} disabled={busy}>
              {busy ? 'Starting…' : 'Run scan'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function WizardView() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <Wizard />
    </Suspense>
  );
}
