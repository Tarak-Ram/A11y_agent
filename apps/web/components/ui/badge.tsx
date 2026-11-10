import { cn } from '@/lib/utils';

const SEVERITY_STYLE: Record<string, string> = {
  critical: 'bg-danger-bg text-danger border-danger',
  serious: 'bg-warn-bg text-warn border-warn',
  moderate: 'bg-surface text-fg border-border',
  minor: 'bg-surface text-muted border-border',
};

/** Severity is always spelled out; colour is only reinforcement (1.4.1). */
export function SeverityBadge({ severity }: { severity: string }) {
  return <span className={cn('inline-block rounded border px-2 py-0.5 text-sm font-semibold capitalize', SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.moderate)}>{severity}</span>;
}

export function Chip({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'ok' | 'warn' }) {
  const t = { neutral: 'bg-surface text-fg border-border', ok: 'bg-ok-bg text-ok border-ok', warn: 'bg-warn-bg text-warn border-warn' }[tone];
  return <span className={cn('inline-block rounded border px-2 py-0.5 text-sm font-medium', t)}>{children}</span>;
}
