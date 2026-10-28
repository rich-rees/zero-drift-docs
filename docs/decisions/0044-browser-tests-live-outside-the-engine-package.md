# 0044 — Browser tests live outside the engine package; the engine stays dependency-free

**Date:** 2026-10-28 · **Status:** accepted · **Origin:** ZDD-8, the design session on 2026-10-28 (Rich's calls, questions 1–4); finding CR-177 of the ZDD-2 campaign.

## Context

CI proved the human index's data (the embedded BUNDLE, byte for byte) and
its page structure, but nothing clicked it. The peek's back history, its
filter, and the jump from a blessing to a node and back were proved only by
a hand pass in a browser. CR-167 is the evidence: the detail panel opened
and closed at once whenever a node was already selected, a bug older than
0.10.0 that passed every test and the first hand pass.

Clicking the page needs a real browser and a library to drive it. The
engine (`@rich-rees/zdd`) has no dependencies: adopters run it with `npx`,
and a contributor runs its suite with nothing installed.

## Decision

1. **Browser tests live in `test/browser/`, a private workspace of their
   own** (its own `package.json` and lockfile) at the repo root, outside the
   published package. The engine's `package.json` gains no dependency, dev
   or otherwise.
2. **Playwright, used as a library and run by `node --test`**, the same
   test style as the engine and plugin suites, not Playwright's own runner.
   A failing flow saves a screenshot, which CI uploads.
3. **The smoke test renders the engine's own fixture** with the engine in
   the checkout, into throwaway copies; variants (a hostile blessing, an
   empty store) are made in the copy, so the committed fixture and its
   goldens never move for the browser's sake.
4. **One CI job, `browser-smoke`: ubuntu, Node 22**, with Chromium cached.
   The engine and plugin suites keep the full matrix.
5. **The release gate for it is the release checklist**, not the tag
   workflow: `browser-smoke` green on the merge commit is a checklist line
   (`CLAUDE.md`, Releasing). `release.yml` and `pre-tag.mjs` run only the
   two suites, so a release never needs Playwright or Chromium.

## Consequences

- The engine's "stdlib only, zero dependencies" stays literally true, and
  both existing suites run as before with nothing installed.
- The flows the human index promises (each header button, a list's filter
  across back, blessing → ADR → back → back, blessing → node → back with a
  node already selected, a hostile blessing, the empty store) fail a CI job
  when they break, and so does any uncaught page error, dialog, or request
  that leaves the page (the viewer contract promises none).
- The downloaded Chromium is trusted as the npm install is: Playwright's
  own download, no digest of our own. The job holds no secret and a
  read-only token.
- A Windows-only or Node-20-only browser bug is not caught here. What is
  under test runs inside Chromium, which neither choice touches; the page's
  data still runs on the full matrix through the goldens.
- The smoke test reads one internal of the page — cytoscape's instance on
  its container — only to find where a node is drawn, so the test taps the
  real canvas, and whether a node is still selected after Reset. A cytoscape upgrade that moves it fails the test loudly, not
  silently.
- A second browser test (a third-party viewer's, a stack's fixture) goes in
  `test/browser/` too, under this decision.

## Rejected

- **Playwright as a dev dependency of the engine.** Adopters would never
  install it, but the engine would stop being a project with no
  dependencies for contributors, and its suite would need an install or a
  skip.
- **No npm dependency: drive Chrome over its debugging protocol by hand.**
  A small browser driver to write and keep correct, without the waiting
  and clicking a library gives.
- **Playwright's own test runner.** Traces and reports built in, but a
  second test style and config in a repo that has one.
- **The full ubuntu/windows × Node 20/22 matrix for the browser job.** Four
  browser installs per PR for coverage the page does not need.
