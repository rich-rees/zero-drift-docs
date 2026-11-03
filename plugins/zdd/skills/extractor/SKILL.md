---
name: extractor
description: Give this repo an extractor (an adapter) for a convention it does not read yet — by copying a starter from ZDD's starter library when one fits or almost fits, else by scaffolding one from nothing in this repo (no fork, no publish); a starter-library contribution only on request. Interviews the convention from a sample of the source, runs a script that writes the module, tests, fixture folder and config wiring, then walks the tests red to green and derive, render, lint. Use when bootstrap reported map-only, or someone asks for an extractor for their stack (MySQL, Rails, C# controllers, Vue Router…).
---

# zdd:extractor — teach ZDD one more convention

An **extractor** reads one convention (SQL migrations, a route tree,
controller attributes) and emits the **metadata records** the indexes are
built from. You are the conversation and the author of the parsing logic;
**`scripts/scaffold-extractor.mjs` writes the skeleton and the config
wiring** — never hand-write the files it writes.

Three tiers, in the order you offer them (decisions 0010 and 0048):

1. **Local** — `localExtractorDir/<name>/` in this repo, adopter-owned: no
   fork, no publish, live on the next `derive`. **The default**, by one of
   two routes:
   - **Copy a starter** (the copy route, decision 0048 point 3) when ZDD's
     starter library has one for the convention, or one that almost fits:
     it is copied in with its tests and its suite fixture and is this
     repo's own from then on, to change through Steps 4 and 5 below. Steps 1
     and 2 still read the sample, to say what the starter gets right and
     what it must change.
   - **Scaffold from nothing** (Steps 1 to 6) when no starter is close.
2. **Starter library** — a PR adding the adapter as a starter, released in
   the library (`@rich-rees/zdd-starter-adapters`) so later repos can copy
   it. Only when the user asks, or once a local extractor has proven itself
   on a real repo. It never changes a repo that already holds a copy.
3. **Fork** — the user's own copy of the library. Only when upstream will
   not take it.

Tiers 2 and 3: read [upstream.md](upstream.md) and follow it instead of the
steps below.

**Where the script is.** Two directories up from this SKILL.md
(`<plugin>/skills/extractor/SKILL.md` → `<plugin>/scripts/scaffold-extractor.mjs`):

```sh
PLUGIN="$(cd "<skill-dir>/../.." && pwd)"           # POSIX
```
```powershell
$PLUGIN = (Resolve-Path "<skill-dir>\..\..").Path   # PowerShell
```

Run everything from the adopter's repo root.

## Step 0 — preconditions

- `zdd/config.json` exists. If not, stop: adopt first with `zdd:bootstrap`.
- The config's pin hands extractors `io`: any `release` (the line from 0.9,
  decision 0042) does; an old-line `engine` pin must be **1.3.0 or later**.
  Older, or both keys: say "upgrade ZDD" first. Since 0.14 every adapter is the repo's own and may take any name; give a new one a name of its own, never a starter's, so a starter copied in later cannot meet it. A scaffolded
  extractor stops `derive` on an older engine by design.
- The convention has no starter: `supabase` (SQL migrations),
  `nextjs` (App Router), `fastapi` (decorators), `react-router` (a route tree
  in one file), `components` (React / React Native components),
  `expo-router` (an Expo Router folder tree), the `background-*` readers
  (workers, schedules and queues, one per platform file), `external-services` (third-party systems by declared
  marker). If one fits, or almost fits, take the copy route below instead
  of Steps 1 to 3.

Done when all three hold.

## The copy route — a starter brought in

Ask once: "The starter library has an adapter for this (`<starter>`). Shall
I copy it into the repo, with its tests, to start from?" Recommended yes
when it fits or nearly fits; cost: its code and tests in the repo, now
yours to keep; saying no means building from nothing (Steps 1 to 6). On a
yes, a repair apply with the starter added — `apply --answers=<file>`
where the file is `{ "extractors": [<current…>, "<starter>"],
"extractorOptions": { "<starter>": { <options> } } }`, run with the
bootstrap script beside this one (`$PLUGIN/scripts/bootstrap.mjs`). It
copies the starter, the shared code it reaches into
`localExtractorDir/_shared/`, and any companion its suite fixture needs, and
records the version in `localExtractorDir/starters.json`. Run its tests
(`npx -y @rich-rees/zdd@0.13.0 test`) and `derive`; then, when it only
almost fits, change it through Step 4 (a fixture case for what it gets
wrong, red) and Step 5 (green). A changed copy is never overwritten by a
later fix: `bootstrap.mjs starters` shows it as changed, and a fix the
library notes for it is applied by hand, tests first.

To keep the original beside a changed one, give the copy a name of its own:
move its folder (`git mv zdd/extractors/<starter> zdd/extractors/<name>`),
rename it in `extractors` and `extractorOptions`, and in `starters.json`
delete its entry under `adapters` and every key under `files` that starts
with `<starter>/` — it is no starter copy any more. Leave the `_shared/`
keys: a later move keeps every shared file an adapter in the folder still
reaches, yours included.

