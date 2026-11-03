# @rich-rees/zdd

The mechanical half of [Zero-Drift Docs](https://github.com/rich-rees/zero-drift-docs):
derive the codebase metadata, render the agent + human indexes, and run the drift
checks. Deterministic — same source bytes in, byte-identical artifacts out — with
no dependencies beyond the Node stdlib and no LLM anywhere. The judgment-shaped
half (curating the glossary, ADRs, comments, map and blessings) lives in the `zdd` Claude
Code plugin's skills; both call this engine, so CI and the agent can never
disagree about what "fresh" means.

From 0.9.0 the engine is this package, on a new version line; before it was
`@rich-rees/zdd-engine`, 0.2.0 to 2.5.0 (decision 0042). The command line is
its contract, with one entry beside it: the adapter test kit (below). The
`exports` map opens `package.json` and the kit, and no other source file.

Since 0.14 the engine ships no adapter (decision 0048). A repo owns every
adapter it runs, in its `localExtractorDir`; the starters it can copy from
are a package of their own, `@rich-rees/zdd-starter-adapters`, which the
engine depends on nothing in.

## Commands

```
npx @rich-rees/zdd derive [--check] [--verbose]
npx @rich-rees/zdd render [--check]
npx @rich-rees/zdd lint [--merge] [--tempstate]
npx @rich-rees/zdd freshness [--base <ref>]
npx @rich-rees/zdd tally [--since <ref|date>] [--json]
npx @rich-rees/zdd detect --adapters=<dir> [--root=<dir>]
npx @rich-rees/zdd copy-set --adapters=<dir> [--extractors=<a,b>]
npx @rich-rees/zdd coverage [--json]
npx @rich-rees/zdd unread [--json]
npx @rich-rees/zdd gaps [--json]
npx @rich-rees/zdd preview --adapters=<dir> --extractors=<a,b,…> [--out=<empty dir>] [--json]
npx @rich-rees/zdd suite [--extractors=<a,b>] [--json]
npx @rich-rees/zdd test [--adapters=<dir>]
npx @rich-rees/zdd contract [--json]
```

- **derive** — run the configured extractors over the repo and write
  `zdd/metadata/` (one JSON record per route / surface / table / function /
  bucket / module). `--check` verifies instead of writing: stale, missing, or
  orphaned records exit 1. This is the blocking CI check for artifact #6.
- **render** — join the semantic map + metadata into the graph artifact
  (`zdd/graph.json`, schema `zdd-graph/1`), the agent index, the ADR index (and
  a harness ADR index when `paths.harnessAdrDir` and `paths.harnessAdrIndex`
  are set — decision 0033), the blessing index (`zdd/blessing-index.md`: one
  line per blessing in the blessing store — its trigger question, where the
  code is and why, house rules first under their app, and for an `extend`
  blessing who uses the code — read whole when choosing patterns), and the
  human index (the graph rendered by the configured viewer into one
  self-contained HTML file). `--check` verifies them all. Blocking CI check for
  artifacts #7–8.
- **lint** — deterministic curated-store lints: duplicate ADR numbers,
  supersession symmetry (a "supersedes" claim without the matching forward
  stamp fails), blessings (one file each in the blessing store,
  `zdd/blessings/`: a blessing that cites a superseded or non-existent ADR
  fails, and so does one that does not open with its trigger question, one
  whose `where:` is missing or names no file, one with no `kind:` or neither
  `copy` nor `extend`, one whose `applies-to:` names no app or package
  page, and one whose `importance:` is anything but `high`; a blessing or
  semantic-map page whose header writes a key twice, or opens a value with a quote and does not close it with the same one (0.13, decision 0047); a Blessings
  heading left on a semantic-map page fails too; one with
  no reason — neither an ADR nor "because …" — or over 300 visible
  characters, or citing a partially superseded ADR, or an unknown
  `first-built-in:` or header line, is a warning, and so are more high
  blessings than a fifth of the store), and the **pattern plan**
  (`zdd/patterns-plan.md`): with `--merge` — the CI step that gates the merge
  — its presence fails, and without it a warning, so a branch stays pushable
  mid-build. With `--tempstate` a tracked `TEMPSTATE.md` fails. See
  [docs/patterns.md](https://github.com/rich-rees/zero-drift-docs/blob/main/docs/patterns.md). It also lists the **unclaimed records** — every
  route, table, function and surface no feature slice links — and any record
  two slices claim, as warnings (a repo adopting ZDD starts with everything
  unclaimed); the unclaimed count sits in the human index header. With
  `claims.strict` both become failures; `claims.allowUnclaimed` exempts
  named records from the unclaimed check only, never from a double claim.
  With `--merge` it also reads the branch's commits since the base and
  **warns** (never fails) on a **ZDD record** the tally cannot fully read:
  a missing section, an unknown verb, a `turned` or `confirmed` line that
  does not say what would otherwise have happened. Shape only; absence of a
  record is never a warning, and a refused line is left out of the tally.
- **freshness** — advisory (always exits 0): semantic-map pages and blessings
  whose code a diff touches without updating them — a page's `resource:` path,
  a blessing's `where:` file, and the source behind every metadata record
  either links to. Markdown on
  stdout, made for `$GITHUB_STEP_SUMMARY`.
- **tally** — the evidence over time (always exits 0): reads every
  `ZDD record:` (and the 2.0–2.3 `Pattern record:`, as the blessings
  section) out of the current branch's git history and prints, per section
  (`glossary`, `adrs`, `blessings`, `map`, `comments`), how often an
  artifact `turned` a decision, `confirmed` one, was `reused` (map only) or
  `stored`; then the ADRs, glossary terms and blessings in the stores as
  they are now that no record in the range ever named; then every commit
  whose record had a shape problem (such a line is left out of the counts;
  the rest of its record still counts), and every store it could not read
  in full. `--since <ref>` bounds the range to `<ref>..HEAD`; a value that
  is not a commit must be an ISO date (`2026-09-01`, `2026-09-01T09:00Z`,
  year 1970–2099), read as UTC when it carries no offset, so the range is
  the same on every machine; git's looser date words (`yesterday`) are
  refused. `--json` prints the same as one object, for a host harness to
  copy. Deterministic: same history, stores and arguments in, same bytes
  out; no dates of its own, no judgment.
- **detect** — which adapters in a folder fit a repo (decision 0039), as one
  JSON object: each proposal with its plain-words evidence, options and the
  parts of the app it covers; coverage part by part and the parts nothing
  covers; the greenfield stack rules and the ready-made adapters by part.
  Each adapter answers for itself over one shared walk of the repo.
  `--adapters` is the folder (bootstrap passes the starter library's
  `adapters/`); without it, the repo's own `localExtractorDir`. It reads only
  that key of the config, never walks the adapter folder as source, and
  writes nothing.
- **copy-set** — what a copy of each adapter in a folder holds, as one JSON
  object: its files (its folder without `example/`, and the `_shared/` files
  its code and tests reach) and its `SUITE`, for the adapters asked for.
  Bootstrap asks it of the starter library before it copies a starter into
  an app (decision 0048), and of the app's own folder before a move. It
  writes nothing.
- **test** — runs the tests that travel with a folder's adapters,
  `<name>/test/*.test.mjs` (the repo's `localExtractorDir` by default), with
  `@rich-rees/zdd` resolved to this engine's test kit, so a repo with no
  `node_modules` runs them. Exits with the runner's status; a folder with no
  test to run fails.
- **coverage** — the automated half of the first map check: derives in
  memory (writes nothing) and prints, per record kind, the count, what its
  records link to, and by name the ones that link to nothing and the ones
  nothing links to.
- **unread** — what the adapters saw and could not read (decision 0048): derives
  in memory (writes nothing) and lists each item with its answer. `derive`
  prints the same items on every run, and writes them as records of kind
  `unread` under the metadata folder, which is what `lint` and the human index
  read. An item with no answer warns in `lint`, and fails it under
  `unread.strict`.
- **gaps** — the map's gaps (decision 0049): derives in memory (writes
  nothing) and lists every route, surface and background task that links to
  nothing, every table nothing links to, and any kind an adapter names in
  its `GAPS`, each with its answer. `lint` reads the same list from the
  written records: an open gap warns, and fails under `gaps.strict`. A gap
  answered as known shows in the agent index and the human index.
- **preview** — for a repo with no code yet: copies the named adapters'
  `example/` folders into a new temporary folder outside the repo, derives
  and renders there, and prints where the human index landed.

- **suite** — the standard suite (decision 0040) on the adapters this repo
  wrote itself (`localExtractorDir`), each on a copy of its own `fixture/`
  outside the repo. Five checks, numbered in the order they were added: the
  same bytes on another machine and on a second run; a gitignored path never
  read; a missing root nothing to inventory; commented-out code (every line
  of the fixture, by the adapter's `COMMENT` marks, which must classify
  every file the adapter reads) and a `fixture-trap/`
  folder never a record; every read through `io`. A failing check numbered
  at or below `suiteChecks` fails the run, a newer one warns. Since 0.14
  every adapter a repo runs is its own, a copied starter too; the starters
  pass the same suite in the starter library's tests.
- **contract** — the adapter contract this engine speaks and its table
  (below). Reads no repo.

Every command but `detect`, `preview`, `test` and `contract` locates the repo by walking up from
the working directory to the first folder holding `zdd/config.json` (override
with `--root=<dir>` / `--config=<file>`). `detect` and `test` read the folder
`--root` names (default: the working directory) and, without `--adapters`,
only the `localExtractorDir` of its config (or `--config`'s); `preview`
reads none, and refuses an output folder inside `--root`.

## Config (`zdd/config.json`)

The full schema ships with the plugin (`templates/config.schema.json`). The short
version:

| Key | Default | What it is |
|---|---|---|
| `extractors` | *(required)* | Adapters to run, composed per convention, each by its name in `localExtractorDir`. Since 0.14 a repo owns every adapter it runs (decision 0048): the starters it can copy are `supabase`, `nextjs`, `fastapi`, `react-router`, `components`, `expo-router`, the `background-*` readers (decision 0038), `external-services`, `supabase-js`, `supabase-py`, `sqlalchemy`, `generic`, and a copy keeps its name; a name the repo does not hold stops derive, pointing at the starter library and "upgrade ZDD". Names only, never paths |
| `extractorOptions` | — | Per-extractor source layout, keyed by name — `supabase`: `migrationNamespaces`, `externalBuckets`; `nextjs`: `appDir`, `apiPrefix`, `middlewarePath`, `authPatterns`, `refs`, `srcAliasRoot`; `supabase-js`: `roots`, `extensions`, `excludeDirs`, `excludeSuffixes`, `subscribeCalls`; `fastapi`: `roots`, `excludeDirs`, `appVar`; `react-router`: `routesFile`, `srcAliasRoot`; `components`: `roots`, `pageDirs`, `sharedDirs`, …; `expo-router`: `appDir`; each `background-*` reader: `roots`, `exclude`, `modes`, and `background-declared`: `entries` (listing `background-github-actions` is its opt-in); `external-services`: `services`, `ignore`, `roots` — all in `config.schema.json` |
| `agentIndex.budgetTokens` | `2000` | The agent index's size budget in approximate tokens; over it, `render` warns and names the fix (2.3) |
| `agentIndex.levels` | `1` | `2` lists the areas first and writes one file per area under `zdd/agent-index/`, each feature one hop away — for a repo whose feature list alone does not fit (2.3) |
| `claims.strictKinds` | `[]` | The opt-in kinds (`component`, `background-task`, `external-service`) that `claims.strict` also fails on; unlisted they warn (decision 0017) |
| `localExtractorDir` | — | Repo-relative folder of the repo's adapters (`<name>/index.mjs` or `<name>.mjs`, with `_shared/` beside them) — the one place config may point at code, never read as source, never the repo itself |
| `suiteChecks` | absent (every check warns) | How many of the standard suite's checks block for the repo's own adapters, 0 to 5 (decision 0040). Bootstrap writes 5 at a fresh install; "upgrade ZDD" raises it at once only where every adapter is a starter copy no one has changed, and otherwise `bootstrap.mjs adapters --raise` does, once they pass |
| `unread.strict` | `false` | `true`: `lint` fails on anything an adapter saw and could not read that has no answer; off, it warns (decision 0048). Bootstrap writes `true` at a fresh install; `bootstrap.mjs unread --raise` does on an upgraded repo, once every item has an answer |
| `unread.fine` | `[]` | Items marked fine once, each `{ id, what, why }` (`bootstrap.mjs unread --mark` writes them). A mark survives the code around the item moving and lapses when the item changes; a mark no item answers warns |
| `gaps.strict` | `false` | `true`: `lint` fails on a gap in the map with no answer; off, it warns (decision 0049). Bootstrap writes `true` at a fresh install; `bootstrap.mjs gaps --raise` does on an upgraded repo, once every gap has an answer |
| `gaps.fine` | `[]` | Gaps with nothing to map, each `{ id, what, why }` (`bootstrap.mjs gaps --fine` writes them). An id is the record's id and the direction: a mark lapses when the record is renamed; a mark no gap answers warns |
| `gaps.known` | `[]` | Gaps that cannot be mapped, each `{ id, what, why }` (`bootstrap.mjs gaps --known` writes them): shown in both indexes as parts of the map not to trust |
| `adapter` / `adapterOptions` | *(retired)* | The pre-1.0 single adapter, a bundle the engine shipped: refused since 0.14, naming "upgrade ZDD", which rewrites it |
| `name` | `"Codebase"` | Display name for the indexes |
| `repoBase` | `""` | GitHub `/tree/<branch>/` URL prefix for source links in the human index — http(s) only, refused otherwise |
| `nonAreaTags` | `[]` | Tags that are properties, not product areas (`react-flow`); a record inherits its area from its claiming feature's first tag not listed here. Shapes `graph.json`, so top-level (the old `viewer.nonAreaTags` still works, with a note) |
| `baseBranch` | `"main"` | The branch PRs merge into — freshness diffs and the changed-set highlight key on `origin/<baseBranch>` |
| `paths.*` | `zdd/…` | Where each artifact lives (glossary, adrDir, mapDir, blessingsDir, metadataDir, agentIndex, adrIndex, blessingIndex, humanIndex, graph, bundleDir; and, together or not at all, harnessAdrDir and harnessAdrIndex for a harness ADR set beside the application one — decision 0033), and the branch's pattern plan (`patternsPlan`, default `zdd/patterns-plan.md`). Keep the glossary under `zdd/`: a glossary moved to a root `glossary.md` collides with Matt Pocock's root `GLOSSARY.md` on case-insensitive disks (Windows, macOS) but not on Linux CI, so the two would disagree by machine |
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
`{ records, diagnostics, warnings?, unread? }` plus a `FACTS_KEY_ORDER` map, keyed to **one
convention** (the starter library's `adapters/` has one per stack it knows). A record's `refs` may carry verbs
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
Extractors are selected by name from the declared `localExtractorDir` —
never by path. A name it does not hold stops derive with the route across:
the starter library, and "upgrade ZDD", which copies an older release's
adapters in. The repo's adapter folder is never read as source. The plugin's
`extractor` skill scaffolds a new one.

### The adapter test kit

`import { ioFor, scanFor, trialRead } from "@rich-rees/zdd"` is all an
adapter's own tests import of ZDD (decision 0048): `ioFor(root, name)` is the
io derive hands an adapter; `await scanFor(root, adapters)` the scan
detection hands every adapter, skipping what each adapter in the folder
`adapters` names; `await trialRead(mod, root, adapters)` the adapter's own
answer to detect on it. It freezes with the contract at 1.0. To contribute one, see the
repo's [CONTRIBUTING.md](https://github.com/rich-rees/zero-drift-docs/blob/main/CONTRIBUTING.md).

### The adapter contract

Every adapter declares the contract it was written for, `export const
CONTRACT = 1`: a number of its own, raised only when what the core asks of
an adapter changes (decision 0040). `derive` stops on an adapter written for
a newer contract than the engine speaks, or one behind on a required step;
it warns on one that declares none; an optional step an adapter lacks is
said under `--verbose` only, and the adapter keeps working without it.
Before 1.0 the contract is open and stays at 1; from 1.0 every change is a
new row here, and "upgrade ZDD" interviews the adopter about the rows their
own adapters are behind on.

| Step | Since | Required | What the core asks |
|---|---|---|---|
| `CONTRACT` | 1 | yes | `export const CONTRACT = n`: the adapter contract the adapter was written for |
| `derive` | 1 | yes | `derive({ repoRoot, options, io })` returns `{ records, diagnostics }`; the same source bytes give byte-identical records |
| `io` | 1 | yes | every read and listing through the `io` the engine hands in, never `node:fs`, the environment or the network; a gitignored path is never read |
| missing source | 1 | yes | a configured root that does not exist is nothing to inventory: no records and a diagnostic, never an error |
| `COMMENT` | 1 | yes | `{ ".ext": "<line comment mark>" }` for every kind of file the adapter reads (`null` for one that takes no line comment, such as JSON), so the suite can comment out the fixture |
| `SUITE` | 1 | yes | a `fixture/` folder beside the adapter and `export const SUITE = { options, companions?, allowEmpty? }`; every starter carries its own |
| `FACTS_KEY_ORDER` | 1 | no | facts in a stable order, per kind |
| unresolved refs | 1 | no | `?table:<name>`, `?route:<url>`, … for another adapter's records; the core resolves them |
| data access | 1 | no | `?code:<file>#<function>` refs, and `data-access` records naming the tables a function reaches, joined on `resource[0]` and `facts.function` (decision 0037) |
| typed edges | 1 | no | `facts.edges`, a verb for a ref (decision 0016) |
| `warnings` | 1 | no | a list printed on every derive |
| `unread` | 1 | no | a list of `{ file, what }`, what it saw and could not read (decision 0048) |
| gaps | 1 | no | `GAPS`: `{ reachNothing: [kinds], reachedByNothing: [kinds] }`, further kinds of its own records that must link, beside the core's (decision 0049) |
| detection | 1 | no | `DETECTION` and `detect({ scan, proposed })` (decision 0039; every starter has it) |

## Viewers

The human index is produced by a **viewer** — one module exporting
`render({ graph, docs, changed, options, bundleName, repoBase })` and returning
the page as a string — selected by name from the registry in
`src/core/viewers/index.mjs`. `cytoscape` is the reference viewer (lanes / columns /
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

This package's tests are the core alone: pure-logic units, the CLI, the
stores and the viewers' plumbing, over a small stack-free fixture
(`test/fixture/`, a bundle with no code) and two test-only adapters in
`test/adapters/` that name no stack. The core with real adapters, every
golden and the stack fixtures live with the starters, in
`packages/zdd-starter-adapters/test/` (decision 0048): the composed
`[supabase, supabase-js, nextjs]` must reproduce v0.3.1's metadata byte for
byte there, and the `cytoscape` viewer must embed the same `BUNDLE` the
pre-registry renderer did. CI runs both.
