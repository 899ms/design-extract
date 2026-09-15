#!/usr/bin/env node
// Evidence for bench/sites.json that doesn't lean on either extractor's
// heuristics: the family that actually renders body copy (the first family in
// its font stack with a loaded font file), and how close the page's painted
// colours come to each claimed brand colour.
//
//   node bench/evidence.mjs stripe.com=#533afd linear.app=#5e6ad2,#e4f222

import { launchChromium } from '../src/browser.js';
import { toHex, deltaE } from './score.js';

function inPage() {
  const body = document.querySelector('main p, article p, p') || document.body;
  const stack = getComputedStyle(body).fontFamily.split(',').map((f) => f.trim().replace(/^["']|["']$/g, ''));
  const loaded = new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/^["']|["']$/g, '')));
  const rendered = stack.find((f) => loaded.has(f)) || null;

  const painted = {};
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const add = (value, weight) => {
      if (!value || value === 'transparent' || value.startsWith('rgba(0, 0, 0, 0)')) return;
      painted[value] = (painted[value] || 0) + weight;
    };
    add(cs.backgroundColor, r.width * r.height);
    add(cs.color, 100);
    add(cs.borderTopColor, cs.borderTopWidth !== '0px' ? r.width : 0);
  }
  return { bodyFontStack: stack, bodyFontRendered: rendered, painted };
}

const targets = process.argv.slice(2).map((a) => {
  const [site, claims = ''] = a.split('=');
  return { site, claims: claims.split(',').filter(Boolean) };
});

const browser = await launchChromium({ headless: true });
try {
  for (const { site, claims } of targets) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await page.goto(`https://${site}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      const { bodyFontStack, bodyFontRendered, painted } = await page.evaluate(inPage);
      const colors = Object.entries(painted)
        .map(([value, weight]) => ({ hex: toHex(value), weight }))
        .filter((c) => c.hex);
      const closest = claims.map((claim) => {
        const best = colors
          .map((c) => ({ hex: c.hex, deltaE: +deltaE(toHex(claim), c.hex).toFixed(1), weight: Math.round(c.weight) }))
          .sort((a, b) => a.deltaE - b.deltaE)[0];
        return { claim, closest: best || null };
      });
      console.log(JSON.stringify({ site, bodyFontRendered, bodyFontStack: bodyFontStack.slice(0, 4), claims: closest }));
    } catch (err) {
      console.log(JSON.stringify({ site, error: err.message.split('\n')[0] }));
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