## Step 1 — read a sample

Find the files that declare the thing — a glob and a grep, then read up to
five of them (all of them when there are fewer) (whole when under about 200 KB; the first and last few hundred
lines of a larger one). Note the **declaration shape** (the syntax that makes a
route a route or a table a table), where values sit (a quoted template, an
identifier), how nesting and prefixes combine, and what comments and strings
nearby could impersonate a declaration.

Done when you can point at the exact lines each record would come from.

## Step 2 — the design interview

Six questions, **one at a time**, each with your proposed answer drawn from
the sample. Wait for each answer.

1. **Evidence** — what file layout or code shape declares it? One line; it
   becomes the module's header comment.
2. **Record kinds** — `route`, `table`, `surface`, `function`, `bucket`,
   `module`, or a new lowercase kind when none fits.
3. **Ids and titles** — spell them the way the built-ins do, so refs from
   other extractors find them:

   | Kind | Id | Title | Facts worth keeping |
   |---|---|---|---|
   | route | `route:/api/orders/{id}` — one record per path, `{param}` segments | the path | `methods` (sorted), `dynamicSegments` |
   | table | `table:<namespace>/<name>` | `<name> (<namespace>)` | columns, keys |
   | function | `function:<namespace>/<name>` | `<name>()` | |
   | surface | `surface:/orders/{id}` | the path | `dynamicSegments` |
   | module | `module:<repo-relative file>` | the file | |

4. **Refs** — which records does it point at, and does it mint them itself?
   A target it mints gets a resolved id; any other target is **unresolved**:
   `?table:<name>`, `?from:<name>` (table else bucket), `?bucket:<name>`,
   `?function:<name>`, `?route:<url>` (`*` = one wildcard segment). The
   engine resolves them after every extractor has run and drops misses and
   ambiguous names with a diagnostic.
5. **Shaped like** — which built-in to model on:

   | The convention | Shaped like | Emits |
   |---|---|---|
   | Raw Postgres / MySQL / SQLite migrations, Flyway, Liquibase SQL | `supabase` (replay the SQL in file order) | table, function |
   | C# Web API attributes, Spring `@GetMapping`, Express/Koa/Flask route calls, Rails `routes.rb` | `fastapi` (declarations, textual) | route |
   | Vue Router / Angular route arrays, a route table in one file | `react-router` | surface |
   | Blazor `@page`, SvelteKit, Nuxt, Remix — the file tree is the route tree | `nextjs` | surface, route |
   | Vue / Svelte single-file components, Angular `@Component` classes | `components` | component |
   | A cron table, Celery beat, a systemd timer — a manifest that names a process | a local reader modelled on `background-procfile` (it reads only files named `Procfile`) | background-task |
   | Anything else | `generic` (the minimal example) | — |

6. **Options** — `roots` (folders to walk) and `extensions` (suffixes
   read), plus `syntax` when the extensions do not settle it: `c-like` (C#,
   Java, JS/TS, Go, Kotlin…), `sql` (standard SQL and Postgres), `mysql`
   (MySQL and MariaDB: `#` comments, backslash escapes), `python`. Syntax
   picks the comment and string mask. **For `.sql` files always ask which
   dialect**: `.sql` defaults to `sql`, where `#` is an operator, and the
   wrong mask silently hides or invents records. Name any other option the
   convention needs; you add those by hand in Step 5.

Then the extractor's **name**: lowercase and hyphens (`aspnet-routes`,
`mysql-migrations`), never a built-in's.

Done when all six are answered and read back to the user in one summary.

## Step 3 — scaffold

Write the answers to a scratch file outside the repo and run the script:

```json
{ "name": "aspnet-routes", "evidence": "[Route]/[HttpGet] attributes on controller classes",
  "shapedLike": "fastapi", "kinds": ["route"], "idExample": "route:/api/orders/{id}",
  "refs": ["?table:"], "roots": ["src/Api"], "extensions": [".cs"] }
```
```
node "$PLUGIN/scripts/scaffold-extractor.mjs" apply --answers=<file>
```

Relay its report **verbatim** — wrote / kept / skipped / notes. A refusal
names the answer to fix; fix it and rerun. Nothing is written on a refusal,
and a rerun keeps every file that exists.

Done when the report shows `index.mjs` and the test file as written (or kept)
and `zdd/config.json` wired.

## Step 4 — the fixture, and red

Build a miniature repo in the convention under `<name>/fixture/`, laid out
like the roots. It must hold:

- ordinary declarations, including one that merges with another (two methods
  on one route, two statements on one table);
- a declaration **commented out**, and one **inside a string** — neither may
  become a record (ZDD's standard suite also comments out every line of the
  fixture itself, by the module's `COMMENT` marks, and expects nothing new
  — COMMENT must name every kind of file the module reads, `null` for one
  that takes no line comment;
  a declaration inside a string goes in `fixture-trap/`, laid out like
  `fixture/`, which must give nothing either);
