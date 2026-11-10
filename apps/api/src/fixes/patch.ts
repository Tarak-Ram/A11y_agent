import { createTwoFilesPatch } from 'diff';

export interface Edit {
  old: string;
  new: string;
}

/** Rules the fix engine can patch, with guidance for the model. */
export const RULES: Record<string, { title: string; hint: string; prefer: 'markup' | 'style' | 'any' }> = {
  'color-contrast': { title: 'Colour contrast', prefer: 'style', hint: 'Change only the color and/or background-color so text contrast is at least 4.5:1 (3:1 for large text). Keep the brand hue where possible; darken or lighten minimally. Compute the ratio, do not guess.' },
  'image-alt': { title: 'Missing alt text', prefer: 'markup', hint: 'Add an alt attribute. Describe what the image conveys from nearby context and file name; use alt="" only if clearly decorative. Never write "image of".' },
  label: { title: 'Missing form label', prefer: 'markup', hint: 'Give the field an id if missing and add a <label for="id"> with visible text (use the placeholder text as the label text). If a visible label is impossible, add aria-label.' },
  'select-name': { title: 'Missing form label', prefer: 'markup', hint: 'Give the select an id if missing and add a <label for="id"> with a short visible text. If a visible label is impossible, add aria-label.' },
  'button-name': { title: 'Empty button', prefer: 'markup', hint: 'Give the button an accessible name: visible text if the design allows, otherwise aria-label describing the action (infer it from id/class/context).' },
  'link-name': { title: 'Empty link', prefer: 'markup', hint: 'Give the link an accessible name: text, aria-label, or alt on the image inside it. Describe the destination.' },
  'html-has-lang': { title: 'Missing page language', prefer: 'markup', hint: 'Add a valid lang attribute to the <html> tag (infer the language from the page text; default "en").' },
  'document-title': { title: 'Missing page title', prefer: 'markup', hint: 'Add a short, descriptive <title> inside <head> (infer from the page heading / site name). If a <title> exists but is empty, fill it.' },
  'meta-viewport': { title: 'Zoom disabled', prefer: 'markup', hint: 'In the viewport meta tag, remove user-scalable=no and any maximum-scale below 5. Keep width=device-width, initial-scale=1.' },
  'frame-title': { title: 'Untitled frame', prefer: 'markup', hint: 'Add a title attribute to the iframe/frame that says what its content is.' },
  'input-button-name': { title: 'Unnamed input button', prefer: 'markup', hint: 'Give the <input type="button|submit|reset"> a non-empty value attribute (or aria-label) describing the action.' },
  'svg-img-alt': { title: 'SVG image without text', prefer: 'markup', hint: 'For an svg with role="img", add a <title> child or aria-label that describes it; if purely decorative, use aria-hidden="true" and remove role="img".' },
  'role-img-alt': { title: 'role=img without text', prefer: 'markup', hint: 'Add aria-label describing the element with role="img" (or aria-hidden="true" and drop the role if decorative).' },
  'scrollable-region-focusable': { title: 'Scroll area not keyboard reachable', prefer: 'markup', hint: 'Add tabindex="0" to the scrollable container (and a role/aria-label if it has none), so keyboard users can scroll it.' },
  'valid-lang': { title: 'Invalid language code', prefer: 'markup', hint: 'Replace the invalid lang attribute value with a valid BCP 47 code (e.g. "en", "hi", "te").' },
  'html-lang-valid': { title: 'Invalid page language', prefer: 'markup', hint: 'Replace the invalid lang attribute on <html> with a valid BCP 47 code (e.g. "en", "hi", "te").' },
  'autocomplete-valid': { title: 'Invalid autocomplete value', prefer: 'markup', hint: 'Replace the autocomplete attribute with a valid WCAG 1.3.5 token (e.g. email, given-name, tel, street-address, cc-number), based on the field purpose.' },
  'aria-hidden-focus': { title: 'Focusable content hidden from assistive tech', prefer: 'markup', hint: 'Either remove aria-hidden="true" from the container, or make its focusable children not focusable (tabindex="-1" / disabled). Prefer removing aria-hidden unless the content is truly off-screen.' },
  'duplicate-id-aria': { title: 'Duplicate id used by ARIA/label', prefer: 'markup', hint: 'Make the id unique (rename one) and update every for/aria-labelledby/aria-describedby that points at the renamed one.' },
  bypass: { title: 'No way to skip repeated navigation', prefer: 'markup', hint: 'Add a "Skip to main content" link as the first focusable element pointing to the main landmark id (add id="main" to <main> if needed), visible on focus.' },
  'target-size': { title: 'Click target too small', prefer: 'style', hint: 'Give the control min-width and min-height of at least 24px (44px is better) plus padding, using the smallest CSS change. Do not change the layout of unrelated elements.' },
  'link-in-text-block': { title: 'Link only distinguished by colour', prefer: 'style', hint: 'Make links inside text blocks identifiable without colour: add text-decoration: underline (or a 3:1 contrast change plus a non-colour cue).' },
  tabindex: { title: 'Focus order', prefer: 'markup', hint: 'Remove positive tabindex values and, if needed, reorder DOM elements so the tab order follows visual order. Prefer removing tabindex over reordering.' },
  'focus-order-semantics': { title: 'Focus order', prefer: 'markup', hint: 'Make the interactive element a real control (button/a) or give it a role and tabindex="0" with key handlers; fix tab order with DOM order, not positive tabindex.' },
};

