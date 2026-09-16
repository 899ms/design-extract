// One place that launches Chromium, so every command shares the same fallback:
// bundled Chromium → system Chrome → an error that names the fix.
//
// Chromium used to be downloaded in `postinstall`, which fails in CI, Docker and
// behind proxies. It is now installed on demand with `designlang install-browser`.

import { chromium as playwrightChromium } from 'playwright';

export const INSTALL_HINT = 'Run `npx designlang install-browser`, or install Google Chrome.';

function isMissingBrowser(err) {
  return /Executable doesn't exist|distribution '[^']*' is not found/i.test(err?.message || '');
}

export async function launchChromium(options = {}, { chromium = playwrightChromium } = {}) {
  try {
    return await chromium.launch(options);
  } catch (err) {
    if (!isMissingBrowser(err)) throw err;
    // Only fall back when the caller didn't ask for a specific browser.
    if (!options.channel && !options.executablePath) {
      try {
        return await chromium.launch({ ...options, channel: 'chrome' });
      } catch (fallbackErr) {
        if (!isMissingBrowser(fallbackErr)) throw fallbackErr;
      }
    }
    const e = new Error(`No browser available. ${INSTALL_HINT}`, { cause: err });
    e.code = 'BROWSER_UNAVAILABLE';
    throw e;
  }
}
