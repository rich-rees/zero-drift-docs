# @rich-rees/zdd-engine

The mechanical half of [Zero-Drift Docs](https://github.com/rich-rees/zero-drift-docs):
derive the codebase metadata, render the agent + human indexes, and run the drift
checks. Deterministic — same source bytes in, byte-identical artifacts out — with
no dependencies beyond the Node stdlib and no LLM anywhere. The judgment-shaped
half (curating the glossary, ADRs, comments, and map) lives in the `zdd` Claude
Code plugin's skills; both call this engine, so CI and the agent can never
disagree about what "fresh" means.

## Commands

```
npx @rich-rees/zdd-engine derive [--check] [--verbose]
npx @rich-rees/zdd-engine render [--check]
npx @rich-rees/zdd-engine lint [--tempstate]
npx @rich-rees/zdd-engine freshness [--base <ref>]
```

- **derive** — run the configured stack adapter over the repo and write
  `zdd/metadata/` (one JSON record per route / surface / table / function /
  bucket / module). `--check` verifies instead of writing: stale, missing, or
  orphaned records exit 1. This is the blocking CI check for artifact #5.
- **render** — join the semantic map + metadata into the agent index, the ADR
  index, and the human index (the self-contained graph-view HTML). `--check`
  verifies all three. Blocking CI check for artifacts #6–7.
- **lint** — deterministic curated-store lints: duplicate ADR numbers,
  supersession symmetry (a "supersedes" claim without the matching forward
  stamp fails), and — with `--tempstate` — a tracked `TEMPSTATE.md` fails.
- **freshness** — advisory (always exits 0): semantic-map concepts whose
  `resource:` paths a diff touches without updating the concept. Markdown on
  stdout, made for `$GITHUB_STEP_SUMMARY`.

Every command locates the repo by walking up from the working directory to the
first folder holding `zdd/config.json` (override with `--root=<dir>` /
`--config=<file>`).

## Config (`zdd/config.json`)

The full schema ships with the plugin (`templates/config.schema.json`). The short
version:

| Key | Default | What it is |
|---|---|---|
| `adapter` | *(required)* | Stack adapter name, from the engine's static registry (`nextjs-supabase` today) |
| `name` | `"Codebase"` | Display name for the indexes |
| `repoBase` | `""` | GitHub `/tree/<branch>/` URL prefix for source links in the human index |
| `baseBranch` | `"main"` | The branch PRs merge into — freshness diffs and the changed-set highlight key on `origin/<baseBranch>` |
| `paths.*` | `zdd/…` | Where each artifact lives (glossary, adrDir, mapDir, metadataDir, agentIndex, adrIndex, humanIndex, bundleDir) |
| `adapterOptions` | — | Adapter-specific source layout (for `nextjs-supabase`: `appDir`, `apiPrefix`, `middlewarePath`, `authPatterns`, `migrationNamespaces`, `externalBuckets`, `refs`, `srcAliasRoot`) |
| `render.storeChanges` | `true` | Set `false` to render with no git dependency (drops the "what just changed" highlight) |
| `agentIndex.summary` | `""` | The blockquote summary line at the top of the agent index |

## Determinism contract

Same source bytes → byte-identical output: fixed key order (a hand-rolled
serializer, not `JSON.stringify` behavior), LF-only, no timestamps, no absolute
paths, and the changed-set highlight is a pure function of the *store files'*
git history only. `test/determinism.test.mjs` is the guard; the blocking
`--check` CI tier depends on this property.

## Adapters

An adapter is one module implementing `derive({ repoRoot, options })` →
`{ records, diagnostics }` (see `src/adapters/nextjs-supabase/`). Adapters are
selected by name from a static registry in `src/derive.mjs` — never by path, so
config can't import arbitrary code. To contribute one, see the repo's
[CONTRIBUTING.md](https://github.com/rich-rees/zero-drift-docs/blob/main/CONTRIBUTING.md).

## Tests

```
npm test        # node --test "test/*.test.mjs"
```

Pure-logic units plus end-to-end canaries and determinism checks against
`test/fixture/` — a miniature Next.js + Supabase repo exercising renames, FK
sweeps, triggers, wrapper pages, middleware auth, buckets, and module records.
