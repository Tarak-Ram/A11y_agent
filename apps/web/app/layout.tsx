import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SiteHeader } from '@/components/site-header';

export const metadata: Metadata = {
  title: { default: 'A11yAgents: AI testers who use your site like people with disabilities do', template: '%s | A11yAgents' },
  description: 'AI agents browse your website as blind, low-vision, colour-blind, tremor, older and Hindi/Telugu users, then open pull requests that fix what they find.',
};
// No maximum-scale / user-scalable=no: users must be able to zoom (1.4.4).
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <SiteHeader />
        <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 focus:outline-none">
          {children}
        </main>
        <footer className="mx-auto max-w-6xl border-t-2 border-border px-4 py-6 text-muted">
          <p>A11yAgents tests against WCAG 2.2 AA. This site is held to the same standard; email us if you hit a barrier.</p>
        </footer>
      </body>
    </html>
  );
}
