export interface Finding {
  id: string;
  personaRunId: string;
  wcagRule: string;
  severity: 'critical' | 'serious' | 'moderate' | 'minor';
  selector: string;
  description: string;
  screenshotUrl: string | null;
  confirmedByAxe: boolean;
  axeRuleId: string | null;
  source: string;
  html: string | null;
}
export interface PersonaRun {
  id: string;
  personaType: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  success: boolean | null;
  score: number | null;
  videoUrl: string | null;
  summary: string | null;
  stoppedReason: string | null;
  findings: Finding[];
}
export interface Run {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  overallScore: number | null;
  summary: { findings: number; critical: number; serious: number; moderate: number; minor: number };
  personaRuns: PersonaRun[];
  task: { name: string; goal: string };
  project: { id: string; name: string; url: string; repoFullName: string | null };
}
export interface Project {
  id: string;
  name: string;
  url: string;
  repoFullName: string | null;
  tasks: { id: string; name: string; goal: string }[];
  latestRun: { id: string; status: string; startedAt: string; scores: { personaType: string; score: number | null; status: string }[] } | null;
}
export interface Explanation {
  title: string;
  why: string;
  howToFix: string;
}
export interface FixRecord {
  id: string;
  findingId: string;
  filePath: string;
  diff: string;
  status: 'proposed' | 'pr_open' | 'merged' | 'closed' | 'failed';
  prUrl: string | null;
  explanation: string | null;
  finding?: Finding;
}
export interface FindingDetail extends Finding {
  explanation: Explanation;
  evidence: 'confirmed-by-axe' | 'agent-only';
  fixes: FixRecord[];
  personaRun: { personaType: string; videoUrl: string | null; runId: string };
}
export interface Me {
  id: string;
  email: string;
  name: string | null;
  slackWebhookUrl: string | null;
  alertEmail: string | null;
  githubConnected: boolean;
  hasApiKey: boolean;
}
