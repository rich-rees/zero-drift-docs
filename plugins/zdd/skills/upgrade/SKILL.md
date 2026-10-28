---
name: upgrade
description: "\"upgrade ZDD\" — move a repo that already uses Zero-Drift Docs to a newer release, as one guided flow in plain words: checks that everything ZDD needs is still here, checks for a newer release and moves the repo's lock on the user's yes (then a restart, or none when this machine is already there), or, on the release that is running, shows every file it will change with what it is and why, reads the repo's own instruction text against ZDD's rules sentence by sentence, asks one question at a time, writes, regenerates, and lists what to commit. Also run when the user says bootstrap --upgrade."
---

# zdd:upgrade — "upgrade ZDD"

The adopter is **choosing** to upgrade, so this is a guided flow: say what is
coming, ask, then act. **`scripts/bootstrap.mjs` is the only writer** — you
run it, relay its ledger in plain words, and never hand-write a file it writes.

**Who you are talking to.** Assume the person has never seen an upgrade and
may not be a developer. Every change is explained as it comes up — what the
file is, why it changes, who owns it — in the words the script's cards use
(**what / why / who / hand-edited**). Never the bare ledger: no hash ids, no
JSON, no "repair apply". **One question at a time**, each with a recommended
answer, its cost, and what saying no gives up; keep a running count; after a
question, stop and wait. Explain a term the first time it comes up: the
**lock** (one line in the repo's settings pinning it to one ZDD release), the
**catalogue** (this machine's downloaded copy of ZDD's release list, which a
restart moves to the lock), a **generated file** (written by ZDD from the
code, never hand-edited), an **extractor** (the part of ZDD that reads one
convention of the code).

**Where the script is.** Two directories up from this SKILL.md
(`<plugin>/skills/upgrade/SKILL.md` → `<plugin>/scripts/bootstrap.mjs`):

```sh
PLUGIN="$(cd "<skill-dir>/../.." && pwd)"          # POSIX
```
```powershell
$PLUGIN = (Resolve-Path "<skill-dir>\..\..").Path   # PowerShell
```

Run every command from the adopter's repo root. A repo with no
`zdd/config.json` has nothing to upgrade: offer the `bootstrap` skill instead.

## Step 1 — what ZDD needs, and is there a newer release?

```
node "$PLUGIN/scripts/bootstrap.mjs" preflight
```

The same check the install ran: Node.js 20+, `npx`, git and a repository,
github.com, the npm registry, and that the engine this release pins is there
to download — a new release is a new engine download, so a firewall or a
missing Node is named up front, not as a raw `npx` error mid-upgrade. Relay
the lines; on a MISSING line say it in your own words and **stop** (nothing
was written).

```
node "$PLUGIN/scripts/bootstrap.mjs" release-status
```

It names the newest release tag, the repo's lock, the release this session
runs, and the catalogue this machine holds — and, when the lock trails, says
which of two routes applies. (It reads the marketplace's tags over the
network; if that fails, say so and continue at step 2 with the running
release.) Relay its line in plain words: the lock is what the repo asks
every developer to run; the catalogue is this machine's downloaded copy of
ZDD's release list, which a restart moves to the lock; the running release
is what loaded when this session started.

- **A newer release exists, in Claude Code** (question 1 of about 5): tell
  the user what it is, link its release notes as printed, and ask **"Move
  this repo to vX.Y.Z?"** — or, when the repo has **no lock**, **"Lock this
  repo and move it to vX.Y.Z?"** (decision 0021). Recommended: yes, the
  notes say what it brings; cost: one PR and, for each teammate, two
  restarts; saying no keeps the repo where it is, which is a fine choice.
  On yes:

  ```
  node "$PLUGIN/scripts/bootstrap.mjs" upgrade --to=vX.Y.Z           # add --lock when there was no lock
  ```

  It checks the tag exists, then writes only the lock, and its **`next:`**
  note names the route for *this* machine:
  - **"no restart"** — this session already runs the target and the
    catalogue is there: carry **straight on to step 2** in this session.
  - otherwise — relay it word for word: **restart Claude Code; the first
    line of the next session names the commands that move this machine —
    run them, restart again; then say "upgrade ZDD" again.** Claude Code
    loads a new plugin version only at start, so the rest of the upgrade is
    the new release's own run. **Stop here** — this run is complete when
    the lock has moved and the user has the route.
- **The lock trails and the line says "no restart"** (this session already
  runs the newest release and the catalogue is there): ask the same
  question; on yes run `upgrade --to=vX.Y.Z` (add `--lock` when there was
  no lock), relay its ledger, and **carry straight on to step 2**.
- **A newer release exists, in Codex** (Codex reads no lock): ask **"Update
  ZDD to vX.Y.Z?"** On yes, the user updates the install from a terminal —
  `codex plugin marketplace upgrade zero-drift-docs`, then `codex plugin
  remove zdd@zero-drift-docs` and `codex plugin add zdd@zero-drift-docs` —
  starts a new session, and says "upgrade ZDD" again. **Stop here.**
- **No newer release**, or the user said no: continue at step 2 with the
  release that is running. If the repo already locks a newer release than
  this session runs, step 2 refuses and names the update — relay it.

## Step 2 — the plan, explained file by file

```
node "$PLUGIN/scripts/bootstrap.mjs" upgrade --plan
```

It writes nothing. Walk the person through it in plain words, in this order:

1. **Every file it would change**, with its card (what, why, who,
   hand-edited) — the config's version line, the engine pin in the CI
   workflow or the pre-push hook, `zdd/instructions.md` (ZDD's own file,
   rewritten to this release's text), the lock, `.gitattributes`. Say for
   each what moves and why in one sentence.
2. **The instructions file and the one line in `CLAUDE.md`.** On a repo from
   before 2.3 the plan replaces the old marked block in `CLAUDE.md` with one
   line, `@zdd/instructions.md`. Show `CLAUDE.md` **before and after** in
   plain words: the markers and the block go; one line stays, which makes
   Claude Code read ZDD's file at the start of every session as if it were
   written there; ZDD owns that file; **everything else in `CLAUDE.md` is
   theirs** and ZDD never edits it again. Then say what each new rule makes
   the AI do differently (the release's notes list them). For Codex users,
   `AGENTS.md` keeps a copy of the text between its two marker lines,
   because Codex cannot load a separate file.
3. **The notes** — this upgrade's changelog, a line or two per release the
   repo crosses; the "Upgrading to X.Y" sections below say what each one
   asks of you. Say them in plain words; the questions they raise are asked
   at step 4.
4. **Their own text that speaks to a ZDD rule.** The plan lists every
   paragraph or bullet in `CLAUDE.md` / `AGENTS.md`, outside ZDD's line or
   block, that speaks to one of ZDD's rules — never a whole section — and
   prints **what ZDD now says** beside it — only for the rules ZDD changed since the repo's pin, so text already read against an unchanged rule is not asked about again (2.4.1). The unit is the whole paragraph
   or bullet, shown in full: that is what `--drop` removes. For each one,
   read the two together and tell the person, in plain words: **same** (it
   says what ZDD's instructions already say — safe to remove, their call),
   **different** (it says something ZDD's rules do not cover — keep it), or
   **contradicting** (it tells the AI to do something ZDD's rules forbid —
   recommend removing or changing it, and say why). When a paragraph mixes
   a ZDD rule with a rule of their own, recommend editing it by hand rather
   than dropping it. The text is theirs; it is removed only on their word,
   and the heading goes with it only when the paragraph was all the section
   held.
5. **Retired names.** The plan lists every file in the repo that still uses
   a name a release retired (an old command, an old extractor key, the old
   release tag held somewhere ZDD does not write — a lock test, a setup
   guide), each with its replacement. Say where each is and what to change
   it to; these are the person's files, changed by hand.
6. **Blessings still on map pages** (2.5, decision 0032). The plan lists
   each one under `blessing <page>:<line>`, with the file it would become
   (`zdd/blessings/<name>.md`) and its header: `where:` (the code it points
   at), a **proposed `kind:`**, `applies-to:` when it sat on an app or
   package page, `first-built-in:` (the page it sat on), `adr:`. Show them
   as **one reviewable list** — never one question per blessing — and say
   in plain words what `kind` means: **copy** is "imitate this method in new
   code; the exemplar is not touched"; **extend** is "reuse this shared
   code, and if you extend it, retest everything that already uses it".
   The proposal is a guess from the wording ("extend", "reuse", "shared");
   recommend a kind for each one you would change, and why. A blessing that
   **stays on the map** (no question, or nothing in it that names a repo
   file) is named with the reason: those are fixed by hand after the move,
   and lint fails until they are. File names can be changed later with
   `git mv`; nothing else refers to them yet.

Then ask, **one question at a time** (questions 2 to 4 of about 5):

- **"Write these changes?"** — recommended yes; cost: one commit in a PR;
  saying no leaves the repo on its current release.
- If the plan says the repo has **no lock**: **"Lock it to this release?"**
  — recommended yes (decision 0021): every developer then runs the same
  release and the next upgrade starts at step 1; saying no leaves the repo
  floating on whatever each machine last fetched.
- If their own text was named: **"Which of these paragraphs or bullets
  shall I remove?"** — list them with your same / different / contradicting
  reading and a recommendation for each; they answer with the ones to drop.
- If blessings are listed: **"Move these blessings into `zdd/blessings/`,
  with these kinds?"** — recommended yes; cost: every map page that held
  blessings is edited (only the moved lines go) and one file per blessing is
  created, all in this PR. Saying no leaves them where they are, and lint
  fails until they move. They answer with any kind to change.

Read the answers back, then go on.

## Step 3 — write

```
node "$PLUGIN/scripts/bootstrap.mjs" upgrade [--lock] [--drop=<ids>] [--move-blessings=<token> [--kinds=<name>:<copy|extend>,…]]
```

`--lock` only on a yes to the lock question; `--drop=<id>,<id>` only with the
ids the plan printed for the sentences the user chose (each id binds the
sentence's text and its place: if it changed since the plan, the run refuses
— show the plan again); `--move-blessings=<token>` only on a yes to the
blessings question, with the token the plan printed and `--kinds=<name>:<kind>`
for each kind the person changed (the names the plan printed). The token
binds the run to the list the person read: if a blessing was added or
changed since, the run refuses before writing anything — show the plan again.
A name already taken in the store, a wrong `--kinds` name or a `paths` value
the engine would refuse also stops the run before its first write. Relay the ledger in plain words, as in step 2. Its
notes match the plan's.

## Step 4 — the questions the notes raise, one at a time

Work through every note that asks something, one question at a time, each
recorded by the script, never by hand (the remaining questions of about 5):

- **An opt-in extractor offered with evidence** (every upgrade, since 2.4.1: one that is off but whose evidence detection finds): say what the person
  would see ("the map would show which code depends on Sentry and Resend"),
  show the evidence and ask. On yes, a repair apply with the extractor added
  — `apply --answers=<file>` where the file is `{ "extractors": [<current…>,
  "<name>"], "extractorOptions": { "<name>": <options from the note> } }`.
  Repair mode keeps every other choice. Never add one the user did not
  confirm. Say the cost plainly: switching an extractor on adds records,
  which lengthens the agent index and the unclaimed list until the map
  claims them.
- **The finish prompt is unset** (1.1): ask (default yes), record it with a
  repair apply `{ "optIns": { "stop": true } }` (or `false`).
- **Realtime wrappers** (2.1): ask whether the app subscribes through a
  wrapper; record the call names with a repair apply — `{ "extractorOptions":
  { "react-router": { "subscribeCalls": ["live.onInsert"] } } }`, or for
  Next.js `{ "extractorOptions": { "nextjs": { "refs": { "subscribeCalls":
  [...] } } } }`. Options merge into what is there; nothing else moves.
- **The map's `services/` folder** (2.3): the note suggests renaming it to
  `external-services/`; it is theirs and is never renamed for them.

## Step 4b — the repo's own adapters (decision 0040)

Skip this step when the plan names no adapter of the repo's own (no note
"this repo's own adapters (…)"). Otherwise run:

```
node "$PLUGIN/scripts/bootstrap.mjs" adapters
```

It runs ZDD's standard suite on each of the repo's own adapters (on its
`fixture/`, never on the repo's code) and reads the adapter contract table
that ships in this release. For each adapter it prints:

- **Ask** lines: a step of the contract the adapter is behind on, with the
  question to put to the developer, word for word from the release (for
  example "ZDD can now show message queues; does your stack have any?").
  Ask them **one at a time**, in plain words, with your recommendation.
  An optional step never blocks: "no" is a fine answer, and the adapter
  keeps working without the new ability. A required one is a major release:
  the adapter must have it before the upgrade is done.
- **Fails check** lines: a check of the suite the adapter fails, with what
  to fix. "(warns only)" means CI only warns about it for now.

For every yes and every failing check, update the adapter through the
**extractor** skill: a fixture case and a test first (red), then the change
(green). Never edit an adapter without its test going red first. Raise the
adapter's `CONTRACT` to the contract the engine speaks once it has every
step it said yes to. Run `adapters` again until it says every adapter
passes, then:

```
node "$PLUGIN/scripts/bootstrap.mjs" adapters --raise
```

`--raise` writes `suiteChecks` in `zdd/config.json` up to the suite's count,
so every check blocks in CI from now on; it refuses while anything still
fails. Then do the check together (the coverage report and the human index,
as at bootstrap) for what the updated adapters now find.

Before 1.0 the contract stays at 1 and there is nothing to ask; the suite's
checks are the whole step.

Done when `adapters` says every adapter passes and `--raise` has run, or
the developer has chosen to leave a warning-only check for later (say so in
the commit's record).

## Step 5 — regenerate, check, and list the commit

Run the preflight once more — the engine pin may have moved, and a new pin is
a new download:

```
node "$PLUGIN/scripts/bootstrap.mjs" preflight
```

Then, with the engine this plugin pins:

```
npx -y @rich-rees/zdd@0.12.0 derive
npx -y @rich-rees/zdd@0.12.0 render
npx -y @rich-rees/zdd@0.12.0 lint
```

Show what moved in the generated artifacts and say why, from the notes (a
pin bump re-derives; the notes name the byte changes each release brings).
A red `lint` is the upgrade doing its job — the notes say which release
tightened what; fix it with the user in this PR.

The run is complete when you have listed every file to commit **in one PR**:
the ledger's changed files, the regenerated artifacts, and any repair-apply
changes. Close with the team's next step, in plain words: after the PR
merges, each developer's next session start prints one line naming the
commands that move their machine — they run them and restart. A ZDD defect
met on the way is explained to the developer in plain words, with a
ready-written report offered for ZDD's Discussions, in the "Bug reports"
category: https://github.com/rich-rees/zero-drift-docs/discussions (decision 0041; the repo has no Issues).

## Upgrading to 2.0 ("choose patterns")

- `render` writes a fifth artifact, `zdd/blessing-index.md`. Commit it in the
  upgrade PR, or `render --check` fails.
- The workflow's lint step becomes `lint --merge` (an owned workflow is
  migrated in place; another shape is named for the user to change by hand),
  so CI fails while a branch's `zdd/patterns-plan.md` exists.
- A blessing that does not open with its **trigger question** now **fails**
  `lint`. Propose the questions as **one reviewable file** (each blessing
  lint names, with the question it would answer, one line each), approved in
  one pass — never one question per blessing; change the map only on the
  user's word, in the upgrade PR.

## Upgrading to 2.1 (the front end, jobs and services)

- Four **opt-in** extractors — `components`, `expo-router`, `jobs`,
  `services` (called `external-services` from 2.3) — are offered by the plan with the detection evidence for this
  repo (step 4). Services are guessed by name: confirm or rename each, and
  ask which prefixes are not a service. Say the limit plainly: a service's
  `usedBy` is the files carrying its marker, never those reaching the
  provider through a settings object.
- `subscribes` edges: the Supabase client's own `.on("postgres_changes")`
  needs nothing; a wrapper must be named in `subscribeCalls` (step 4).
- A `*` in a scanned url no longer matches a fixed route segment: expect a
  `derive --check` diff on the bump; lint names the calls it could not place.
- With `claims.strict` on, `claims.strictKinds` decides whether the new kinds
  are governed; unlisted, they warn and never fail (decision 0017).
- 2.1.1 moves bytes where its fixes apply (schema-qualified tables,
  component descriptions, service links): re-derive and re-render.

## Upgrading to 2.2 (the guided upgrade)

- **The lock.** A repo bootstrapped before 2.2 may float with no lock; the
  plan says so, and step 2 asks. Locked, every developer runs the same
  release and the next upgrade starts at step 1.
- **The instruction block** gains the rules every adopter needs (a release or
  skew line leads the reply; generated-file conflicts are merged, committed,
  then regenerated; "update ZDD" is never delegated; a joining developer's
  install). Sections the adopter hand-wrote for the same rules are named in
  the plan — this is the release where most repos have some.
- **From a release before 2.2** there is no step 1 yet: the README's
  one-time hand step moves the lock (edit the ref, restart, run the commands
  the session-start line names, restart), then "upgrade ZDD" runs from step 2.
## Upgrading to 2.3 (plain words, the instructions file, external services)

- **The instructions file.** ZDD's rules move out of the marked block in
  `CLAUDE.md` into `zdd/instructions.md`, loaded by one line; the plan
  replaces the block with the line, once (step 2, point 2). `AGENTS.md`
  keeps a block. The text gains the rules this release's findings asked for:
  both install commands in order, the three cases a release line can mean,
  the merge-conflict steps, reuse-first in "choose patterns", and where a
  ZDD defect is filed.
- **External services.** The `services` extractor is now
  `external-services`, its records `external-service`: the plan renames the
  config keys, `claims.strictKinds` and the allow-list ids, and the map's
  links to the records; the next `derive` moves the records from
  `zdd/metadata/service/` to `zdd/metadata/external-service/`, so expect that
  in `derive --check` and the indexes in `render --check`. A hand-written
  `zdd/map/services/` folder is suggested for renaming, never renamed.
- **What git ignores is never source.** `derive` now skips every
  gitignored path (and `.claude/worktrees/`); a repo whose records named
  one sees those records change on the bump.
- **`.gitattributes`** gains one line pinning `zdd/` to LF, so Windows
  checkouts stop showing every generated file as modified.
- **Their own text** is read sentence by sentence against ZDD's rules, and
  retired names in their files are listed (step 2, points 4 and 5).

## Upgrading to 2.4 (the ZDD record)

- **Say it when ZDD changes a decision.** `zdd/instructions.md` (rewritten
  by this run) now asks the agent to print one `ZDD: …` line, at the moment
  and without stopping, whenever an artifact *turned* or *confirmed* a
  decision or showed code to *reuse* — with what would otherwise have
  happened. Reading is never a use, and nothing is said when nothing was
  used.
- **The ZDD record.** "update ZDD" writes those lines into the update
  commit's message as a `ZDD record:` with five sections (`glossary`,
  `adrs`, `blessings`, `map`, `comments`) in plain sentences; the `Pattern
  record:` it replaces is still read, as the blessings section. A squash
  merge loses the record unless the merger keeps the message; a merge
  commit keeps it.
- **The tally.** `npx -y @rich-rees/zdd@0.12.0 tally [--since <ref|date>] [--json]` counts,
  per section, how often an artifact turned, confirmed, was reused or
  stored, then names the ADRs, glossary terms and blessings in the stores
  that no record ever named.
- **`lint --merge` warns, never fails,** on a record it cannot fully read.
  No config-schema or metadata-contract change; `derive --check` and
  `render --check` do not move on the bump.

## Upgrading to 2.5 (blessings in a store of their own)

- **Blessings move out of the map** (decisions 0031, 0032): one file each
  in `zdd/blessings/` (`paths.blessingsDir`), named for its question, with
  a header — `where:` (the code to copy or extend; required), `kind:`
  (`copy` or `extend`; required), `applies-to:` (a house rule for an app),
  `first-built-in:` (the slice it came from), `adr:`. Step 2 lists them and
  step 3 moves them on the person's yes. The semantic map keeps its name and
  holds the groupings and the edges.
- **The blessing index says where and why** on every line, house rules
  first under their app; an `extend` blessing names who uses its code,
  worked out from the metadata. `render --check` moves on the bump, in up
  to four files — render and commit them in this PR: `blessing-index.md`
  (its new format), `graph.json` and `human-index.html` (the map pages'
  bodies lose their Blessings sections), and `agent-index.md` when a
  metadata link lived only inside a moved blessing (the feature no longer
  points at that record — link it from the feature page if it should).
- **New lint failures**, each cleared by the move or named by it
  (decision 0035, which is why 2.5 is a minor): a Blessings section left on
  a map page; a blessing with no `where:` or one naming no file; no `kind:`
  or a wrong one; an `applies-to:` naming no app or package page.
- **"choose patterns"** puts an `extend` blessing's users on the plan's
  *Retest* line, and **"update ZDD"** checks they were retested.
- **A harness ADR set, opt-in** (decisions 0033, 0034): decisions about how
  the team builds can live apart from the product's, in their own folder
  and index, on one number line. Upgrading splits nothing. When the person
  wants it — now or later — run `split-adrs --plan`: every ADR with a
  `Scope: harness` / `Scope: product` tag line is decided by it; propose a
  set for each of the others from what it decides, show the whole list as
  **one reviewable file**, and run the write with the plan's token and the
  answers (`--harness=<nums> --application=<nums>`). It moves the harness
  ADRs with their numbers, re-points links inside `zdd/`, and lists the
  ones outside (`CLAUDE.md`, `docs/`) for a hand edit. Then render and lint.
- No metadata-contract change and additive config keys only
  (`paths.blessingsDir`; `paths.harnessAdrDir` and `paths.harnessAdrIndex`
  on the split); `derive --check` does not move on the bump.

### Upgrading to 2.4.1 (findings from the 2.4.0 adoptions)

- **ZDD is named.** `zdd/instructions.md` (rewritten by this run) asks the
  agent to name each artifact as ZDD's — "ZDD blessing", "ZDD ADR", "the ZDD
  glossary" — in every `ZDD: …` line and whenever it finds or creates one,
  so a reader can tell the decision came from ZDD.
- **Merge conflicts in generated files** are regenerated mid-merge: derive,
  render, `git add`, commit the merge, then render once more and commit (on
  a rebase, `git rebase --continue` at each stop, then one more render).
  Never a checked-out side — the fence refuses that, and now says this
  route. **Two ADRs with one number** are renumbered by the later branch.
- **Upgrade itself**: an owned workflow's old header comment is rewritten;
  a lint step that passes `--merge` under its own condition is kept and
  named; every upgrade offers an opt-in extractor whose evidence it finds;
  the text pass asks only about rules changed since the repo's pin.
- **Background work**: a start command naming build output warns on every
  derive with the `jobs.entries` remedy. A committed Railway file is read by
  Railway too — commit one only if Railway should apply it.
- No config-schema or metadata-contract change; no generated bytes or exit
  codes move in `derive --check` and `render --check` on the bump (the new
  jobs warning is stderr only).

## Upgrading to 0.9 (a new line: a stack-free core and a catalogue of adapters)

- **A new line, a new package** (decision 0042). The engine is
  `@rich-rees/zdd`, numbered from 0.9.0; every release of the old one
  (`@rich-rees/zdd-engine`, 0.2.0 to 2.5.0) comes before it, whatever the
  numbers say. `zdd/config.json`'s `engine` pin becomes `release` in step 3,
  and every pin ZDD owns names the new package. A repo on the old line moves
  its lock to `v0.9.0` by hand once (README, "Upgrading"): an old release's
  check for a newer one looks for a higher number and never finds 0.9.0.
  Say this plainly in step 2 — "the numbers go down, but this is newer".
- **Data-access adapters are added** (decision 0037; Rich's call in ZDD-3
  slice 6). The route and screen adapters no longer read a database client:
  the plan names each data-access adapter detection proposes —
  `supabase-js`, `supabase-py`, `sqlalchemy` — with its evidence, and step 3
  adds it. `subscribeCalls` moves to `extractorOptions["supabase-js"]`. In
  step 5, open the human index with the person: routes now reach tables
  through data-access boxes, and a repo whose database layer is new to ZDD
  (raw SQL through SQLAlchemy) shows links it never had. Ask "does this
  look right, and is any link missing?" (`bootstrap.mjs check`, decision
  0039).
- **`job` is `background-task`** (decision 0038): `jobs` becomes one reader
  per platform file, from what detection finds; strict kinds, the
  allow-list and the map's `metadata/job/` links move with it.
- **The suite** (decision 0040): CI gains a `suite` step after lint. With no
  adapter of the repo's own, `suiteChecks` goes to every check; with some,
  step 4b runs.
- **Defects go to Discussions** (decision 0041): the instructions file now
  says so; the text pass flags the team's own text that still sends ZDD
  defects to Issues.
- **What moves on the bump**: `derive --check` moves wherever a route or
  screen reached a table (data-access records join them) and every
  `metadata/job/` record moves to `metadata/background-task/`;
  `render --check` then moves `graph.json`, the agent index and the human
  index. Commit them in the same PR.

## Upgrading to 0.10 (a Blessings peek in the human index)

- **The reference human index gains a Blessings button** (decision 0043;
  the default `cytoscape` viewer — `minimal` or a repo's own viewer may
  ignore the new data and show no change), beside
  Glossary and ADRs: every blessing in the store by trigger question, with
  its exemplar on GitHub, the app it applies to, who uses an `extend`
  exemplar, and the ADRs it cites. Every peek gains a filter box and a back
  history. In step 5, open the human index with the person and click
  Blessings: a blessing with no trigger question, or with a kind lint
  fails, shows here as it is — that is the store to fix, not the page.
- Nothing to answer, no config-schema or metadata-contract change. The pins
  move to 0.10.0.
- **What moves on the bump**: with the reference viewer,
  `render --check` moves `human-index.html` only (with another viewer,
  possibly nothing); `derive --check`, `graph.json`, the agent index and the blessing
  index keep their bytes. Commit it in the same PR.

## Upgrading to 0.12 (the first adopter's 0.11 findings)

- **An `extend` blessing names its users** (decision 0046): render reads
  which files import the exemplar's file, from the source. The blessing
  index's extend lines change, mostly from "users unknown to ZDD" or "used
  by nothing ZDD sees" to a list; any file ZDD cannot read says why. In
  step 5, say so in one line: the next plan's Retest line comes from them.
- **Code that reads the old config key is listed.** The retired-names list
  now names a property read of `zdd/config.json`'s `engine` key (a lock
  test, a session-start script, a fence) — the key is `release` since 0.9.
  These are the team's files: show each one with its line and the fix
  (read `.release`), and change it only on the developer's yes. A lock
  test asserting `<!-- zdd:begin -->` is absent, a line about AGENTS.md's
  block, and accepted ADRs are no longer listed.
- **A managed `zdd.yml` comment naming `@rich-rees/zdd-engine`** is
  rewritten to `@rich-rees/zdd` with the pin; the plan names it.
- Nothing to answer; no config-schema or metadata-contract change. The
  pins move to 0.12.0.
- **What moves on the bump**: `render --check` moves `blessing-index.md`
  (header line and extend users), `agent-index.md` and its area files and
  `adr-index.md` (the "Generated by" wording), and `human-index.html`
  (extend users); the rewritten `zdd/instructions.md` and Codex's
  `AGENTS.md` block change one phrase. `derive --check` and `graph.json`
  keep their bytes. Commit them in the same PR.

## Upgrading to 0.11 (blessings carry an importance)

- **A blessing may say `importance: high`** (decision 0045): often needed
  **and** costly to reinvent — the side peek every details page uses, so
  nobody builds a modal of their own. The blessing index lists it first in
  its section with a bold **high**; the reference human index pins it to
  the top of the Blessings peek with a chip; a plan that departs from it
  says why.
- **The upgrade never sets it, and asks nothing about it** (decision 0045
  point 8): marking a blessing high is a judgement made in the course of
  work — a session proposes it at "choose patterns", and "update ZDD"
  writes it on the developer's yes. In step 5, say in one line that the
  field exists and what it is for; touch no blessing file. Lint fails any
  value but `high` (case-exact) and warns when more than a fifth of the
  store (at least one) is high.
- Nothing to answer; no config-schema or metadata-contract change. The
  pins move to 0.11.0.
- **What moves on the bump**: with the reference viewer, `render --check`
  moves `human-index.html` (each blessing entry gains `importance`); the
  rewritten `zdd/instructions.md` and Codex's `AGENTS.md` block gain one
  clause on the high marker. `blessing-index.md` moves only once a blessing
  is marked high; `derive --check`, `graph.json` and the agent index keep
  their bytes. Commit them in the same PR.
