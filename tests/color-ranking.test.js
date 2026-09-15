import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractColors } from '../src/extractors/colors.js';

// Each case reproduces a ranking failure measured on a real site (bench/).

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
const CLEAR = 'rgba(0, 0, 0, 0)';
const el = ({ tag = 'div', color = '#111111', bg = null, border = null, area = 2000, classList = '' } = {}) => ({
  tag, role: '', classList, area,
  color: rgb(color),
  backgroundColor: bg ? rgb(bg) : CLEAR,
  borderColor: border ? rgb(border) : CLEAR,
  backgroundImage: 'none',
});
const times = (n, make) => Array.from({ length: n }, make);
// Every real page is mostly neutral text on white.
const page = () => [...times(300, () => el()), el({ tag: 'body', bg: '#ffffff', area: 1_000_000 })];

describe('brand colour ranking', () => {
  it('a colour repeated across the page beats a one-off button colour (framer)', () => {
    const styles = [
      ...page(),
      el({ tag: 'button', bg: '#0066ff', color: '#ffffff', area: 4000 }),
      ...times(44, () => el({ tag: 'span', color: '#0099ff' })),
      el({ tag: 'section', bg: '#0099ff', area: 15_000 }),
    ];
    assert.equal(extractColors(styles).primary.hex, '#0099ff');
  });

  it('a large brand-coloured surface beats a few CTA buttons in another hue (gov.uk)', () => {
    const styles = [
      ...page(),
      ...times(4, () => el({ tag: 'button', bg: '#0f7a52', color: '#ffffff', area: 400 })),
      ...times(2, () => el({ tag: 'a', bg: '#1d70b8', color: '#ffffff', area: 3000 })),
      ...times(16, () => el({ tag: 'span', color: '#1d70b8' })),
      el({ tag: 'header', bg: '#1d70b8', area: 60_000 }),
    ];
    assert.equal(extractColors(styles).primary.hex, '#1d70b8');
  });

  it('a near-black button is not the brand colour (supabase)', () => {
    const styles = [
      ...page(),
      ...times(2, () => el({ tag: 'button', bg: '#002533', color: '#ffffff', area: 3000 })),
      ...times(26, () => el({ tag: 'span', color: '#3ecf8e' })),
      el({ tag: 'a', bg: '#3ecf8e', color: '#111111', area: 2500 }),
    ];
    assert.equal(extractColors(styles).primary.hex, '#3ecf8e');
  });

  it("ignores the browser's default link blue however often it appears (paypal)", () => {
    const styles = [
      ...page(),
      ...times(1000, () => el({ tag: 'a', color: '#0000ee' })),
      ...times(3, () => el({ tag: 'button', bg: '#ff4800', color: '#ffffff', area: 3000 })),
    ];
    assert.equal(extractColors(styles).primary.hex, '#ff4800');
  });

  it('a CTA colour used on many buttons still wins over a dark accent surface (hubspot)', () => {
    const styles = [
      ...page(),
      ...times(5, () => el({ tag: 'button', bg: '#ff4800', color: '#ffffff', area: 1500 })),
      ...times(16, () => el({ tag: 'span', color: '#ff4800' })),
      el({ tag: 'section', bg: '#042729', area: 55_000 }),
    ];
    assert.equal(extractColors(styles).primary.hex, '#ff4800');
  });
});
