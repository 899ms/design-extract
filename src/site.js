// site — crawl a whole site and synthesize ONE canonical design system.
//
// Thin orchestrator (same rule as multipage.js): it reuses the existing
// canonical-page discovery and the full single-page extractor, then hands the
// per-page designs to `synthesizeSite`. The homepage is extracted by the
// caller and passed in, so we never re-extract it. Per-page failures are
// recorded, never thrown — one dead route can't kill the run.

import { launchChromium } from './browser.js';
import { discoverCanonicalPages, collectLinks } from './multipage.js';
import { synthesizeSite } from './site-synthesis.js';

export async function crawlSite({ homepageUrl, homepageDesign, maxPages = 6, extract, crawlerOptions = {}, onProgress }) {
  const browser = await launchChromium({ headless: true });
  const context = await browser.newContext({
    viewport: { width: crawlerOptions.width || 1280, height: crawlerOptions.height || 800 },
    colorScheme: 'light',
  });
  const page = await context.newPage();
  const pages = [];
  if (homepageDesign) pages.push({ url: homepageUrl, type: 'home', design: homepageDesign });

  let targets = [];
  try {
    await page.goto(homepageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    const links = await collectLinks(page).catch(() => []);
    // homepage occupies one slot, so discover up to maxPages-1 more.
    targets = await discoverCanonicalPages(links, homepageUrl, Math.max(0, maxPages - 1));
  } finally {
    await browser.close();
  }

  for (const t of targets) {
    onProgress?.(t.url);
    try {
      const design = await extract(t.url, {
        ...crawlerOptions,
        depth: 0,
        dark: false,
        screenshots: false,
        responsive: false,
        interactions: false,
        deepInteract: false,
        _skipMultipage: true,
      });
      pages.push({ url: t.url, type: t.type, design });
    } catch (e) {
      pages.push({ url: t.url, type: t.type, error: e.message });
    }
  }

  const synthesis = synthesizeSite(pages);
  return {
    ...synthesis,
    crawled: pages.map((p) => ({ url: p.url, type: p.type, ok: !!p.design, error: p.error || null })),
  };
}
