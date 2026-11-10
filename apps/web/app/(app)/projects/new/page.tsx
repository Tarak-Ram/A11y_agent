import type { Metadata } from 'next';
import { WizardView } from '@/components/views/wizard-view';

export const metadata: Metadata = { title: 'New scan' };
export default function Page() {
  return <WizardView />;
}
