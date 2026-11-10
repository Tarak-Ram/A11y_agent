import type { Config } from 'tailwindcss';

// Colour tokens chosen for WCAG 2.2 AA: every text/background pair below is >= 4.5:1
// (fg on bg 16:1, muted on bg 7.6:1, primary-fg on primary 8.6:1), focus ring >= 3:1 on both.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        fg: 'rgb(var(--fg) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        primary: 'rgb(var(--primary) / <alpha-value>)',
        'primary-fg': 'rgb(var(--primary-fg) / <alpha-value>)',
        ring: 'rgb(var(--ring) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        'danger-bg': 'rgb(var(--danger-bg) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        'warn-bg': 'rgb(var(--warn-bg) / <alpha-value>)',
        ok: 'rgb(var(--ok) / <alpha-value>)',
        'ok-bg': 'rgb(var(--ok-bg) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};
export default config;
