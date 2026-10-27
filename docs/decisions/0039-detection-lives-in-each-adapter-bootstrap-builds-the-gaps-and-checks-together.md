# 0039 — Detection lives in each adapter; bootstrap builds the gaps and checks the map together

**Date:** 2026-10-27 · **Status:** accepted · **Origin:** ZDD-3, questions 4–6 of the design session on 2026-10-27 (Rich's calls).

## Context

Detection was one probe per extractor inside `bootstrap.mjs`, so the plugin
named every stack and a new adapter meant editing bootstrap. Bootstrap also
could not say which part of a repo nothing covered, and the check after
bootstrap was the developer looking at the human index. Missing edges are
what eyes miss: one adopter's routes looked complete for weeks while none
of them linked to a table.

## Decision

1. **Each adapter carries its own detection.** It answers "do I fit this
   repo?" with plain-words evidence ("14 `@router.get` decorators in
   `app/routes/`"), the options it would use, and the **part** of the app it covers,
   from a stack-free list the core owns: routes, screens, components,
   database access, background tasks, external services. Detection reads through `io`,
   under the same caps.
2. **Bootstrap matches part by part.** It asks every catalogue adapter,
   collects the answers, and names what is covered and what is not.
   The ready-made list it reads out comes from the catalogue, never from
   text in the core. Its voice:
   - a missing part: "Your routes are FastAPI, and I have an adapter for
     that. Your database layer is Prisma, and I don't yet, so I'll build a
     `prisma` adapter with you. That takes a bit longer, and we'll test it
     together."
   - an adapter that almost fits: "I'll copy the `fastapi` adapter and
     change it to understand your decorator" (0036 point 5).
   Uncovered parts are built through the `extractor` skill, with fixtures
   and tests.
3. **Brownfield: check together.** After adapters are attached or built:
   1. an automated coverage report, with counts per part and the unlinked
      items named ("42 routes; 31 link to tables; 11 link to nothing:
      `/health`, …"); the developer says which gaps are fine and which are
      wrong;
   2. then the human index opened with "does this all look right, and is
      any link missing?".
   Every "that's wrong" becomes a fixture test in the adapter before it is
   fixed.
4. **Greenfield: a preview now, the check when code appears.** Bootstrap
   renders the chosen adapters' own fixtures into a temporary human index
   outside the adopter's repo, to show what a map will look like. The first
   time derive finds real routes, screens, tables or background tasks, the next session runs
   the brownfield check once. `zdd/` remembers that it is owed until it is
   done.
5. **ZDD never writes throwaway code into the adopter's repo** to test
   itself.
6. **A greenfield repo with no stack chosen** is offered the neutral list of
   stacks that have catalogue adapters, with no vendor recommendation.

## Consequences

- Adding a stack is adding one folder; bootstrap is not edited.
- About 300 lines of probe code move from `bootstrap.mjs` into the
  adapters, and bootstrap's detection tests move with them.
- Bootstrap takes longer on a brownfield repo (a coverage pass and a few
  questions). That is the price of naming gaps instead of hoping someone
  spots them.

## As built (ZDD-3 slice 4)

- **The engine runs detection; bootstrap runs the engine of its own
  release.** The plugin carries no engine and cannot import an adapter, so
  `zdd-engine detect` asks every catalogue adapter and prints one JSON
  answer (`src/core/lib/detect-repo.mjs`), and `bootstrap.mjs detect` runs
  it: `ZDD_ENGINE_BIN` when set (a test, a dry run), else the engine beside
  the plugin when it is the same version (this repository's checkout), else
  the pinned package under `npx`, as every skill runs it. Until the 0.9
  engine is published, an install outside this checkout has no engine that
  knows `detect`; slice 6 ships them together.
- **The contract.** An adapter exports `DETECTION` (data: `parts`, `order`,
  `optionShape`, and as it needs them `skipDirs`, `stack`, `companion`,
  `exampleClaims`, `example`, `optIn`, and for the fallback `sourceFile` /
  `existing`) and `detect({ scan, proposed })` (CONTRIBUTING). Everything
  bootstrap knew about a stack moved there: the evidence, the greenfield
  stack rules, the option checks it runs on answers, the records the
  example feature slice shows, and which adapters an upgrade offers again.
  A rule whose proposal depends on others' (supabase-js beside Supabase and
  a JS app) answers in a second pass that sees their names (`after`).
- **One walk, one budget.** The core walks the repo once (six folders deep,
  as bootstrap did; dot folders, `zdd/` and the union of the adapters'
  `skipDirs` skipped; gitignored paths never seen) and hands every adapter
  the same `scan`, with reads cached and charged to one io: 50,000 entries
  and 64 MiB of reads for all of detection, where bootstrap capped only the
  routes-file probe. The answer says when the walk or the reads ran out, and
  bootstrap says it aloud.
- **Parts.** The six of the decision. A schema adapter (`supabase`) reports
  `database access`, with the data-access adapters: the tables are what
  access reaches. `generic` covers none.
- **New proposals.** `supabase-py` (the client as a dependency, an import,
  or its own call shape — `.table("x")` / `.from_("x")` in Python, as on
  the engine's FastAPI fixture, whose client is never imported), `sqlalchemy`
  (a dependency in `requirements*.txt`, `pyproject.toml` or `Pipfile`, or an
  import), and the queue readers `background-inngest`,
  `background-trigger-dev` and `background-sqs` from their declarations in
  source. Every other proposal on the engine's fixtures is what bootstrap
  proposed before, evidence text and all; the services detection now uses
  the adapter's own scanners, so bootstrap's mirror of its lists is gone.
  The queue readers are opt-ins, offered by every upgrade; the data-access
  adapters are not (adding them to an old config is slice 6's upgrade).
- **The coverage report** is `zdd-engine coverage` (derive in memory,
  nothing written): per record kind, the count, the kinds its records link
  to (refs and typed edges to records that exist), and by name (up to 20)
  the records that link to nothing and the ones nothing links to.
  `bootstrap.mjs check` reads it out with the two questions; `check --done`
  ends it.
- **What is owed** is `"mapCheck": "owed"` in `zdd/config.json`, written at
  a fresh install and cleared by `check --done`. `load` runs
  `check --status`, which says one line when the check is owed and derive
  has found records — the greenfield case — and nothing otherwise.
- **The preview** is `zdd-engine preview --extractors=…` (and
  `bootstrap.mjs preview`): the chosen adapters' `example/` folders (today
  `supabase`, `fastapi`, `nextjs`, `react-router`, `expo-router`) copied into
  a new temporary folder outside the repo, with a config naming them, then
  derive and render there. An adapter with no example is named, not faked.
- **The plugin's border** is a test (`plugins/zdd/test/plugin-border.test.mjs`):
  no plugin script names a stack, by the engine's tripwire list, outside a
  fenced region that says why — the upgrade's migrations from earlier
  releases (the pre-1.0 bundle, the 0.9 `jobs` split, each release's note,
  the retired-name sweep's build folders), the git hosts behind the CI
  offer, the fence's interpreter list, and the scaffold's mirror of the
  catalogue (held equal by its own test). The skills' prose is not checked:
  it talks to a person about their stack.
- **After the slice 4 campaign (CR-096 to CR-117).** On Windows, outside
  this checkout, npm's `npx-cli.js` beside node runs the engine with no
  shell; cmd.exe runs `npx` only when that file is missing, and then an
  argument it would read differently (a quote, `%`, `^`, `!`, `&`, `|`, `<`,
  `>`) is refused before anything runs. `ZDD_ENGINE_BIN` is accepted only
  when it names an engine's own `bin/zdd-engine.mjs`. The options bootstrap
  writes are checked whatever their source — a detected folder name with a
  space stops the run before the first write — and an option shape names a
  call-name grammar (the one supabase-js reads, which now says when it
  ignores a name) and an object list's required and optional path keys
  (`background-declared`'s `file` and `cwd`). The scan counts the files it
  could not read and bootstrap says so. A pyproject or Pipfile string counts
  as a dependency only inside a dependency array or table. `preview` writes
  only into a real, empty folder outside `--root`, and refuses a name the
  catalogue does not hold. `check --status` is silent in a repo with no
  config and reads metadataDir only inside the checkout, never through a
  link.
- **Measured on the adopters (dry runs on throwaway copies).** Detection
  takes about a second on both adopters, and proposes what main's
  bootstrap did, with `jobs` split into the readers each repo uses
  (the first adopter `background-railway` and `background-vercel`, the second adopter
  `background-railway`), `supabase-js` on both, and `sqlalchemy` on
  the second adopter. Added to their configs, those two bring the first adopter's 14 missing
  modules back (no broken map links) and give the second adopter 68 data-access
  records: 53 of its 70 routes now link to a table, where none did.

## Rejected

- **Detection stays in bootstrap, as one table of probes.** Less work now,
  but the plugin names every stack forever.
- **Open the human index and ask "does it look right?" only.** Catches wrong
  boxes, rarely missing arrows.
- **A warn-only coverage line on every CI derive.** It flags a new gap on
  its branch, but routes that legitimately touch no table would need marking
  somewhere, or the warning becomes noise.
- **A temporary CRUD page for greenfield**, written, checked and deleted at
  bootstrap. It tests ZDD's code instead of the adopter's, and writes into
  their repo.
