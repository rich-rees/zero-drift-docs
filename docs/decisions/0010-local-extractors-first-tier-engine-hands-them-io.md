# Local extractors are the first tier; the engine hands them `io`

**Date:** 2026-09-28 · **Status:** accepted · **Origin:** CAS-65 — the "add your own stack" story for the public plugin. Designing the `extractor` skill showed that a local extractor could not honour the hardening checklist it was about to teach: the engine's safe-read helpers were unreachable from the adopter's repo. **Supersedes, in part:** [0003](0003-kernel-and-opt-ins.md) point 5 ("the script is the only writer") — a second script now writes adopter-owned files, by the same rule.

An extractor is called `derive({ repoRoot, options, io })`. `io` is a
frozen object the engine builds fresh for each extractor on each run
(`src/lib/extractor-io.mjs`), with two operations and nothing else:

- `io.read(rel, { maxBytes })` returns `{ ok: true, text }` for a regular
  file physically inside the repo — no symlink on any segment — under a
  1 MiB cap that `maxBytes` may lower but never raise; otherwise
  `{ ok: false, code, reason }` with `code` one of `missing` (nothing at
  the path — the only code that means absence), `not-regular`, `too-large`,
  `over-budget` (the io has read its 64 MiB total) or `unreadable` (present,
  but the read failed). The file is opened without following a final link
  and its identity compared with the checked path, so a swap between check
  and read is refused.
- `io.walk(relDir, onFile, { enter })` hands `onFile` every regular file
  under `relDir` as a repo-relative POSIX path, in one global order: full
  paths sorted by code unit, so `001.sql` precedes `001/a.sql`, as a replay
  of numbered files expects. Symlinks are never followed, depth is capped,
  `.git` is vetoed by default, directories are read entry by entry against
  one entry budget shared by every walk on the `io`, and a directory the
  budget runs out inside yields nothing (never a filesystem-order subset).
  A missing root is `exists: false` — nothing to inventory.

A path that is not repo-relative POSIX (absolute, `..`, `:`, a backslash, a
control character) throws, and derive names the extractor. Masking
comments and strings stays in each extractor: it is language-specific, and
the skill's checklist carries it.

**An extractor that needs `io` fails loudly without it.** The scaffold the
`extractor` skill writes begins by throwing, naming engine 1.3.0 and
`zdd:bootstrap --upgrade`, when `io` is absent — never by returning empty
records, which `derive --check` would accept once committed and so write
the drift in as the new truth.

Adding the field breaks no existing extractor (built-ins may ignore it), so
this is a minor engine version: 1.3.0.

## Consequences

- **The `extractor` skill scaffolds a local extractor by default**
  (`localExtractorDir/<name>/index.mjs` with its fixture and a `node --test`
  file) and a registry contribution only on request. Tier one is
  adopter-owned, no fork, no publish; tier two is a PR here and a minor
  bump; tier three is a fork with its own scoped package and repinned
  `ENGINE_PACKAGE`.
- **A second writer of adopter-owned files, by the same rule.**
  `plugins/zdd/scripts/scaffold-extractor.mjs` writes the local extractor's
  skeleton and its config lines (`localExtractorDir`, the `extractors`
  entry, `extractorOptions.<name>`). It writes by bootstrap's rules:
  everything is validated before the first write, each file is created
  exclusively and never overwritten, the config is replaced atomically, a
  failed run removes exactly the files it created, and the report uses the
  same `Ledger` wrote / kept / skipped shape.
  Decision 0003's split still holds (the skill asks, the script writes), and
  now has two scripts. The parsing logic is the agent's, written after the
  scaffold like any other code in the repo.
- **Local extractors run with the adopter's own privileges, and that is
  not a hole** (review CR-026, closed no-change-needed). `derive` imports
  the module in-process, and `io` offers safety without enforcing it. The
  trust boundary is commit access: anyone who can change a local extractor
  can already change the repo's tests, its package scripts or the CI
  workflow, all of which run with the same rights. ZDD's CI template runs
  on `pull_request` with `contents: read`, so a fork's pull request runs
  without secrets, as GitHub intends. The scaffold's generated tests catch
  the honest mistakes (importing `fs`, reading `process.env`,
  environment-dependent output). They do not claim to stop deliberate
  evasion, and a sandbox would protect only against an adopter CI that is
  already unsafe for every other script it runs.
- **Detection probes belong to the registry path only.** Bootstrap never
  runs adopter code: a local extractor is named in the adopter's config, so
  there is nothing to detect. Bootstrap's "map-only" line points at the
  skill instead.
- `io` is public surface. Changing the shape of what `read` or `walk`
  returns is a major version; adding an operation is a minor one.
- The built-ins may move onto `io` later; their own readers stay until
  then, and the two must not drift in what they refuse.

## Why / rejected alternatives

- **Export the helpers as a package path (`@rich-rees/zdd-engine/kit`).**
  Under `npx`, the adopter's module resolves bare specifiers from the
  adopter's repo, which has no copy of the engine; it would work only if
  every adopter added the engine as a dependency — npm forced onto a Python
  or C# repo. Rejected.
- **Have the scaffold copy a helpers file into the adopter's folder.** Works
  with no engine change, but the copy never receives an engine fix: the
  frozen-copy problem PressPlay already carries (its ADR-0113). Rejected.
- **No helpers; the checklist says "do it yourself".** The cheapest, and the
  exact trap CAS-63's eleven verification rounds showed a careful author
  falls into. Rejected.
- **Let a local extractor export a `detect()` bootstrap calls.** Symmetric
  with the built-in probes, but bootstrap would run adopter code at install,
  before any config exists, for a guess the adopter's config makes
  unnecessary. Rejected.
