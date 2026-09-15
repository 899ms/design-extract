import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EXIT, exitCodeForError } from '../src/exit-codes.js';

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
