# Contributing to Zero-Drift Docs

Thanks for wanting to help. ZDD is small on purpose, and the most valuable
contributions are the ones the architecture is built for — it has a plug-in point
at **both ends** of the pipeline: **extractors** feed data in (one per
convention), and **viewers** render it out (one per visualization), with a stable
graph in the middle.

> **Status.** ZDD is `0.13.0` and public, on the new line that 0.9.0 started
> (decision 0042). The engine (`packages/zdd-engine`, on npm as
> `@rich-rees/zdd`) is what the plugin's skills and adopters' CI
> both run, and both contracts below — extractors and viewers — are the ones it
> executes today. Pull requests are welcome, and bug reports go to the repo's
> Discussions ("Bug reports"; decision 0041 — the repo has no Issues); the tests are the contract
> (`node --test` in `packages/zdd-engine` and over `plugins/zdd/test`), and CI
> runs both suites, and a browser smoke test of the human index, on every PR.

## The shape of a contribution

Everything here goes through the standard GitHub loop:

1. **Fork** this repo to your own account.
2. **Branch** for your change (`extractor/rails`, `fix/hook-windows-path`, …).
3. **Commit** small, conventional commits (`feat:`, `fix:`, `docs:`, `chore:`).
4. **Open a pull request** back here. It's a proposal — we'll review, discuss, and
   merge if it fits. You keep authorship; the maintainer decides what lands.

A merged change ships to everyone via the marketplace on the next version bump
(a new extractor is backward-compatible, so a **minor** bump).

## The prize: writing an extractor

An **extractor** is the only per-stack code in ZDD. It teaches the deriver how to
read **one convention** — Supabase migrations, a Next.js App Router tree, FastAPI
decorators, a Rails `routes.rb`… — and emit the **codebase metadata**: the
mechanical inventory of routes, tables, surfaces, functions, and the references
between them. Adopters list the extractors for their stack in `zdd/config.json`
(`extractors: ["supabase", "fastapi"]`) and the deriver runs them all into one
metadata set — so a stack *combination* is a config line, never a new module
([decision 0001](docs/decisions/0001-composed-extractors.md)). Everything else
(the curated artifacts, the indexes, the ritual, the CI check) is stack-agnostic
and already done.

**Start with the `extractor` skill** (`plugins/zdd/skills/extractor/`). Ask
your agent for an extractor and it interviews you about the convention,
scaffolds a local extractor with its fixture and tests, and walks the tests red
to green. The skill is the procedure; this section is the contract it follows.
An extractor lives at one of three tiers
([decision 0010](docs/decisions/0010-local-extractors-first-tier-engine-hands-them-io.md)):

1. **Local**, in the adopter's `localExtractorDir`. No fork, no publish; the
   default, and where every extractor should start.
2. **Registry**, a PR here that ships to everyone in a minor release. The
   skill's `upstream.md` lists what that PR must hold: fixture, tests,
   detection probe, schema block, README rows and release note.
3. **Fork**, your own scoped engine package, repinned everywhere, for a
   convention upstream will not take.

An extractor is a good contribution when it's **mechanical and deterministic**:

- It exports `derive({ repoRoot, options, io })` returning `{ records, diagnostics }`,
  plus a `FACTS_KEY_ORDER` map (per kind) so output is byte-stable. `options` is
  the adopter's `extractorOptions.<name>` object; document its schema in the
  module's leading comment.
- **Every read goes through `io`**, which the engine builds fresh for each
  extractor on each run (engine 1.3.0+). `io.read(rel, { maxBytes })` returns
  `{ ok: true, text }` for a regular file physically inside the repo under a
  1 MiB cap (`maxBytes` may lower it). Otherwise it returns
  `{ ok: false, code, reason }`, where `code` is `missing`, `not-regular`,
  `too-large`, `over-budget`, `unreadable` or (2.3) `ignored` — the path is
  gitignored, so it is not source and a clean clone has no such file; treat
  it as `missing`. `io.walk(relDir, onFile, { enter })` hands `onFile` every
  regular file as a sorted, repo-relative POSIX path, never one git ignores.
  It never follows a symlink, caps depth, skips `.git` by default and shares
  one entry budget across every walk, and returns `{ exists, truncated,
  skipped }`. `io.kind(rel)` (0.9) says what sits at a path without reading
  it — `missing`, `file` (regular, no link on any segment), `directory`,
  `symlink`, `linked` (a file under a linked folder) or `other` — for an
  adapter that probes spellings the way a bundler resolves an import.
  `io.isIgnored(rel)` (2.3) answers the same veto for an extractor
  that walks on its own; `.claude/worktrees/` counts as ignored everywhere. A path that is not
  repo-relative throws. A local extractor cannot import the engine under
  `npx`, which is why `io` is handed in. Decide structure on text with its
  comments and strings masked, so a commented-out declaration never becomes a
  record.
