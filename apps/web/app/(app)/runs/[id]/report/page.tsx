import type { Metadata } from 'next';
import { ReportView } from '@/components/views/report-view';

export const metadata: Metadata = { title: 'Report' };
export default function Page({ params }: { params: { id: string } }) {
  return <ReportView runId={params.id} />;
}
