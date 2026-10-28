# 0046 — An extend blessing's users are read from the source's imports, at render

**Date:** 2026-10-28 · **Status:** accepted · **Origin:** ZDD-10, finding 1 of one adopter's move to 0.11.0 (Rich's calls: render reads it, not derive; Python as well as JavaScript and TypeScript). **Supersedes, in part:** [0031](0031-blessings-live-in-a-store-of-their-own-one-file-each-with-a-where-and-a-kind.md) point 5's "the records that use the record whose source file is the blessing's `where`" (the rest of 0031 stands).

## Context

An `extend` blessing says "reuse this shared code, and retest what uses
it". `choose patterns` copies the users from the blessing index onto the
plan's Retest line, and "update ZDD" checks they were retested. 0031 took
the users from the metadata: a record that references the exemplar's
records. On one adopter's Next.js app, 26 of 32 extend blessings came out
"users unknown" or "used by nothing". A `lib/` helper usually has no record
at all, and a record says what it references (routes, tables), never who
imports it. So `media-upload-client.ts`, imported by three components
through the `@/` alias, was "used by nothing", and the Retest line was
empty exactly where shared code most needed retesting. A file with two
records (a component and its module) was also counted twice.

## Decision

1. **Render reads who imports the exemplar's file, from the source.** Only
   for `extend` blessings with a `where`, and only when there is one. The
   human index and the blessing index carry the same users.
2. **The readers live with the adapters, the walk in the core.** The core
   knows no language (decision 0036). An adapter may export `IMPORTS`:
   `label`, `extensions`, `skipDirs`, `isTest(rel)` and
   `resolver(io, files) -> (rel, text) -> [files it imports]`. The
   JavaScript adapters (`nextjs`, `components`, `react-router`,
   `expo-router`, `supabase-js`) share `adapters/js/imports.mjs`. The Python
   ones (`fastapi`, `supabase-py`, `sqlalchemy`) share
   `adapters/python/imports.mjs`. A local adapter may export its own. Render
   loads the adapters the config selects, walks the repo once through an
   extractor-style `io` (never a path git ignores, never through a link,
   the same caps), and inverts the answer for the wanted files only.
3. **Each language resolves the way its toolchain does.**
   - **JavaScript and TypeScript:** relative imports; tsconfig/jsconfig
     `paths` (nearest config, relative `extends`, `baseUrl`, a child's
     `paths` replacing its parent's); workspace packages by their
     package.json `name` with `exports` or `main`; then extensions,
     `index` files, and `.js` written for `.ts`.
   - **Python:** relative imports; absolute imports from the nearest
     folder above the file that holds the first name; a package as its
     `__init__.py`, including every package on the way; `from m import x`
     where x is a submodule.
   - **Both:** a specifier in a comment or a string is not one, and a
     type-only import counts.
4. **One user per file.** A file is shown by the record that holds it (a
   route, a surface or a component before a plain module), else as its
   path. Users found through record references (0031) still count, merged
   by file. A record that holds several importing files (an iOS and an
   Android file of one screen) is one user: it is one thing to retest.
5. **Test code is a user only of test code.** A module's own tests are not
   what a change to it asks to retest. A test fixture's users are tests.
6. **Unknown says why.** When no configured reader claims the file's ending
   and no record holds it, the line says `users unknown to ZDD (it reads the
   imports of JavaScript and TypeScript files only)`, from the readers'
   labels. A file a reader claims is known, so no importer is "used by
   nothing ZDD sees" — unless the scan was cut short (a budget ran out, a
   file was too large or unreadable): then none found is `users unknown to
   ZDD (<why>)`, some found is `used by N or more: … (<why>)`, and render
   warns. A confident zero is never printed from a partial read.
7. **Every reader for an ending reads it.** Two readers claiming `.ts` (a
   catalogue one and a repo's own) both read each file, their answers
   joined; a reader shared by several adapters runs once.

## Consequences

- On that adopter, 31 of 32 extend blessings now name their users. The
  last is a GitHub Actions file, which says why it is unknown.
  `media-upload-client.ts` reads "used by 3: TiptapToolbar,
  JourneyDetailPanel, MediaPicker", and the count of 4 in the report was a
  text search that also matched a comment. The double-counted user is one.
- The blessing index's bytes change on the bump for every adopter with an
  extend blessing, and the human index's `docs.blessings[].usedBy` with it.
  `render --check` goes red until they re-render. No metadata or graph byte
  moves, and no new generated file.
- Render now reads source files, which it never did before. It reads them
  only when an extend blessing exists, once per render, under the
  extractor `io`'s budget, and warns if that budget runs out. Same bytes
  in, same index out.
- The grain is the file. A blessing naming a symbol (`(uploadMedia)`) is
  used by every importer of its file, used symbol or not.
- Adapter contract stays at 1. `IMPORTS` is optional, and an adapter
  without it changes nothing.

## Rejected

- **Derive writes a full import list into the metadata.** It is the cleaner
  layering, but it adds a generated file to every adopter's repo, which
  breaks their CI on the bump (decision 0002). That file would also churn
  on almost every PR that touches an import.
- **Derive records importers only for blessed files.** It is quieter, but
  it ties derive's output to the blessing store: adding a blessing would
  turn `derive --check` stale.
- **One import graph in the core.** It names languages in the core
  (decision 0036).
- **Counting each importing file of one record separately** (the
  campaign's CR-206). An iOS and an Android file of one screen would read
  as two users for one thing to retest.
