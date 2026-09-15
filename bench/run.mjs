#!/usr/bin/env node
// Head-to-head extraction benchmark: designlang (this checkout) vs a pinned
// dembrandt, on a fixed site list with hand-checked ground truth.
//
//   node bench/run.mjs [--sites bench/sites.json] [--only stripe.com,linear.app]
//
// Fairness: both tools run with their default settings, one at a time on the
// same machine, alternating which goes first per site. Every result is written
// to bench/results/<date>.{json,md}, losses included.

import { spawn } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { basename, dirname, join, resolve } from 'path';
import { scoreSite, summarize, readDesignlang, readDembrandt, COLOR_TOLERANCE } from './score.js';

const DEMBRANDT_VERSION = '0.33.0';
const TIMEOUT_MS = 180_000;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

// Runs in a throwaway directory so neither tool writes into the repo. macOS has
// no `timeout`, so the kill timer lives here.
function runTool(cmd, args) {
  return new Promise((done) => {
    const cwd = mkdtempSync(join(tmpdir(), 'designlang-bench-'));
    const started = Date.now();
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      rmSync(cwd, { recursive: true, force: true });
      done({ code, signal, stdout, stderr, seconds: (Date.now() - started) / 1000 });
    });
  });
}

function parseJson(stdout) {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  return JSON.parse(stdout.slice(start, end + 1));
}

const TOOLS = {
  designlang: {
    version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')).version,
    extract: (site) => runTool(process.execPath, [join(root, 'bin/design-extract.js'), `https://${site}`, '--json', '--no-history']),
    read: readDesignlang,
  },
  dembrandt: {
    version: DEMBRANDT_VERSION,
    extract: (site) => runTool('npx', ['-y', `dembrandt@${DEMBRANDT_VERSION}`, site, '--json-only']),
    read: readDembrandt,
  },
};

const sitesFile = resolve(arg('sites', join(root, 'bench/sites.json')));
const only = arg('only')?.split(',');
const truths = JSON.parse(readFileSync(sitesFile, 'utf-8')).sites.filter((s) => !only || only.includes(s.site));

console.log(`designlang ${TOOLS.designlang.version} vs dembrandt ${DEMBRANDT_VERSION} on ${truths.length} sites\n`);
await runTool('npx', ['-y', `dembrandt@${DEMBRANDT_VERSION}`, 'install-browser']);

const rows = { designlang: [], dembrandt: [] };
for (const [i, truth] of truths.entries()) {
  const order = i % 2 ? ['dembrandt', 'designlang'] : ['designlang', 'dembrandt'];
  for (const name of order) {
    const r = await TOOLS[name].extract(truth.site);
    let predicted = null;
    try { predicted = TOOLS[name].read(parseJson(r.stdout)); } catch { /* recorded as a failure */ }
    const ok = r.code === 0 && predicted != null;
    const row = {
      site: truth.site,
      ok,
      seconds: +r.seconds.toFixed(1),
      predicted,
      score: scoreSite(truth, ok ? predicted : null),
    };
    if (!ok) row.error = `${r.signal ? `killed (${r.signal})` : `exit ${r.code}`}: ${(r.stderr.trim().split('\n').pop() || '').slice(0, 160)}`;
    rows[name].push(row);
    const mark = (hit) => (hit === null ? '–' : hit ? '✓' : '✗');
    console.log(`${truth.site.padEnd(24)} ${name.padEnd(10)} ${ok ? `colour ${mark(row.score.color)} font ${mark(row.score.font)}` : row.error} ${row.seconds}s`);
  }
}

const summary = Object.fromEntries(Object.entries(rows).map(([name, r]) => [name, summarize(r)]));
const date = new Date().toISOString().slice(0, 10);
const report = {
  date,
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  tools: { designlang: TOOLS.designlang.version, dembrandt: DEMBRANDT_VERSION },
  colorTolerance: COLOR_TOLERANCE,
  summary,
  sites: truths.map((truth, i) => ({ ...truth, designlang: rows.designlang[i], dembrandt: rows.dembrandt[i] })),
};

const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—');
const ratio = (hits, total) => `${hits}/${total} (${pct(hits, total)})`;
const cell = (row, key) => {
  if (row.score[key] === null) return 'n/a';
  if (!row.ok) return '❌ failed';
  return `${row.score[key] ? '✅' : '❌'} ${row.predicted[key === 'color' ? 'primary' : 'font'] ?? '—'}`;
};
const truthText = (s) => `${s.primary?.length ? s.primary.join(' / ') : 'n/a'} · ${s.font?.length ? s.font.join(' / ') : 'n/a'}`;
const md = [
  `# Extraction benchmark — ${date}`,
  '',
  `designlang ${TOOLS.designlang.version} vs dembrandt ${DEMBRANDT_VERSION}, default settings, ${truths.length} sites, ${report.platform}, Node ${process.version}.`,
  `A colour counts when it is within ΔE ${COLOR_TOLERANCE} (CIE76) of the site's brand colour; a font counts when it names the body-text family.`,
  '',
  '| | designlang | dembrandt |',
  '|---|---|---|',
  `| Primary colour correct | ${ratio(summary.designlang.colorHits, summary.designlang.colorSites)} | ${ratio(summary.dembrandt.colorHits, summary.dembrandt.colorSites)} |`,
  `| Body font correct | ${ratio(summary.designlang.fontHits, summary.designlang.fontSites)} | ${ratio(summary.dembrandt.fontHits, summary.dembrandt.fontSites)} |`,
  `| Failed runs | ${summary.designlang.failures} | ${summary.dembrandt.failures} |`,
  `| Median time | ${summary.designlang.medianSeconds ?? '—'}s | ${summary.dembrandt.medianSeconds ?? '—'}s |`,
  '',
  '| Site | Truth | designlang colour | dembrandt colour | designlang font | dembrandt font |',
  '|---|---|---|---|---|---|',
  ...report.sites.map((s) => `| ${s.site} | ${truthText(s)} |${cell(s.designlang, 'color')} | ${cell(s.dembrandt, 'color')} | ${cell(s.designlang, 'font')} | ${cell(s.dembrandt, 'font')} |`),
  '',
  'Reproduce: `node bench/run.mjs`. Ground truth and sources: `bench/sites.json`.',
  '',
].join('\n');

// bench/sites.json writes <date>.*; any other set (e.g. holdout.json) writes
// <date>-<set>.* so one run never overwrites another.
const set = basename(sitesFile, '.json');
const name = set === 'sites' ? date : `${date}-${set}`;
const outDir = join(root, 'bench/results');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${name}.json`), JSON.stringify(report, null, 2));
writeFileSync(join(outDir, `${name}.md`), md);
console.log(`\n${md}`);
