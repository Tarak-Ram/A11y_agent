import type { Metadata } from 'next';
import { GithubConnectView } from '@/components/views/github-connect-view';

export const metadata: Metadata = { title: 'Connecting GitHub' };
export default function Page() {
  return <GithubConnectView />;
}
