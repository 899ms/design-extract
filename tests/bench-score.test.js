import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toHex, deltaE, colorHit, fontHit, normalizeFont, scoreSite, summarize, readDesignlang, readDembrandt } from '../bench/score.js';

describe('bench score: reading each tool', () => {
  it('reads designlang primary and body family', () => {
    const design = JSON.parse(readFileSync(new URL('./fixtures/example-design.json', import.meta.url), 'utf-8'));
    assert.deepEqual(readDesignlang(design), { primary: '#334488', font: 'Times' });
  });

  it('prefers the body family over a more frequent heading family', () => {
    const design = { colors: {}, typography: { families: [{ name: 'Display', count: 40, usage: 'heading' }, { name: 'Inter', count: 12, usage: 'body' }] } };
    assert.equal(readDesignlang(design).font, 'Inter');
  });

  it('reads dembrandt primary (rgb) and body context', () => {
    const out = {
      colors: { semantic: { primary: 'rgb(83, 58, 253)' } },
      typography: { styles: [
        { context: 'heading-1', family: 'Display', count: 30 },
        { context: 'body', family: 'sohne-var', count: 5 },
      ] },
    };
    assert.deepEqual(readDembrandt(out), { primary: '#533afd', font: 'sohne-var' });
  });

  it('falls back to the most used family when nothing is labelled body', () => {
    const out = { colors: { semantic: {} }, typography: { styles: [
      { context: 'text', family: 'A', count: 2 },
      { context: 'link', family: 'B', count: 3 },
      { context: 'ui', family: 'A', count: 2 },
    ] } };
    assert.deepEqual(readDembrandt(out), { primary: null, font: 'A' });
  });
});

describe('bench score: colours', () => {
  it('reads hex, short hex, 8-digit hex, rgb() and colour objects', () => {
    assert.equal(toHex('#533AFD'), '#533afd');
    assert.equal(toHex('#fff'), '#ffffff');
    assert.equal(toHex('#533afdcc'), '#533afd');
    assert.equal(toHex('rgb(83, 58, 253)'), '#533afd');
    assert.equal(toHex('rgba(0 112 243 / 0.5)'), '#0070f3');
    assert.equal(toHex({ hex: '#0075de' }), '#0075de');
    assert.equal(toHex('oklch(0.6 0.2 260)'), null);
    assert.equal(toHex(undefined), null);
  });

  it('treats near-identical brand blues as the same colour', () => {
    assert.ok(deltaE('#0070f3', '#0072f5') < 1);
    assert.ok(colorHit('#0072f5', ['#0070f3']));
  });

  it('rejects a different hue on the same palette', () => {
    // Linear: lime accent vs indigo brand.
    assert.equal(colorHit('#e4f222', ['#5e6ad2']), false);
    // gov.uk: green vs GOV.UK blue.
    assert.equal(colorHit('#0f7a52', ['#1d70b8']), false);
  });

  it('accepts any listed alternate and fails on missing predictions', () => {
    assert.ok(colorHit('#ffdb00', ['#0058a3', '#ffdb00']));
    assert.equal(colorHit(null, ['#000000']), false);
  });
});

describe('bench score: fonts', () => {
  it('normalizes variable-font suffixes, quotes and accents', () => {
    assert.equal(normalizeFont('"Inter Variable"'), 'inter');
    assert.equal(normalizeFont('sohne-var'), 'sohne');
    assert.equal(normalizeFont('Söhne'), 'sohne');
    assert.equal(normalizeFont('Mona Sans VF'), 'monasans');
  });

  it('matches the same family under different names', () => {
    assert.ok(fontHit('sohne-var', ['Söhne']));
    assert.ok(fontHit('GeistSans', ['Geist']));
    assert.ok(fontHit('NotionInter', ['Inter']));
  });

  it('does not credit a generic fallback', () => {
    assert.equal(fontHit('Times', ['GDS Transport']), false);
    assert.equal(fontHit('', ['Inter']), false);
  });
});

describe('bench score: summary', () => {
  it('scores a site and summarizes a tool across sites', () => {
    const truth = { primary: ['#533afd'], font: ['Söhne'] };
    assert.deepEqual(scoreSite(truth, { primary: 'rgb(83, 58, 253)', font: 'sohne-var' }), { color: true, font: true });

    const rows = [
      { site: 'a', ok: true, seconds: 10, score: { color: true, font: true } },
      { site: 'b', ok: true, seconds: 20, score: { color: null, font: true } },
      { site: 'c', ok: false, seconds: 180, score: { color: false, font: false } },
    ];
    assert.deepEqual(summarize(rows), {
      sites: 3, failures: 1, colorSites: 2, colorHits: 1, fontSites: 3, fontHits: 2, medianSeconds: 15,
    });
  });

  it('does not score a dimension without ground truth, and a failed run misses the rest', () => {
    const monochrome = { primary: [], font: ['Inter'] };
    assert.deepEqual(scoreSite(monochrome, { primary: '#000000', font: 'Inter Variable' }), { color: null, font: true });
    assert.deepEqual(scoreSite(monochrome, null), { color: null, font: false });
  });
});
