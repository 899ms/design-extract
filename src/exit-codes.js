// Exit codes a CI pipeline can branch on. "The design drifted" and "the tool
// could not extract" used to share exit 1, so a gate could not tell a real
// regression from a flaky preview deploy.

export const EXIT = Object.freeze({
  OK: 0,
  DRIFT: 1, // a drift/lint gate crossed its threshold
  EXTRACTION_FAILED: 2, // browser missing, page error, bad input
  NAVIGATION_TIMEOUT: 3, // retryable: try --wait or a later run
});

export function exitCodeForError(err) {
  if (err?.name === 'TimeoutError' || /Timeout \d+ms exceeded/.test(err?.message || '')) return EXIT.NAVIGATION_TIMEOUT;
  return EXIT.EXTRACTION_FAILED;
}
