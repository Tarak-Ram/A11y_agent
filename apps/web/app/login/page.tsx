import type { Metadata } from 'next';
import { LoginView } from '@/components/views/login-view';

export const metadata: Metadata = { title: 'Sign in' };
export default function Page() {
  return <LoginView />;
}
