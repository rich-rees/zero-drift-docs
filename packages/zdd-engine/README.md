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

- **derive** — run the configured extractors over the repo and write
  `zdd/metadata/` (one JSON record per route / surface / table / function /
  bucket / module). `--check` verifies instead of writing: stale, missing, or
  orphaned records exit 1. This is the blocking CI check for artifact #5.
- **render** — join the semantic map + metadata into the graph artifact
  (`zdd/graph.json`, schema `zdd-graph/1`), the agent index, the ADR index, and
  the human index (the graph rendered by the configured viewer into one
  self-contained HTML file). `--check` verifies all four. Blocking CI check for
  artifacts #6–7.
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
| `extractors` | *(required, unless legacy `adapter`)* | Extractors to run, composed per convention: `supabase`, `nextjs`, `fastapi`, `generic` (built-in), or a name from `localExtractorDir`. Names only, never paths |
| `extractorOptions` | — | Per-extractor source layout, keyed by name — `supabase`: `migrationNamespaces`, `externalBuckets`; `nextjs`: `appDir`, `apiPrefix`, `middlewarePath`, `authPatterns`, `refs`, `srcAliasRoot`; `fastapi`: `roots`, `excludeDirs`, `appVar` |
| `localExtractorDir` | — | Repo-relative folder of repo-local extractors (`<name>.mjs` or `<name>/index.mjs`) — the one place config may point at code |
| `adapter` / `adapterOptions` | *(deprecated)* | The pre-1.0 single adapter; `nextjs-supabase` still expands to `[supabase, nextjs]` with a deprecation note |
| `name` | `"Codebase"` | Display name for the indexes |
| `repoBase` | `""` | GitHub `/tree/<branch>/` URL prefix for source links in the human index — http(s) only, refused otherwise |
| `nonAreaTags` | `[]` | Tags that are properties, not product areas (`react-flow`); a record inherits its area from its claiming feature's first tag not listed here. Shapes `graph.json`, so top-level (the old `viewer.nonAreaTags` still works, with a note) |
| `baseBranch` | `"main"` | The branch PRs merge into — freshness diffs and the changed-set highlight key on `origin/<baseBranch>` |
| `paths.*` | `zdd/…` | Where each artifact lives (glossary, adrDir, mapDir, metadataDir, agentIndex, adrIndex, humanIndex, graph, bundleDir) |
| `render.storeChanges` | `true` | Set `false` to render with no git dependency (drops the "what just changed" highlight) |
| `agentIndex.summary` | `""` | The blockquote summary line at the top of the agent index |
| `viewer` | `"cytoscape"` | Which viewer renders the human index from the graph artifact: a name (`cytoscape`, `minimal`) or `{ "name", ...options }` — cytoscape takes `defaultFocus`, `authHubs` |

## Determinism contract

Same source bytes → byte-identical output: fixed key order (a hand-rolled
serializer, not `JSON.stringify` behavior), LF-only, no timestamps, no absolute
paths, and the changed-set highlight is a pure function of the *store files'*
git history only. `test/determinism.test.mjs` is the guard; the blocking
`--check` CI tier depends on this property.

## Extractors

An extractor is one module implementing `derive({ repoRoot, options })` →
`{ records, diagnostics }` plus a `FACTS_KEY_ORDER` map, keyed to **one
convention** (see `src/extractors/`). Config lists the extractors in use and the
deriver merges their records, then resolves cross-extractor refs — a record
emits `?from:<name>` / `?function:<name>` / `?route:<url>` for a target another
convention owns, and the deriver turns those into ids after the merge. Missing
source roots are "nothing to inventory", so a greenfield repo derives clean.
Extractors are selected by name from a static registry in `src/derive.mjs` or
from the declared `localExtractorDir` — never by path. To contribute one, see the
repo's [CONTRIBUTING.md](https://github.com/rich-rees/zero-drift-docs/blob/main/CONTRIBUTING.md).

## Viewers

The human index is produced by a **viewer** — one module exporting
`render({ graph, docs, changed, options, bundleName, repoBase })` and returning
the page as a string — selected by name from the registry in
`src/viewers/index.mjs`. `cytoscape` is the reference viewer (lanes / columns /
explorer / force views, detail panel, glossary + ADR slide-outs; Apache-2.0-
derived, isolated in its own folder under `LICENSE-NOTICE.md`); `minimal` is the
no-library worked example. Viewers read `graph.json` and nothing else of the
engine's; the graph carries every node's `resource`, so source links come for
free. Contract and schema: the repo's
[CONTRIBUTING.md](https://github.com/rich-rees/zero-drift-docs/blob/main/CONTRIBUTING.md).

## Tests

```
npm test        # node --test "test/*.test.mjs"
```

Pure-logic units plus end-to-end canaries and determinism checks against
`test/fixture/` — a miniature Next.js + Supabase repo exercising renames, FK
sweeps, triggers, wrapper pages, middleware auth, buckets, and module records —
`test/fixture-fastapi/` (FastAPI + Supabase) and `test/fixture-greenfield/`
(config only). `test/golden/` pins v0.3.1 output: the composed `[supabase, nextjs]` pair must
reproduce the adapter's metadata byte for byte, and the `cytoscape` viewer must
embed the same `BUNDLE` the pre-registry renderer did.
