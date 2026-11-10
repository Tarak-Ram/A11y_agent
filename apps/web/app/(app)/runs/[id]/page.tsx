import type { Metadata } from 'next';
import { LiveView } from '@/components/views/live-view';

export const metadata: Metadata = { title: 'Live scan' };
export default function Page({ params }: { params: { id: string } }) {
  return <LiveView runId={params.id} />;
}
