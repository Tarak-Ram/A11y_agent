/** Plain-English explanations, keyed by WCAG success criterion and by axe rule id. */
export interface Explanation {
  title: string;
  why: string;
  howToFix: string;
}

const BY_AXE: Record<string, Explanation> = {
  'image-alt': {
    title: 'Image has no text description',
    why: 'Blind users hear nothing, or the file name, instead of what the picture shows.',
    howToFix: 'Add an alt attribute that says what the image conveys. Use alt="" if it is purely decorative.',
  },
  'button-name': {
    title: 'Button has no name',
    why: 'A screen reader says just "button", so people cannot tell what it does.',
    howToFix: 'Put visible text inside the button, or add aria-label describing the action.',
  },
  'link-name': {
    title: 'Link has no name',
    why: 'A screen reader announces "link" with no destination.',
    howToFix: 'Give the link text, or alt text on the image inside it.',
  },
  label: {
    title: 'Form field has no label',
    why: 'People using screen readers or voice control cannot tell what to type, and the clickable area is smaller.',
    howToFix: 'Add a <label for="..."> tied to the input id.',
  },
  'select-name': {
    title: 'Dropdown has no label',
    why: 'A screen reader cannot tell what the dropdown chooses.',
    howToFix: 'Add a <label for="..."> tied to the select id.',
  },
  'color-contrast': {
    title: 'Text is too faint against its background',
    why: 'People with low vision, or anyone in bright sunlight, cannot read it.',
    howToFix: 'Darken the text or lighten the background until contrast is at least 4.5:1 (3:1 for large text).',
  },
  'html-has-lang': {
    title: 'Page language not set',
    why: 'Screen readers may read the page in the wrong accent and pronunciation.',
    howToFix: 'Add lang="en" (or the right language) to the <html> tag.',
  },
  'document-title': {
    title: 'Page has no title',
    why: 'Titles tell people which tab or page they are on.',
    howToFix: 'Add a short, descriptive <title> in <head>.',
  },
  'target-size': {
    title: 'Click target is too small',
    why: 'People with hand tremors or large fingers hit the wrong thing.',
    howToFix: 'Make the target at least 24x24 CSS pixels, with spacing around it.',
  },
  'heading-order': {
    title: 'Headings skip levels',
    why: 'Screen reader users jump between headings to scan; skipped levels make the outline confusing.',
    howToFix: 'Use h1, h2, h3 in order, styling with CSS rather than picking a level for its size.',
  },
};

const BY_SC: Record<string, Explanation> = {
  '1.1.1': BY_AXE['image-alt'],
  '1.4.3': BY_AXE['color-contrast'],
  '3.1.1': BY_AXE['html-has-lang'],
  '2.4.2': BY_AXE['document-title'],
  '2.5.8': BY_AXE['target-size'],
  '4.1.2': BY_AXE['button-name'],
  '1.3.1': {
    title: 'Structure is not exposed to assistive technology',
    why: 'Information shown visually (labels, headings, lists) is not available to people who cannot see it.',
    howToFix: 'Use real HTML elements: label, h1-h6, ul/li, table headers.',
  },
  '2.1.1': {
    title: 'Not usable with the keyboard',
    why: 'People who cannot use a mouse cannot reach or operate this.',
    howToFix: 'Use a real <button> or <a>, or add tabindex="0" plus Enter/Space key handlers.',
  },
  '2.4.7': {
    title: 'Keyboard focus is not visible',
    why: 'Keyboard users lose track of where they are.',
    howToFix: 'Do not remove outlines; add a clear :focus-visible style.',
  },
};

export function explain(wcagRule: string, axeRuleId?: string | null): Explanation {
  return (
    (axeRuleId && BY_AXE[axeRuleId]) ||
    BY_SC[wcagRule] || {
      title: 'Accessibility barrier',
      why: 'This makes the page harder or impossible to use for some people.',
      howToFix: 'See the WCAG guideline for this rule: https://www.w3.org/WAI/WCAG22/quickref/',
    }
  );
}
