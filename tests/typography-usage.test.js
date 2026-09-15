import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractTypography } from '../src/extractors/typography.js';
import { formatCssVars } from '../src/formatters/css-vars.js';
import { formatTailwind } from '../src/formatters/tailwind.js';
import { formatReactTheme } from '../src/formatters/theme.js';

const el = (tag, fontFamily, extra = {}) => ({ tag, fontFamily, fontSize: '16px', fontWeight: '400', lineHeight: '1.5', letterSpacing: 'normal', ...extra });

// A real extraction with its families swapped for a measured shape.
function designWithFamilies(families) {
  const design = JSON.parse(readFileSync(new URL('./fixtures/example-design.json', import.meta.url), 'utf-8'));
  design.typography.families = families;
  return design;
}
// gov.uk before the fix: the brand face sets headings and body ("all"), and
// the browser default trails behind, mislabelled as body.
const GOV_UK_FAMILIES = [
  { name: 'GDS Transport', count: 567, usage: 'all' },
  { name: 'Times', count: 36, usage: 'body' },
  { name: 'Arial', count: 13, usage: 'body' },
];
// supabase: two body families; the second used to overwrite the first.
const SUPABASE_FAMILIES = [
  { name: 'Inter', count: 4619, usage: 'body' },
  { name: 'Source Code Pro', count: 181, usage: 'body' },
];

function tailwindFont(config, key) {
  const m = config.match(new RegExp(`["']?${key}["']?\\s*:\\s*\\[\\s*["']([^"']+)`));
  return m ? m[1] : null;
}

describe('typography family usage', () => {
  it('does not label a family body when it sets neither headings nor body copy', () => {
    const typo = extractTypography([
      el('p', '"Inter", sans-serif', { hasText: true }),
      el('h1', '"Inter", sans-serif', { hasText: true }),
      el('button', 'Arial', { hasText: true }),
    ]);
    assert.equal(typo.families.find((f) => f.name === 'Arial').usage, 'other');
    assert.equal(typo.families.find((f) => f.name === 'Inter').usage, 'all');
  });

  it('counts a family only where it renders text (gov.uk head elements carried Times)', () => {
    const styles = [
      ...Array.from({ length: 20 }, () => el('meta', 'Times', { hasText: false })),
      el('link', 'Times', { hasText: false }),
      el('title', 'Times', { hasText: true }),
      el('div', 'Times', { hasText: false }),
      el('p', '"GDS Transport", arial, sans-serif', { hasText: true }),
      el('h1', '"GDS Transport", arial, sans-serif', { hasText: true }),
    ];
    const names = extractTypography(styles).families.map((f) => f.name);
    assert.deepEqual(names, ['GDS Transport']);
  });

  it('still counts records captured before hasText existed', () => {
    const typo = extractTypography([el('p', '"Inter", sans-serif'), el('h2', '"Inter", sans-serif')]);
    assert.equal(typo.families[0].name, 'Inter');
    assert.equal(typo.families[0].count, 2);
  });
});

describe('body font in emitted themes', () => {
  it('css vars never hand --font-body to a trailing fallback', () => {
    const css = formatCssVars(designWithFamilies(GOV_UK_FAMILIES));
    assert.match(css, /--font-sans: 'GDS Transport'/);
    assert.doesNotMatch(css, /--font-body: 'Times'/);
  });

  it('css vars give --font-body to the most used body family', () => {
    const css = formatCssVars(designWithFamilies(SUPABASE_FAMILIES));
    assert.match(css, /--font-body: 'Inter'/);
    assert.doesNotMatch(css, /--font-body: 'Source Code Pro'/);
  });

  it('tailwind keeps the main family on sans and never makes a fallback the body font', () => {
    const config = formatTailwind(designWithFamilies(GOV_UK_FAMILIES));
    assert.equal(tailwindFont(config, 'sans'), 'GDS Transport');
    assert.notEqual(tailwindFont(config, 'body'), 'Times');
  });

  it('tailwind body is the most used body family, not the last one seen', () => {
    const config = formatTailwind(designWithFamilies(SUPABASE_FAMILIES));
    assert.equal(tailwindFont(config, 'body'), 'Inter');
  });

  it('the React/MUI theme sets body text in the family used everywhere', () => {
    const out = formatReactTheme(designWithFamilies(GOV_UK_FAMILIES));
    const text = typeof out === 'string' ? out : JSON.stringify(out);
    assert.ok(text.includes("'GDS Transport', sans-serif"));
    assert.ok(!text.includes("'Times', sans-serif"), 'a browser-default fallback must not become the body font');
  });
});
