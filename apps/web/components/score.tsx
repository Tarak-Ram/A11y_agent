import { cn, scoreLabel } from '@/lib/utils';

/** Score is always shown as text ("72 of 100, Needs work"); the bar is decorative. */
export function Score({ score, large }: { score: number | null | undefined; large?: boolean }) {
  if (score === null || score === undefined) return <span className="text-muted">Not scored</span>;
  const tone = score >= 90 ? 'bg-ok' : score >= 70 ? 'bg-warn' : 'bg-danger';
  return (
    <span className="inline-flex flex-col">
      <span className={cn('font-extrabold', large ? 'text-5xl' : 'text-xl')}>
        {score}
        <span className="text-base font-medium text-muted"> of 100</span>
      </span>
      <span className="text-sm font-medium">{scoreLabel(score)}</span>
      <span aria-hidden="true" className="mt-1 block h-2 w-28 rounded bg-surface">
        <span className={cn('block h-2 rounded', tone)} style={{ width: `${score}%` }} />
      </span>
    </span>
  );
}