- the convention's awkward corner from Step 1 (a prefix, nesting, an
  include);
- the answer to `CONVENTION_RECURSES` in the test file (its recursion test
  is red until you set it). `true` when the convention nests or follows
  includes: then add `fixture-deep/` with a cyclic or very deep case, and
  derive must finish and say where it stopped. `false` otherwise.

Fill `EXPECTED_IDS` in `<name>.test.mjs` by reading the fixture, before any
logic exists. Run `node --test <test path>`: the expected-records test fails
on a mismatch — **red**, for the right reason.

Done when that test is red on the ids and not on "fill in EXPECTED_IDS".

## Step 5 — the logic, and green

Write `fromSource()` in `index.mjs` (and any options beyond `roots` and
`extensions`, documented in the header) against the checklist below until
`node --test <test path>` is **green** — every test passes; the file-symlink
test is skipped on Windows and runs in Linux CI. Two of the scaffold's tests
guard the checklist below: one fails if the module's own files import `fs`,
`child_process` or a network module, or read `process.env`; the other derives
under a second timezone, locale and environment and requires the same bytes.
The last runs **ZDD's standard suite** (the engine's `suite`, decision 0040)
— the checks every adapter passes, the starters' and this one: the same
bytes on any machine, a gitignored path never read, a missing root nothing
to inventory, commented-out code never a record, every read through `io`.
It runs on a copy of `fixture/` outside the repo, read with the module's
`SUITE.options`; keep those equal to the fixture's layout. A failing check
names what to fix. Keep `export const CONTRACT = 1` — the adapter contract
the module was written for (the engine's `contract` prints the table).

### Hardening checklist

Learned across 1.2.0's eleven verification rounds. Every item holds before
Step 6:

- **Every read through `io.read`, every listing through `io.walk`** — the
  skeleton does this; keep `node:fs` out of the module. `io` refuses
  symlinks, files outside the repo and files over 1 MiB, and one budget
  covers every walk. A refusal is a diagnostic, never a record.
- **The byte cap is `io`'s.** Lower it with `io.read(rel, { maxBytes })` when
  the convention's files are small; it never goes higher.
- **Structure from the masked text.** Find declarations in `masked`; read
  values from `text` at the same offsets. Check the mask against the dialect
  (the mask's own comment lists what it leaves out) and extend it when the
  fixture shows a gap.
- **A nesting ceiling on every recursion** — nested route trees, includes,
  followed imports: a depth cap and a visited set, and a diagnostic when the
  cap is hit.
- **Missing source is nothing to inventory**: a diagnostic, exit 0. Throw
  only for an option the adopter must fix.
- **Byte-identical output.** Everything sorted with `<` (never
  `localeCompare`); no dates, randomness, absolute paths, environment or
  line numbers in ids or facts — a line number churns on an unrelated edit.
- **Descriptions are mechanical**: a doc comment copied verbatim, else `""`.
- **Ids come from the declaration**, never from file order, so they survive
  a moved file.

Done when the tests are green and every checklist item holds.

## Step 6 — the real repo

```
npx -y @rich-rees/zdd@0.13.0 derive --verbose
npx -y @rich-rees/zdd@0.13.0 render
npx -y @rich-rees/zdd@0.13.0 lint
```

Read every `[<name>]` diagnostic and account for each: a real gap goes back
to Step 5 with a new fixture case; an intended skip stays. What the adapter
recognises and cannot read belongs in the `unread` list it returns
(`[{ file, what }]`, decision 0048), never only in a diagnostic: each item
prints on every derive as an `UNREAD` line and, under `unread.strict`, fails
lint until the adapter is fixed or the item is marked fine. When the
adapter mints a kind of record that is wrong when it links to nothing, or
when nothing links to it, beside the core's (a route, screen or background
task that reaches nothing; a table nothing reaches), name it in `export
const GAPS = { reachNothing: ["<kind>"], reachedByNothing: ["<kind>"] }`
(decision 0049): every update then lists one that goes dark. When this
adapter was built to close a gap from `bootstrap.mjs gaps`, run that again
and confirm the gap is gone. Open three
records against their source lines and confirm them with the user. Then
commit the extractor, its fixture, its tests, the config change and the
metadata together, and link the new records from the map in the next
"update ZDD" (the lint lists them as unclaimed until a feature does).

Offer the one CI line the script printed (`node --test <test path>`); adding
it is the user's choice. ZDD's own workflow already runs the standard suite
on every adapter of the repo's own (the engine's `suite`); it blocks on the
checks up to `suiteChecks` in `zdd/config.json`, and the newer ones warn. If
the repo's `suiteChecks` is below the suite's count, say "upgrade ZDD" once
this adapter passes: `bootstrap.mjs adapters --raise` makes every check
block.

Done when derive, render and lint exit 0 and the three records are confirmed.

## After

Once it has run against a real repo for a while, offer tier 2 — the same
module, proposed as a starter for the starter library: [upstream.md](upstream.md).
