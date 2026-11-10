import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const PERSONA_LABELS: Record<string, string> = {
  blind: 'Blind (screen reader)',
  low_vision: 'Low vision',
  color_blind: 'Colour blind',
  motor_tremor: 'Hand tremor',
  elderly_first_time: 'Older first-time user',
  indian_language: 'Hindi / Telugu on 3G phone',
};

export const PERSONA_DESCRIPTIONS: Record<string, string> = {
  blind: 'Uses only the accessibility tree and the keyboard, like a screen-reader user.',
  low_vision: 'Sees blurred screenshots at 200% zoom.',
  color_blind: 'Sees the page through deuteranopia and protanopia filters.',
  motor_tremor: 'Every click lands up to 12px off target.',
  elderly_first_time: 'Slow and careful; gets confused by jargon and unclear steps.',
  indian_language: 'Hindi or Telugu, 360x740 phone, slow 3G.',
};

export const SEVERITIES = ['critical', 'serious', 'moderate', 'minor'] as const;

export function scoreLabel(score: number | null | undefined): string {
  if (score === null || score === undefined) return 'Not scored';
  return score >= 90 ? 'Good' : score >= 70 ? 'Needs work' : score >= 40 ? 'Poor' : 'Failing';
}

/** Make an API-served file path (dev: /files/...) absolute. */
export function fileUrl(u: string | null | undefined): string | undefined {
  if (!u) return undefined;
  return u.startsWith('/') ? `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}${u}` : u;
}
