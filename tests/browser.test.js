import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { launchChromium, INSTALL_HINT } from '../src/browser.js';

const missingBundled = () => new Error("browserType.launch: Executable doesn't exist at /tmp/chromium/chrome");
const missingChrome = () => new Error("browserType.launch: Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome");

function fakeChromium(results) {
  const calls = [];
  return {
    calls,
    async launch(opts) {
      calls.push(opts);
      const r = results[calls.length - 1];
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

describe('launchChromium', () => {
  it('uses the bundled browser when it is installed', async () => {
    const chromium = fakeChromium([{ id: 'bundled' }]);
    const browser = await launchChromium({ headless: true }, { chromium });
    assert.equal(browser.id, 'bundled');
    assert.equal(chromium.calls.length, 1);
  });

  it('falls back to system Chrome when the bundled browser is missing', async () => {
    const chromium = fakeChromium([missingBundled(), { id: 'chrome' }]);
    const browser = await launchChromium({ headless: true }, { chromium });
    assert.equal(browser.id, 'chrome');
    assert.deepEqual(chromium.calls[1], { headless: true, channel: 'chrome' });
  });

  it('names the fix when no browser is available', async () => {
    const chromium = fakeChromium([missingBundled(), missingChrome()]);
    await assert.rejects(launchChromium({}, { chromium }), (err) => {
      assert.equal(err.code, 'BROWSER_UNAVAILABLE');
      assert.ok(err.message.includes(INSTALL_HINT));
      return true;
    });
  });

  it('does not second-guess an explicit channel', async () => {
    const chromium = fakeChromium([missingChrome()]);
    await assert.rejects(launchChromium({ channel: 'chrome' }, { chromium }), { code: 'BROWSER_UNAVAILABLE' });
    assert.equal(chromium.calls.length, 1);
  });

  it('rethrows unrelated launch errors untouched', async () => {
    const boom = new Error('Target page, context or browser has been closed');
    const chromium = fakeChromium([boom]);
    await assert.rejects(launchChromium({}, { chromium }), (err) => err === boom);
  });
});
