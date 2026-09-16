// Exit codes a CI pipeline can branch on. "The design drifted" and "the tool
// could not extract" used to share exit 1, so a gate could not tell a real
// regression from a flaky preview deploy.

export const EXIT = Object.freeze({
  OK: 0,
  DRIFT: 1, // a drift/lint gate crossed its threshold
  EXTRACTION_FAILED: 2, // browser missing, page error, bad input
  NAVIGATION_TIMEOUT: 3, // retryable: try --wait or a later run
});

// process.exit() straight after a write to a pipe drops whatever hasn't been
// flushed: `designlang <url> --json | jq` received the first 64KB of a 70KB
// document. Exit only once the write has been handed to the OS.
export function writeThenExit(stream, text, code) {
  stream.write(text, () => process.exit(code));
}

export function exitCodeForError(err) {
  if (err?.name === 'TimeoutError' || /Timeout \d+ms exceeded/.test(err?.message || '')) return EXIT.NAVIGATION_TIMEOUT;
  return EXIT.EXTRACTION_FAILED;
}
