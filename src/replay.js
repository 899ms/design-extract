// Motion replay — records a short WebM of a site with scripted
// interactions (hover/scroll) so the captured motion actually fires.
// Zero new deps: Playwright ships video recording out of the box.
//
// Output: <prefix>-motion.webm  (+ optional MP4 if ffmpeg is on PATH)
//
// Usage: designlang replay <url> [--duration 5] [--out dir]

import { launchChromium } from './browser.js';
import { mkdirSync, existsSync, readdirSync, statSync, renameSync, unlinkSync, rmdirSync } from 'fs';
import { resolve, join } from 'path';
import { spawnSync } from 'child_process';

async function ensureFfmpeg() {
  try {
    const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return r.status === 0;
  } catch { return false; }
}

function toMp4(webmPath) {
  const mp4Path = webmPath.replace(/\.webm$/, '.mp4');
  const r = spawnSync('ffmpeg', ['-y', '-i', webmPath, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4Path], { stdio: 'ignore' });
  return r.status === 0 ? mp4Path : null;
}

export async function recordReplay(url, opts = {}) {
  const outDir = resolve(opts.out || './design-extract-output');
  mkdirSync(outDir, { recursive: true });
  const prefix = opts.prefix || 'motion-replay';
  const duration = Math.max(2, Math.min(15, parseInt(opts.duration) || 5));
  const width = parseInt(opts.width) || 1280;
  const height = parseInt(opts.height) || 800;

  const videoDir = join(outDir, `.playwright-video-${Date.now()}`);
  mkdirSync(videoDir, { recursive: true });

  const browser = await launchChromium({ headless: true });
  const context = await browser.newContext({
    viewport: { width, height },
    recordVideo: { dir: videoDir, size: { width, height } },
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 25000 });
  } catch {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }); } catch {}
  }

  // Scripted motion pass: slow scroll → hover first CTA → scroll back.
  const frameMs = 50;
  const steps = Math.floor((duration * 1000) / frameMs);
  for (let i = 0; i < steps; i++) {
    const progress = i / steps;
    // Slow smooth scroll across the page
    await page.evaluate((p) => {
      const max = Math.max(document.body.scrollHeight - window.innerHeight, 0);
      window.scrollTo({ top: max * p, behavior: 'auto' });
    }, progress).catch(() => {});
    // Partway through, hover a button to trigger transition states.
    if (i === Math.floor(steps / 2)) {
      try {
        const btn = await page.$('button, [role="button"], a.btn, .button, [class*="btn"]');
        if (btn) await btn.hover({ timeout: 1000 }).catch(() => {});
      } catch {}
    }
    await page.waitForTimeout(frameMs);
  }

  const videoPromise = page.video();
  await context.close();
  await browser.close();

  // Move the captured WebM out of the Playwright temp dir.
  const finalWebm = join(outDir, `${prefix}.webm`);
  try {
    const video = await videoPromise;
    if (video && typeof video.path === 'function') {
      const src = await video.path();
      if (src && existsSync(src)) {
        renameSync(src, finalWebm);
      }
    } else {
      // Fallback: grab whatever .webm Playwright wrote to the dir.
      const produced = readdirSync(videoDir).filter(f => f.endsWith('.webm'))
        .map(f => ({ f, t: statSync(join(videoDir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t)[0];
      if (produced) renameSync(join(videoDir, produced.f), finalWebm);
    }
  } catch { /* no video — fall through with null result */ }

  // Clean the scratch dir.
  try {
    for (const f of readdirSync(videoDir)) unlinkSync(join(videoDir, f));
    rmdirSync(videoDir);
  } catch {}

  const result = {
    url,
    webm: existsSync(finalWebm) ? finalWebm : null,
    mp4: null,
    duration,
    width,
    height,
  };

  if (result.webm && opts.mp4 && await ensureFfmpeg()) {
    const mp4 = toMp4(result.webm);
    if (mp4) result.mp4 = mp4;
  }

  return result;
}

// Tiny snippet that can be spliced into the existing HTML preview to embed
// the replay next to the static screenshot. Consumer decides where to place.
export function replayEmbedHtml(result) {
  if (!result?.webm) return '';
  const src = result.webm.split(/[\\/]/).pop();
  return `<figure class="motion-replay" style="margin:24px 0">
  <video autoplay loop muted playsinline style="width:100%;border:1px solid #0a0908">
    <source src="${src}" type="video/webm" />
    ${result.mp4 ? `<source src="${result.mp4.split(/[\\/]/).pop()}" type="video/mp4" />` : ''}
  </video>
  <figcaption style="font-family:var(--font-mono, monospace);font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#403c34;margin-top:8px">
    motion replay · ${result.duration}s · ${result.width}×${result.height}
  </figcaption>
</figure>`;
}
