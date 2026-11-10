// Zero-dependency (Node 18+). Starts a run with an API key, waits, writes a summary, and fails on severity.
import { appendFileSync } from 'node:fs';

const env = (k, d) => process.env[k] || d;
const API = env('A11Y_API_URL').replace(/\/$/, '');
const KEY = env('A11Y_API_KEY');
const URL_ = env('A11Y_URL');
const FAIL_ON = env('A11Y_FAIL_ON', 'critical').toLowerCase();
const ORDER = ['critical', 'serious', 'moderate', 'minor'];

if (!KEY) bail('api-key is required');
if (!URL_) bail('url is required');
if (FAIL_ON !== 'none' && !ORDER.includes(FAIL_ON)) bail(`fail-on must be one of ${[...ORDER, 'none'].join(', ')}`);
console.log(`::add-mask::${KEY}`);

function bail(msg, code = 2) {
  console.error(`::error::${msg}`);
  process.exit(code);
}
function out(k, v) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
}
async function call(path, init = {}) {
  const res = await fetch(API + path, { ...init, headers: { 'content-type': 'application/json', 'x-api-key': KEY } });
  if (!res.ok) bail(`${init.method ?? 'GET'} ${path} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const personas = env('A11Y_PERSONAS', 'blind').split(',').map((s) => s.trim()).filter(Boolean);
const run = await call('/runs', { method: 'POST', body: JSON.stringify({ url: URL_, goal: env('A11Y_GOAL') || undefined, personas }) });
console.log(`Started run ${run.id} (${personas.join(', ')})`);

const deadline = Date.now() + Number(env('A11Y_TIMEOUT_MIN', '10')) * 60_000;
let r;
do {
  await new Promise((s) => setTimeout(s, 5000));
  r = await call(`/runs/${run.id}`);
} while (r.status === 'running' && Date.now() < deadline);

if (r.status === 'running') bail(`Scan did not finish within ${env('A11Y_TIMEOUT_MIN', '10')} minutes`);
if (r.status === 'failed') bail('Scan failed to run (all personas errored). Not treating this as a pass.');

const webUrl = (env('A11Y_WEB_URL') || API.replace('://api.', '://app.')).replace(/\/$/, '');
const reportUrl = `${webUrl}/runs/${r.id}/report`;
const s = r.summary;
out('run-id', r.id);
out('score', r.overallScore ?? '');
out('critical', s.critical);
out('report-url', reportUrl);

const lines = [
  `## A11yAgents scan: ${URL_}`,
  `**Overall score:** ${r.overallScore ?? 'n/a'} / 100  |  **Findings:** ${s.findings} (${s.critical} critical, ${s.serious} serious, ${s.moderate} moderate, ${s.minor} minor)`,
  '',
  '| Persona | Score | Task |',
  '|---|---|---|',
  ...r.personaRuns.map((p) => `| ${p.personaType} | ${p.score ?? 'n/a'} | ${p.status === 'failed' ? 'run failed' : p.success ? 'completed' : 'not completed'} |`),
  '',
  `[Open full report](${reportUrl})`,
];
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
console.log(lines.join('\n'));

// Surface the worst findings as annotations.
for (const f of r.personaRuns.flatMap((p) => p.findings.map((x) => ({ ...x, persona: p.personaType }))).filter((f) => f.severity === 'critical').slice(0, 10)) {
  console.log(`::error title=${f.axeRuleId ?? f.wcagRule} (${f.persona})::${f.description.replace(/\r?\n/g, ' ')} [${f.selector}]`);
}

if (FAIL_ON !== 'none') {
  const limit = ORDER.indexOf(FAIL_ON);
  const blocking = ORDER.slice(0, limit + 1).reduce((n, sev) => n + (s[sev] ?? 0), 0);
  if (blocking > 0) bail(`${blocking} finding(s) at "${FAIL_ON}" or worse. See ${reportUrl}`, 1);
}
console.log('No blocking findings.');
