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
npx @rich-rees/zdd-engine lint [--merge] [--tempstate]
npx @rich-rees/zdd-engine freshness [--base <ref>]
```

- **derive** — run the configured extractors over the repo and write
  `zdd/metadata/` (one JSON record per route / surface / table / function /
  bucket / module). `--check` verifies instead of writing: stale, missing, or
  orphaned records exit 1. This is the blocking CI check for artifact #5.
- **render** — join the semantic map + metadata into the graph artifact
  (`zdd/graph.json`, schema `zdd-graph/1`), the agent index, the ADR index, the
  blessing index (`zdd/blessing-index.md`: one line per blessing in the map, its
  trigger question and its reason, app-level slices first — read whole when
  choosing patterns), and the human index (the graph rendered by the configured
  viewer into one self-contained HTML file). `--check` verifies all five.
  Blocking CI check for artifacts #6–7.
- **lint** — deterministic curated-store lints: duplicate ADR numbers,
  supersession symmetry (a "supersedes" claim without the matching forward
  stamp fails), blessings (a blessing in a semantic-map concept that cites a
  superseded or non-existent ADR fails, and so does one that does not open
  with its trigger question; one with no reason — neither an ADR nor
  "because …" — or over 300 visible characters, or citing a partially
  superseded ADR, is a warning), and the **pattern plan**
  (`zdd/patterns-plan.md`): with `--merge` — the CI step that gates the merge
  — its presence fails, and without it a warning, so a branch stays pushable
  mid-build. With `--tempstate` a tracked `TEMPSTATE.md` fails. See
  [docs/patterns.md](https://github.com/rich-rees/zero-drift-docs/blob/main/docs/patterns.md). It also lists the **unclaimed records** — every
  route, table, function and surface no feature slice links — and any record
  two slices claim, as warnings (a repo adopting ZDD starts with everything
  unclaimed); the unclaimed count sits in the human index header. With
  `claims.strict` both become failures; `claims.allowUnclaimed` exempts
  named records from the unclaimed check only, never from a double claim.
- **freshness** — advisory (always exits 0): semantic-map concepts whose code a
  diff touches without updating the concept — the `resource:` path, and the
  source behind every metadata record the concept links to. Markdown on
  stdout, made for `$GITHUB_STEP_SUMMARY`.

Every command locates the repo by walking up from the working directory to the
first folder holding `zdd/config.json` (override with `--root=<dir>` /
`--config=<file>`).

## Config (`zdd/config.json`)

The full schema ships with the plugin (`templates/config.schema.json`). The short
version:

| Key | Default | What it is |
|---|---|---|
| `extractors` | *(required, unless legacy `adapter`)* | Extractors to run, composed per convention: `supabase`, `nextjs`, `fastapi`, `react-router`, `components`, `expo-router`, `jobs`, `external-services`, `generic` (built-in; `services` is the 2.1–2.2 name of `external-services`, accepted for one more release), or a name from `localExtractorDir`. Names only, never paths |
| `extractorOptions` | — | Per-extractor source layout, keyed by name — `supabase`: `migrationNamespaces`, `externalBuckets`; `nextjs`: `appDir`, `apiPrefix`, `middlewarePath`, `authPatterns`, `refs` (+ `subscribeCalls`), `srcAliasRoot`; `fastapi`: `roots`, `excludeDirs`, `appVar`; `react-router`: `routesFile`, `srcAliasRoot`, `subscribeCalls`; `components`: `roots`, `pageDirs`, `sharedDirs`, …; `expo-router`: `appDir`; `jobs`: `roots`, `exclude`, `modes`, `entries`, `includeGithubActions`; `external-services`: `services`, `ignore`, `roots` — all in `config.schema.json` |
| `agentIndex.budgetTokens` | `2000` | The agent index's size budget in approximate tokens; over it, `render` warns and names the fix (2.3) |
| `agentIndex.levels` | `1` | `2` lists the areas first and writes one file per area under `zdd/agent-index/`, each feature one hop away — for a repo whose feature list alone does not fit (2.3) |
| `claims.strictKinds` | `[]` | The opt-in kinds (`component`, `job`, `external-service`) that `claims.strict` also fails on; unlisted they warn (decision 0017) |
| `localExtractorDir` | — | Repo-relative folder of repo-local extractors (`<name>.mjs` or `<name>/index.mjs`) — the one place config may point at code |
| `adapter` / `adapterOptions` | *(deprecated)* | The pre-1.0 single adapter; `nextjs-supabase` still expands to `[supabase, nextjs]` with a deprecation note |
| `name` | `"Codebase"` | Display name for the indexes |
| `repoBase` | `""` | GitHub `/tree/<branch>/` URL prefix for source links in the human index — http(s) only, refused otherwise |
| `nonAreaTags` | `[]` | Tags that are properties, not product areas (`react-flow`); a record inherits its area from its claiming feature's first tag not listed here. Shapes `graph.json`, so top-level (the old `viewer.nonAreaTags` still works, with a note) |
| `baseBranch` | `"main"` | The branch PRs merge into — freshness diffs and the changed-set highlight key on `origin/<baseBranch>` |
| `paths.*` | `zdd/…` | Where each artifact lives (glossary, adrDir, mapDir, metadataDir, agentIndex, adrIndex, blessingIndex, humanIndex, graph, bundleDir), and the branch's pattern plan (`patternsPlan`, default `zdd/patterns-plan.md`). Keep the glossary under `zdd/`: a glossary moved to a root `glossary.md` collides with Matt Pocock's root `GLOSSARY.md` on case-insensitive disks (Windows, macOS) but not on Linux CI, so the two would disagree by machine |
| `render.storeChanges` | `true` | Set `false` to render with no git dependency (drops the "what just changed" highlight) |
| `claims.strict` | `false` | `true`: every route, table, function and surface belongs to exactly one feature slice. `lint` fails on an unclaimed record not in `claims.allowUnclaimed`, on an allow-list id that names no record, and on a record two slices claim. Off: both are warnings |
| `claims.allowUnclaimed` | `[]` | Record ids that may stay unclaimed under strict: plumbing no feature owns (`["route:/health", "route:/ready"]`) |
| `agentIndex.summary` | `""` | The blockquote summary line at the top of the agent index |
| `viewer` | `"cytoscape"` | Which viewer renders the human index from the graph artifact: a name (`cytoscape`, `minimal`) or `{ "name", ...options }` — cytoscape takes `defaultFocus`, `authHubs` |

## Determinism contract

Same source bytes → byte-identical output: fixed key order (a hand-rolled
serializer, not `JSON.stringify` behavior), LF-only, no timestamps, no absolute
paths, and the changed-set highlight is a pure function of the *store files'*
git history only. `test/determinism.test.mjs` is the guard; the blocking
`--check` CI tier depends on this property.

## Extractors

An extractor is one module implementing `derive({ repoRoot, options, io })` →
`{ records, diagnostics, warnings? }` plus a `FACTS_KEY_ORDER` map, keyed to **one
convention** (see `src/extractors/`). A record's `refs` may carry verbs
through `facts.edges` (`uses`, `usedBy`, `calls`, `subscribes`, `reads`,
`writes`, `dependsOn`, `belongsTo` — decision 0016), which the graph keeps as
`verb` on the edge. `io` (since 1.3.0) is the engine's safe
reader, built fresh per extractor per run: `io.read` returns a regular file
inside the repo under a 1 MiB cap, and `io.walk` lists files, sorted, without
following links, on one shared entry budget. A local extractor cannot import
the engine, so this is how it reads safely. Config lists the extractors in use and the
deriver merges their records, then resolves cross-extractor refs — a record
emits `?from:<name>` / `?function:<name>` / `?route:<url>` / `?surface:<file>` /
`?at:<file>` for a target another convention owns, and the deriver turns those
into ids after the merge (a `*` in a url matches a route parameter only,
never a fixed word — decision 0019). Missing
source roots are "nothing to inventory", so a greenfield repo derives clean.
Extractors are selected by name from a static registry in `src/derive.mjs` or
from the declared `localExtractorDir` — never by path. The plugin's `extractor`
skill scaffolds a local one. To contribute one, see the
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
`test/fixture-fastapi/` (FastAPI + Supabase), `test/fixture-react-router/`
(FastAPI + a React Router route tree declared in code, one feature claiming
three of twelve records), `test/fixture-components/` (a web app, an Expo app
and a shared component kit over one API), `test/fixture-jobs/` (manifests
that run processes, a Railway file, a Procfile), `test/fixture-services/`
(Sentry and Resend by marker, Stripe undeclared) and `test/fixture-greenfield/`
(config only). `test/golden/` pins v0.3.1 output: the composed `[supabase, nextjs]` pair must
reproduce the adapter's metadata byte for byte, and the `cytoscape` viewer must
embed the same `BUNDLE` the pre-registry renderer did.
