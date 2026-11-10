import type { Metadata } from 'next';
import { FixView } from '@/components/views/fix-view';

export const metadata: Metadata = { title: 'Review fix' };
export default function Page({ params }: { params: { id: string } }) {
  return <FixView fixId={params.id} />;
}