- Each **record** has: `kind` (`route` | `table` | `surface` | `function` |
  `bucket` | `module` | `component` | `background-task` | `data-access` | `external-service` | …), `id`, `title`, a one-sentence `description`
  *where mechanically extractable*, repo-relative POSIX `resource` path(s),
  `refs` (outbound references discovered by static scan), `facts` (convention-
  specific key–values), and `filename` (the metadata file, unique per kind).
- **Refs to another convention's records are emitted unresolved.** Your extractor
  cannot see the others' records, so it emits a resolved id only for targets it
  minted itself, and a `?`-prefixed lookup for the rest: `?from:<name>` (a table,
  else a bucket), `?table:<name>`, `?bucket:<name>`, `?function:<name>`,
  `?route:<url>` (`*` = one segment the scan could not read; it matches a
  route parameter only, never a fixed word, and a template hole typed as a
  union of literals is expanded before emission — [decision 0019](docs/decisions/0019-a-variable-segment-matches-a-parameter-never-a-fixed-word.md),
  `src/core/lib/template-paths.mjs`), and `?code:<file>#<function>` — the
  code a route or screen runs, which a data-access adapter's `data-access`
  records answer ([decision 0037](docs/decisions/0037-routes-reach-tables-through-a-data-access-record-joined-on-file-and-function.md):
  the referrer takes their tables; one in the referrer's own file is
  absorbed; a miss is silent). `?code:<file>#*` is every data-access record
  in the file, for a referrer whose unit is the whole file. A JS unit is a
  top-level declaration by its local name, or `<module>` for the module's
  own top-level code (`src/adapters/js/source.mjs`). Put the `?code:` ref
  under a verb (`edges.reads`) and the tables the data-access record leaves
  untyped take that verb. The deriver resolves them after the
  merge, drops misses with a diagnostic, and drops a record flagged
  `requireRefs: true` when nothing resolved (how a "module" record means "a file
  that references something"). See `src/core/lib/resolve-refs.mjs`.
- **A ref may carry a verb** ([decision 0016](docs/decisions/0016-typed-edges-are-additive.md)):
  `facts.edges` maps a verb to the refs it covers, resolved and unresolved
  forms alike — `{ "subscribes": ["?table:audit_events"] }`. Every id there
  is also a plain ref (the deriver makes the union), so `refs` keeps its
  meaning. The documented vocabulary is `uses`, `usedBy`, `calls`,
  `subscribes`, `reads`, `writes`, `dependsOn`, `belongsTo` (`usedBy` is how
  a record names another extractor's record that imports it — a component
  cannot write into a surface's refs); any letters-only verb is
  accepted and drawn plain. The graph's edge gains `verb`; a record with no
  `facts.edges` renders exactly as before.
- **A third channel, `warnings`, is optional** and prints on every derive,
  not only under `--verbose`: for what the branch that caused it should
  hear (the `external-services` extractor's "this env name matches no declared
  service"). Diagnostics stay the quiet channel. Neither ever fails derive.
- **Missing source is "nothing to inventory."** A configured root that does not
  exist yields no records and a diagnostic, never an error — greenfield repos
  adopt ZDD before any code exists. The one exception is a single named file
  a whole record kind hangs on, missing while code already sits beside it
  (`react-router`'s `routesFile`, [decision 0013](docs/decisions/0013-a-missing-routes-file-beside-code-fails-derive.md)).
  That fails, because "nothing to inventory" there would write every record
  away.
- **Determinism is the contract:** same source bytes in ⇒ byte-identical metadata
  out. No LLM, no timestamps, no environment-dependent values — the blocking CI
  check depends on this. Anything needing judgment is *not* metadata; it belongs in
  the semantic map, which links down to your records.
- It's selected by **name** from config, never by path — from the engine's
  catalogue (`src/adapters/<name>/`), or from the adopter's declared `localExtractorDir`
  (`<name>.mjs` or `<name>/index.mjs`, the one place config may point at code;
  local names may not shadow built-ins). Try a convention there first, with the
  skill's scaffold; propose it for the catalogue once it has run against a real
  repo.
- **It declares the contract it was written for and passes the standard
  suite** ([decision 0040](docs/decisions/0040-adapters-declare-a-contract-number-and-pass-one-standard-suite.md)).
  `export const CONTRACT = 1`, a number of its own that moves only when the
  table below does, and `export const COMMENT`, the line-comment mark for
  each kind of file it reads (`null` for one that takes none, like JSON; the
  suite fails a file the adapter read that COMMENT does not classify). The suite (the engine's `suite`, run on a copy
  of the adapter's fixture outside any repo) holds every adapter to five
  checks: byte-identical records on another machine and on a second run, a
  gitignored path never read, a missing root nothing to inventory,
  commented-out code (every line of the fixture, by `COMMENT`) never a
  record, and every read through `io` (a text scan for the honest mistake —
  `node:fs`, a process or network module, `require`, `process.env` — not a
  sandbox: a local adapter is the repo's own code, trusted like its tests,
  decision 0010). A catalogue adapter is listed, with
  its fixture and options, in `packages/zdd-engine/test/standard-suite.test.mjs`
  — a new one cannot ship without passing; a local one keeps its `fixture/`
  beside it and `export const SUITE = { options }`. A check added in a
  release goes at the end of the list and warns for adopters until "upgrade
  ZDD" has their adapters pass it (`suiteChecks`).

  | Step | Since | Required | What the core asks |
  |---|---|---|---|
  | `CONTRACT` | 1 | yes | `export const CONTRACT = n`: the adapter contract the adapter was written for |
  | `derive` | 1 | yes | `derive({ repoRoot, options, io })` returns `{ records, diagnostics }`; the same source bytes give byte-identical records |
  | `io` | 1 | yes | every read and listing through the `io` the engine hands in, never `node:fs`, the environment or the network; a gitignored path is never read |
  | missing source | 1 | yes | a configured root that does not exist is nothing to inventory: no records and a diagnostic, never an error |
  | `COMMENT` | 1 | yes | `{ ".ext": "<line comment mark>" }` for every kind of file the adapter reads (`null` for one that takes no line comment, such as JSON), so the suite can comment out the fixture |
  | `SUITE` | 1 | yes (an adopter's own) | a `fixture/` folder beside the adapter and `export const SUITE = { options, companions? }`; a catalogue adapter's fixture lives in ZDD's tests |
  | `FACTS_KEY_ORDER` | 1 | no | facts in a stable order, per kind |
  | unresolved refs | 1 | no | `?table:<name>`, `?route:<url>`, … for another adapter's records; the core resolves them |
  | data access | 1 | no | `?code:<file>#<function>` refs, and `data-access` records naming the tables a function reaches (decision 0037) |
  | typed edges | 1 | no | `facts.edges`, a verb for a ref (decision 0016) |
  | `warnings` | 1 | no | a list printed on every derive |
  | detection | 1 | no | `DETECTION` and `detect({ scan, proposed })` (decision 0039; every catalogue adapter has it) |
  | import reader | 1 | no | `IMPORTS`: `{ label, extensions, skipDirs, isTest(rel), resolver(io, files) }`, the repo files one file imports, read at render for an `extend` blessing's users (decision 0046; the JavaScript and Python adapters share `adapters/js/imports.mjs` and `adapters/python/imports.mjs`) |

  Before 1.0 the contract is open (it stays at 1 and may change without
  interviews). From 1.0 a change is a new row with `since` one higher and
  `CONTRACT` raised to match (a test holds them together), its interview
  question in `ask` (`src/core/lib/contract.mjs`); a new **required** step
  is a major release.
- **A catalogue adapter carries its own detection**
  ([decision 0039](docs/decisions/0039-detection-lives-in-each-adapter-bootstrap-builds-the-gaps-and-checks-together.md)):
  bootstrap asks every adapter whether it fits a repo, and is never edited to
  learn a stack. It exports `DETECTION` — `parts` (from
  `src/core/lib/parts.mjs`: routes, screens, components, database access,
  background tasks, external services), `order` (where its proposal sits),
  `optionShape` (which option keys hold a repo-relative path, a list of
  them, call names, or objects with a path key — bootstrap checks answers
  against it), and as it needs them `skipDirs`, `stack` (greenfield rules:
  a case-blind pattern over a stated stack entry, the options, where the
  entry's path goes), `companion`, `exampleClaims`, `example` (its
  `example/` folder's options, for the greenfield preview), `optIn` and
  `upgradeAdds` (`"X.Y.Z"`: an upgrade from an earlier release adds the
  adapter where detection proposes it and its `companion`s run — for a part
  an older release's adapters read themselves; decision 0037) —
  and `detect({ scan, proposed })`, returning `null` or `{ proposal:
  { evidence, options }, apps, questions }`. Evidence is plain words
  ("`APIRouter` under `api/routes`"). The `scan` is one walk of the repo
  shared by every adapter (six folders deep, gitignored paths never seen,
  under one io's caps): `files`, `read(rel)`, `json(rel)` and `memo(key,
  fn)`. The engine's `detect` prints what they all answer.

A stack without statically derivable structure keeps thinner metadata and a
larger semantic map — the *contract* is fixed, not the coverage. When in doubt,
model your extractor on `supabase` (replay from files), `nextjs` (a file-tree
convention with a refs scan) or `fastapi` (decorators, textual); `generic` is the
minimal worked example.

## The other prize: writing a viewer

The **human index** (`zdd/human-index.html`) is a rendering of the same graph the
extractors produce. `render` first writes that graph as its own artifact —
**`zdd/graph.json`, schema `zdd-graph/1`** — and then hands it to a **viewer**,
which produces the page. It is *a* rendering, never *the* one: the spec treats it
as a machine product, and better visualizations are exactly the extensibility the
design reserved.

The graph artifact is the whole input. `nodes` are the metadata records and the
semantic-map concepts, each with `id` (bundle-relative path minus extension),
`layer` (`metadata` | `map`), `type` (the display type — `API Endpoint`, `Table`,
`Feature`, …), `title`, `description`, `resource` (the repo-relative source path
that becomes the GitHub link), `tags` (the product-area bucket — shaped by the
top-level `nonAreaTags` config, never by a viewer option, so the artifact is the
same bytes whichever viewer renders it), a markdown
`body`, `recordId` on metadata nodes and `auth` on routes that carry it. `edges`
are `{ source, target }` pairs — every resolved ref and every map link, deduped,
no self-edges. Because the boring plumbing — node identity, edges, source links —
is defined once in the graph, viewers inherit all of it for free and compete
purely on the visualization.

A viewer is one module exporting
`render({ graph, docs, changed, options, bundleName, repoBase })` and returning
the page as a string. `graph` is exactly what was written to `graph.json`; `docs`
is `{ glossary, adrs, blessings }` (the store text, for viewers that embed it;
`blessings` comes ready-read — exemplar, app, users, cited ADRs, and
`importance` (`"high"` or null, high entries first) — so no viewer
parses the store, [decision 0043](docs/decisions/0043-viewers-get-the-blessing-store-ready-read.md), [0045](docs/decisions/0045-blessings-carry-an-importance-high-or-nothing-kept-scarce.md)); `changed` is
the latest-store-change highlight; `options` is whatever the adopter put in
`viewer` besides `name`, plus the resolved top-level `nonAreaTags` whenever it
is non-empty (your area model should exclude the same tags the graph did). A viewer is a good contribution when it honours the
viewer contract (the equivalent of "determinism" for extractors):

- **Self-contained and safe to publish.** The human index gets *hosted* — a single
  self-contained file, no external network calls, and **no secrets**, safe to leak
  regardless of who sees it. A viewer that phones home or embeds a key is
  disqualified. **Source-derived text is untrusted**: descriptions, bodies and the
  store text come from code comments, docstrings and markdown anyone with commit
  access wrote, so it is escaped or sanitised before it reaches the DOM — the
  reference viewer routes every markdown parse through `safe-marked.js` and
  builds every other source-derived string as a DOM text node, and the
  `minimal` viewer escapes everything it prints. "No network calls" includes
  images: an `<img>` in a docstring is a request the moment the panel opens, so
  markdown images render as their alt text. Source links are built only from an
  http(s) `repoBase` and a bare relative `resource` — the renderer refuses
  anything else up front, and a viewer still treats both as untrusted.
- **Deterministic** — identical inputs produce byte-identical output. No dates, no
  random ids, no environment-dependent values; the blocking `render --check` in
  CI compares bytes.
- **Consumes the documented graph schema** — it reads the published node/edge model
  above, and never reaches around it into engine internals.
- **License-compatible libraries.** The reference viewer vendors its libraries with a
  license notice; anything you bring (D3, a framework, …) must carry a compatible
  licence and its notice. The `cytoscape` viewer is Apache-2.0-derived and kept
  in its own folder for that reason; the engine outside `src/core/viewers/cytoscape/`
  is MIT and stays that way.

How a viewer becomes part of the product: like extractors, viewers are selected by
config (`"viewer": "minimal"`, or `{ "name": "cytoscape", ...options }`), so a
merged viewer ships as a **selectable option** in the registry —
`packages/zdd-engine/src/core/viewers/index.mjs`, one line per viewer — a minor version
bump, live for each adopter when their repo moves its lock to that release. Model yours on
`src/core/viewers/minimal/` (the smallest honest viewer: no libraries, nodes grouped by
type, edges listed) and read `src/core/viewers/cytoscape/index.mjs` for how a viewer
builds its own private data shape from the graph.

The reference viewer is also clicked in CI: `test/browser/` renders the
engine's fixture and drives `human-index.html` in headless Chromium — the
header buttons, the peek's filter and back history, a blessing to a node and
back, a hostile blessing, the empty store; any page error, dialog or request
that leaves the page fails the flow. It lives outside the published
package, so the engine stays dependency-free
([decision 0044](docs/decisions/0044-browser-tests-live-outside-the-engine-package.md));
run it with `cd test/browser && npm ci && npx playwright install chromium && node --test "*.test.mjs"`
(on a clean Linux machine, `npx playwright install --with-deps chromium` also
installs Chromium's system libraries).
A change to the reference viewer's behaviour adds or changes a flow there.

## Other welcome contributions

- **Skills** — improvements to `load` / `patterns` / `update` / `bootstrap` / `extractor`, or new ones that
  serve the ritual (not project-specific workflow — ZDD ships mechanism, not
  opinions about how *your* team plans work).
- **Engine** — determinism fixes, better ref resolution, the renderer, the checks.
- **Detection** — a catalogue adapter's own `DETECTION` and `detect()`
  (above; decision 0039): what evidence says it fits, what options that
  implies. Bootstrap is never edited to learn a stack. Prove it in the
  engine's suite (`packages/zdd-engine/test/detect.test.mjs`); the plugin's
  tests drive bootstrap against what the engine answers.
- **Docs** — clearer setup, worked examples, fixing anything that misled you.

## What ZDD deliberately does *not* want

- **Docs content or rationale for a specific project.** The plugin ships the machine
  that makes `zdd/` folders — never anyone's glossary, ADRs, or map.
- **Workflow/process opinion** tied to a particular tracker, host, or CI vendor. Keep
  contributions stack- and tool-neutral.

## Ground rules

- Be kind and assume good faith. Reviews are about the code, never the person.
- Keep PRs focused — one logical change each.
- If you're proposing something big (a new artifact, a change to the ritual), open
  an issue first so we can agree the shape before you build it.

Questions? Open an issue. Thanks for helping keep documentation honest.
