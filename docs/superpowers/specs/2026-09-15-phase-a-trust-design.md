# Phase A — close the adoption gaps vs dembrandt, then prove it

Date: 2026-09-15 · Status: approved

## Why

Head-to-head on 8 sites (stripe, linear, vercel, github, gov.uk, ikea, notion,
tailwindcss): designlang matched or beat dembrandt 0.33.0 on primary colour and
font, and ran 1.8× faster (88s vs 159s). Yet dembrandt pulls ~6.6× the npm
downloads. The gap is trust and distribution, not extraction:

- npm `latest` is 12.21.0 (2026-06-14); repo is 13.2.0.
- MCP server can't extract a URL (5 read-only tools over a folder), reports
  version 7.0.0, rejects a version-less `initialize` (#182, #183).
- CLI exits `1` for everything; the GitHub Action installs unpinned latest and
  does not fail on drift by default.
- `postinstall` downloads Chromium, which breaks in CI/Docker.
- No published, reproducible evidence of quality.

## Scope (in order, each its own minor release)

**A1 Releases** — `.github/workflows/release.yml` on `v*.*.*` tags: `npm ci`,
`npm test`, tag == `package.json` version, `npm publish --provenance`
(`NPM_TOKEN`). MCP `serverInfo.version` read from `package.json`.

**A2 Browser install** — drop `postinstall`; add `designlang install-browser`;
one shared launcher: bundled Chromium → system Chrome → actionable error. All
launch sites use it.

**A3 MCP v2** — keep the 5 existing tools. Add job-based URL tools:
`extract_design`, `get_job_status`, `list_jobs`, `cancel_job`, `get_tokens`,
`get_colors`, `get_typography`, `get_components`, plus `compute_drift`,
`get_findings`, `export`. A stock SDK client must handshake and list tools;
version-less `initialize` is served on the default revision.

**A4 CI gate** — exit codes 0 ok · 1 drift over threshold · 2 extraction failed
· 3 navigation timeout. Action pins designlang to its own tag, fails on drift by
default, annotates the PR, author Manavarya09.

**A5 Benchmark** — `bench/sites.json` (~30 sites, ground-truth primary colour +
primary font, owner-reviewed), `bench/run.mjs` runs designlang and pinned
dembrandt sequentially with default flags, scores colour (ΔE tolerance), font,
time, failures → `bench/results/<date>.{json,md}`. Baseline first, fix what it
exposes (generic fallback fonts in families; primary pick on linear/gov.uk),
then publish README table + `website/app/vs/dembrandt`. Losses are published.

## Out of scope

Hosted drift platform (phase C, separate design). New emitters.

## Testing

`npm test` gates every step. New tests: launcher fallback, MCP handshake + tool
calls via SDK client, exit codes, benchmark scorer.
