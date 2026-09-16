import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EXIT, exitCodeForError } from '../src/exit-codes.js';

describe('writeThenExit', () => {
  it('delivers output larger than a pipe buffer in full before exiting', async () => {
    const helper = new URL('../src/exit-codes.js', import.meta.url).href;
    const script = `
      import { writeThenExit } from ${JSON.stringify(helper)};
      const doc = JSON.stringify({ rows: Array.from({ length: 6000 }, (_, i) => ({ i, pad: 'x'.repeat(40) })) });
      writeThenExit(process.stdout, doc + '\\n', 1);
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    const code = await new Promise((resolve) => child.on('close', resolve));
    assert.ok(Buffer.byteLength(out) > 65536 * 4, `only ${Buffer.byteLength(out)} bytes arrived`);
    assert.equal(JSON.parse(out).rows.length, 6000);
    assert.equal(code, 1);
  });
});

describe('exit codes', () => {
  it('keeps drift and extraction failure distinct', () => {
    assert.deepEqual(EXIT, { OK: 0, DRIFT: 1, EXTRACTION_FAILED: 2, NAVIGATION_TIMEOUT: 3 });
  });

  it('classifies a Playwright navigation timeout as retryable', () => {
    const byName = Object.assign(new Error('page.goto: Timeout 30000ms exceeded.'), { name: 'TimeoutError' });
    assert.equal(exitCodeForError(byName), EXIT.NAVIGATION_TIMEOUT);
    assert.equal(exitCodeForError(new Error('page.goto: Timeout 30000ms exceeded.')), EXIT.NAVIGATION_TIMEOUT);
  });

  it('classifies everything else as an extraction failure', () => {
    assert.equal(exitCodeForError(Object.assign(new Error('No browser available.'), { code: 'BROWSER_UNAVAILABLE' })), EXIT.EXTRACTION_FAILED);
    assert.equal(exitCodeForError(new Error('net::ERR_NAME_NOT_RESOLVED')), EXIT.EXTRACTION_FAILED);
    assert.equal(exitCodeForError(undefined), EXIT.EXTRACTION_FAILED);
  });
});
