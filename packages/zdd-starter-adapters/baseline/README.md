# @rich-rees/zdd-starter-adapters

Starter adapters for [Zero-Drift Docs](https://github.com/rich-rees/zero-drift-docs):
readers for common stacks (Next.js, Supabase, FastAPI, SQLAlchemy, React Router,
background-task platforms and more) that ZDD copies into an app. Once copied, an
adapter is the app's own: it can fix, delete or rebuild it without a ZDD release
(decision 0048).

This package is an offer, never a requirement. The engine, `@rich-rees/zdd`,
depends on nothing here, and a repo whose adapters are in place needs this
package for nothing: `derive`, CI and the hooks run without it. Bootstrap reads
it to ask every starter whether it fits a repo, and on a yes copies the ones
that do, with their tests.

## Layout

```
adapters/<name>/          one folder per starter: index.mjs and its modules,
  test/*.test.mjs         its own tests, which travel with it
  fixture/                the miniature repo the standard suite reads it on
                          (its SUITE export says how), which travels too
  example/                a miniature repo for the greenfield preview
adapters/_shared/         code several starters share, copied with the ones that reach it
notes.json                what each version changed, and who it affects
```

In an app the same folders sit in its `localExtractorDir`:
`<localExtractorDir>/<name>/` and `<localExtractorDir>/_shared/`. A copy brings
the starter's folder (not its `example/`) and each `_shared/` file its imports
reach, nothing else. The engine never reads that folder as the app's source.

## Tests

A starter's tests import ZDD only through the engine's test kit,
`import { ioFor, scanFor, trialRead } from "@rich-rees/zdd"`, and run with
`npx -y @rich-rees/zdd@<release> test` (Node 20.6 or later), which resolves
that name to the engine running them, so an app with no `node_modules` runs
them too. A copy also passes the app's `zdd-engine suite` on its own fixture.

## Versions

The library has a version line of its own. `notes.json` lists every version
oldest first; for each starter a version changed, each fix says `what`
changed, `who` it affects, and how record ids `moves`, so a session can read
the note against a repo that copied an earlier version and recommend.

- **0.1.0**, the baseline: every starter as ZDD 0.13 ran it from the engine.
  "Upgrade ZDD" copies these in first and proves the records unchanged.
- **0.2.0**: `supabase` and `sqlalchemy` with every bug known when the library
  began fixed.

0.1.0 is frozen: every file it stages is pinned by
`baseline/manifest-0.1.0.json`. Released from this repo by a tag
`starter-adapters-vX.Y.Z` on `main`
(`.github/workflows/release-starter-adapters.yml`).
