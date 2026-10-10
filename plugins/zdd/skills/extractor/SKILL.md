---
name: extractor
description: Scaffold an extractor for a stack ZDD does not read yet — a local one in this repo by default (no fork, no publish), a registry contribution only on request. Interviews the convention from a sample of the source, runs a script that writes the module, tests, fixture folder and config wiring, then walks the tests red to green and derive, render, lint. Use when bootstrap reported map-only, or someone asks for an extractor for their stack (MySQL, Rails, C# controllers, Vue Router…).
---

# zdd:extractor — teach ZDD one more convention

An **extractor** reads one convention (SQL migrations, a route tree,
controller attributes) and emits the **metadata records** the indexes are
built from. You are the conversation and the author of the parsing logic;
**`scripts/scaffold-extractor.mjs` writes the skeleton and the config
wiring** — never hand-write the files it writes.

Three tiers, in the order you offer them (decision 0010):

1. **Local** — `localExtractorDir/<name>/` in this repo. Adopter-owned: no
   fork, no publish, live on the next `derive`. **The default.**
2. **Registry** — a PR to `rich-rees/zero-drift-docs`, shipped to everyone in
   a minor release. Only when the user asks, or once a local extractor has
   proven itself on a real repo.
3. **Fork** — the user's own scoped engine package. Only when upstream will
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
- `engine` in that config is **1.3.0 or later** — the version that hands
  extractors `io`. Older: say "upgrade ZDD" first. A local extractor may not take a built-in's name, nor a retired one the engine still answers to (`services`, the pre-2.3 name of `external-services`). A scaffolded
  extractor stops `derive` on an older engine by design.
- The convention is not already a built-in: `supabase` (SQL migrations),
  `nextjs` (App Router), `fastapi` (decorators), `react-router` (a route tree
  in one file), `components` (React / React Native components),
  `expo-router` (an Expo Router folder tree), `jobs` (workers and scheduled
  jobs from run manifests), `external-services` (third-party systems by declared
  marker). If it is, the answer is config, not code.

Done when all three hold.

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
   | A cron table, Celery beat, a systemd timer — a manifest that names a process | `jobs` | job |
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
  become a record;
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

### Hardening checklist

Learned across CAS-63's eleven verification rounds. Every item holds before
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
npx -y @rich-rees/zdd-engine@2.4.0 derive --verbose
npx -y @rich-rees/zdd-engine@2.4.0 render
npx -y @rich-rees/zdd-engine@2.4.0 lint
```

Read every `[<name>]` diagnostic and account for each: a real gap goes back
to Step 5 with a new fixture case; an intended skip stays. Open three
records against their source lines and confirm them with the user. Then
commit the extractor, its fixture, its tests, the config change and the
metadata together, and link the new records from the map in the next
"update ZDD" (the lint lists them as unclaimed until a feature does).

Offer the one CI line the script printed (`node --test <test path>`); adding
it is the user's choice.

Done when derive, render and lint exit 0 and the three records are confirmed.

## After

Once it has run against a real repo for a while, offer tier 2 — the same
module, proposed upstream: [upstream.md](upstream.md).
