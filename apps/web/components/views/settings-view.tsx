'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import type { Me, Project } from '@/lib/types';

function Status({ msg, err }: { msg: string | null; err: string | null }) {
  return (
    <div aria-live="polite" className="min-h-6">
      {msg && <p role="status" className="font-medium text-ok">{msg}</p>}
      {err && <p role="alert" className="font-medium text-danger"><span className="font-bold">Error: </span>{err}</p>}
    </div>
  );
}

function useAction() {
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (f: () => Promise<string | void>) => {
    setMsg(null);
    setErr(null);
    try {
      setMsg((await f()) || 'Saved.');
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return { msg, err, run };
}

function GitHubSection({ me }: { me: Me }) {
  const a = useAction();
  return (
    <section aria-labelledby="s-gh" className="space-y-3">
      <h2 id="s-gh" className="text-2xl font-bold">GitHub</h2>
      <p>{me.githubConnected ? 'GitHub is connected. A11yAgents can open pull requests in repositories you granted it.' : 'Install the A11yAgents GitHub App to let us open fix pull requests. We never merge.'}</p>
      <Button variant="outline" onClick={() => a.run(async () => { const { url } = await api<{ url: string }>('/github/install-url'); window.location.assign(url); return 'Redirecting to GitHub…'; })}>
        {me.githubConnected ? 'Manage GitHub installation' : 'Connect GitHub'}
      </Button>
      <Status {...a} />
    </section>
  );
}

function RepoRow({ p }: { p: Project }) {
  const a = useAction();
  const [repo, setRepo] = useState(p.repoFullName ?? '');
  return (
    <li>
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await api(`/projects/${p.id}`, { method: 'PATCH', json: { repoFullName: repo || null } }); }); }}>
        <Field id={`repo-${p.id}`} label={`Repository for ${p.name}`} hint="Format: owner/repo">
          {(f) => <Input {...f} value={repo} onChange={(e) => setRepo(e.target.value)} pattern="[\w.\-]+/[\w.\-]+" title="owner/repo" autoComplete="off" />}
        </Field>
        <Button type="submit" variant="outline">Save repository<span className="sr-only"> for {p.name}</span></Button>
        <Status {...a} />
      </form>
    </li>
  );
}

function AlertsSection({ me }: { me: Me }) {
  const a = useAction();
  const [slack, setSlack] = useState(me.slackWebhookUrl ?? '');
  const [email, setEmail] = useState(me.alertEmail ?? '');
  return (
    <form className="space-y-4" aria-labelledby="s-al" onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await api('/me', { method: 'PATCH', json: { slackWebhookUrl: slack || undefined, alertEmail: email || undefined } }); }); }}>
      <h2 id="s-al" className="text-2xl font-bold">Alerts</h2>
      <p className="text-muted">Get notified when a scan finds critical issues.</p>
      <Field id="al-slack" label="Slack incoming-webhook URL" hint="Must start with https://">
        {(p) => <Input {...p} type="url" value={slack} onChange={(e) => setSlack(e.target.value)} autoComplete="off" />}
      </Field>
      <Field id="al-email" label="Alert email address">
        {(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />}
      </Field>
      <Button type="submit">Save alerts</Button>
      <Status {...a} />
    </form>
  );
}

function ApiKeySection({ me }: { me: Me }) {
  const a = useAction();
  const [key, setKey] = useState<string | null>(null);
  return (
    <section aria-labelledby="s-key" className="space-y-3">
      <h2 id="s-key" className="text-2xl font-bold">API key for CI</h2>
      <p className="text-muted">Use it with the <span className="font-mono">a11yagents/scan</span> GitHub Action. {me.hasApiKey ? 'You already have a key; creating a new one revokes it.' : ''}</p>
      <Button variant="outline" onClick={() => a.run(async () => { const r = await api<{ apiKey: string }>('/auth/api-key', { method: 'POST' }); setKey(r.apiKey); return 'New key created. Copy it now; it is shown only once.'; })}>
        {me.hasApiKey ? 'Replace API key' : 'Create API key'}
      </Button>
      {key && (
        <Field id="key-val" label="Your new API key">
          {(p) => <Input {...p} readOnly value={key} onFocus={(e) => e.currentTarget.select()} className="font-mono" />}
        </Field>
      )}
      <Status {...a} />
    </section>
  );
}

export function SettingsView() {
  const me = useLoad<Me>('/me');
  const projects = useLoad<Project[]>('/projects');
  if (me.loading) return <p role="status">Loading settings…</p>;
  if (me.error || !me.data) return <p role="alert" className="text-danger">{me.error}</p>;
  return (
    <div className="max-w-2xl space-y-12">
      <h1 className="text-3xl font-extrabold">Settings</h1>
      <GitHubSection me={me.data} />
      <section aria-labelledby="s-repos" className="space-y-4">
        <h2 id="s-repos" className="text-2xl font-bold">Project repositories</h2>
        {projects.data?.length ? <ul className="space-y-6">{projects.data.map((p) => <RepoRow key={p.id} p={p} />)}</ul> : <p className="text-muted">No projects yet.</p>}
      </section>
      <AlertsSection me={me.data} />
      <ApiKeySection me={me.data} />
    </div>
  );
}
