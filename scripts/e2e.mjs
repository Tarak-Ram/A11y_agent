#!/usr/bin/env node
/**
 * End-to-end: scan samples/broken-shop through the real API -> queue -> agent worker, expect >= 5 findings.
 *
 * Needs the stack running (API + Redis + Postgres + agents worker) and the sample served over HTTP:
 *   docker compose --profile samples up -d      # serves the sample at http://broken-shop:8000
 *   API_URL=http://localhost:4000 SAMPLE_URL=http://broken-shop:8000 node scripts/e2e.mjs
 * Without Docker for the worker: `python -m http.server 8099 -d samples/broken-shop` and SAMPLE_URL=http://localhost:8099/
 * Uses the dev-login endpoint (disabled when NODE_ENV=production).
 */
const API = process.env.API_URL ?? 'http://localhost:4000';
const SAMPLE = process.env.SAMPLE_URL ?? 'http://localhost:8099/';
const PERSONAS = (process.env.PERSONAS ?? 'blind').split(',');
const MIN_FINDINGS = Number(process.env.MIN_FINDINGS ?? 5);

async function j(path, init = {}, token) {
  const res = await fetch(API + path, { ...init, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

const { token } = await j('/auth/dev-login', { method: 'POST', body: JSON.stringify({ email: 'e2e@example.com' }) });
const run = await j('/runs', { method: 'POST', body: JSON.stringify({ url: SAMPLE, goal: 'Buy the shoes', personas: PERSONAS }) }, token);
console.log(`run ${run.id} queued for ${PERSONAS.join(', ')}`);

const deadline = Date.now() + 180_000;
let r;
do {
  await new Promise((s) => setTimeout(s, 2000));
  r = await j(`/runs/${run.id}`, {}, token);
} while (r.status === 'running' && Date.now() < deadline);

const fail = (m) => {
  console.error(`FAIL: ${m}`);
  process.exit(1);
};
if (r.status !== 'completed') fail(`run ended as "${r.status}"`);
console.log(`status=${r.status} overall=${r.overallScore} findings=${r.summary.findings} (${r.summary.critical} critical)`);
if (r.summary.findings < MIN_FINDINGS) fail(`expected >= ${MIN_FINDINGS} findings, got ${r.summary.findings}`);
const rules = new Set(r.personaRuns.flatMap((p) => p.findings.map((f) => f.axeRuleId)));
for (const need of ['image-alt', 'button-name', 'link-name', 'select-name']) if (!rules.has(need)) fail(`missing expected rule ${need}`);
if (!r.personaRuns.every((p) => p.videoUrl)) fail('a persona run has no video');
console.log('PASS');