const BY_SC: Record<string, string> = { '1.4.3': 'color-contrast', '1.1.1': 'image-alt', '3.1.1': 'html-has-lang', '2.4.3': 'tabindex', '3.3.2': 'label', '2.4.2': 'document-title', '2.5.8': 'target-size', '2.4.1': 'bypass', '1.3.5': 'autocomplete-valid' };

export function ruleKey(f: { axeRuleId?: string | null; wcagRule: string }): string | null {
  if (f.axeRuleId && RULES[f.axeRuleId]) return f.axeRuleId;
  return BY_SC[f.wcagRule] ?? null;
}

/** Strings from the finding worth searching the repo for: ids, classes, text, src/href values. */
export function searchTerms(f: { selector: string; html?: string | null }): string[] {
  const terms = new Set<string>();
  for (const m of f.selector.matchAll(/#([\w-]+)/g)) terms.add(m[1]);
  for (const m of f.selector.matchAll(/\.([\w-]+)/g)) terms.add(m[1]);
  const html = f.html ?? '';
  for (const m of html.matchAll(/\b(?:id|class|name|placeholder|src|href|alt|title)="([^"]{2,80})"/g)) m[1].split(/\s+/).forEach((t) => t.length > 2 && terms.add(t));
  const text = html.replace(/<[^>]+>/g, ' ').trim();
  if (text.length > 2) terms.add(text.slice(0, 40));
  return [...terms].slice(0, 8);
}

export function rankFile(content: string, terms: string[], prefer: 'markup' | 'style' | 'any', path: string): number {
  let score = 0;
  for (const t of terms) if (content.includes(t)) score += 1;
  if (prefer === 'style' && /\.(css|scss|sass|less)$/.test(path)) score += 2;
  if (prefer === 'markup' && /\.(html?|jsx|tsx|vue|svelte|php|erb|hbs|njk|astro)$/.test(path)) score += 1;
  return score;
}

/** Apply exact-match edits. Each `old` must occur exactly once, so patches stay minimal and unambiguous. */
export function applyEdits(content: string, edits: Edit[]): string {
  if (!edits.length) throw new Error('Patch has no edits');
  let out = content;
  for (const e of edits) {
    if (!e.old || e.old === e.new) throw new Error('Invalid edit');
    const first = out.indexOf(e.old);
    if (first === -1) throw new Error('Edit target not found in file (file changed, or the patch was wrong)');
    if (out.indexOf(e.old, first + 1) !== -1) throw new Error('Edit target is ambiguous (appears more than once)');
    out = out.slice(0, first) + e.new + out.slice(first + e.old.length);
  }
  return out;
}

export function makeDiff(path: string, before: string, after: string): string {
  return createTwoFilesPatch(`a/${path}`, `b/${path}`, before, after, '', '', { context: 3 });
}

/** Reject runaway patches: a "minimal" fix should not rewrite the file. */
export function assertMinimal(before: string, edits: Edit[]) {
  const changed = edits.reduce((n, e) => n + Math.max(e.old.length, e.new.length), 0);
  if (edits.length > 6 || changed > Math.max(1500, before.length * 0.2)) throw new Error('Patch is not minimal enough');
}
