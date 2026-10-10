# Zero-Drift Docs (ZDD)

A documentation architecture for repos built by **human + agent pairs**. ZDD keeps
seven documentation artifacts *at most one unit of work behind the code* — and, with
CI, makes drift in the machine-generated ones **un-mergeable**.

> **Status: 2.4.0.** The plugin installs in Claude Code
> and in Codex from this one repo; `bootstrap` detects your stack (or grills
> for it on a greenfield repo), proposes extractors with evidence, and *writes*
> the opt-ins; the engine (`packages/zdd-engine`, npm `@rich-rees/zdd-engine`)
> carries composed extractors and the graph artifact + viewer registry. Two
> plug-in points are open for contributors: extractors in, viewers out.

## What ZDD does, in two lines

At its core ZDD does two things: **load** and **update** (bootstrap sets a repo up, and upgrade moves it to a newer release). You can do both by hand with any
coding agent — read the glossary and decisions before you build, curate and
regenerate the docs before you finish. It is only truly *zero*-drift on the
runbook's defaults, which include a CI check that refuses to merge stale
generated artifacts. Everything else in this repo exists to make those two
things cheap and the defaults the easy path. Between them sits one short step,
**choose patterns**: once the design is settled and before any code, decide
which blessed pattern each piece of work copies, and write the choice down.

### A knowing tool, not a quality tool

ZDD does nothing about code quality. It does not review, lint, constrain style
or check correctness. Every component — glossary, ADRs, map, index, fence, CI
gate, Stop prompt — exists so the agent *knows* the vocabulary, the decisions
and the shape of the system before it touches anything. The failure it targets
is specific: code from a model that does not know your decisions is locally
plausible and globally inconsistent — it reintroduces the approach you rejected
in March, and calls a refund a "reversal" because that is what it grepped for.
That is a failure of knowing, not of coding, and it is invisible from inside the
session. ZDD closes that gap and nothing else.

## The idea in one screen

Documentation has two consumers with different failure modes: the **agent** (orients
by grep-and-read, re-pays the cost every session) and the **human** (can't hold the
system shape in their head; hand-maintained mechanism prose rots fastest). ZDD gives
each what it needs, off **seven artifacts** — the design test for every fact:

> **Document only what grep cannot find and code cannot say.**

Four are **curated** (they can rot, so a per-PR ritual + CI watch them) and three are
**generated** (rot-proof by construction, never hand-edited). The count is by
*role*, not by file: the generated half also lands on disk as `zdd/adr-index.md`
(the ADRs' index, rendered), `zdd/blessing-index.md` (the map's blessings, one
line each, by trigger question) and `zdd/graph.json` (the machine form of the
whole generated half — schema `zdd-graph/1` — from which the human index is
rendered). All are mandatory outputs of `render` and all are fenced, but they
are forms of artifacts 5–7, not an eighth, ninth and tenth.

| # | Artifact | Kind | Home |
|---|----------|------|------|
| 1 | Glossary — the ubiquitous language | Curated | `zdd/glossary.md` |
| 2 | ADRs — decisions + rejected alternatives | Curated | `zdd/adr/` |
| 3 | Code comments — constraints at the site | Curated | the source |
| 4 | Semantic map — groupings, non-textual edges, blessings | Curated | `zdd/map/` |
| 5 | Codebase metadata — mechanical inventory | Generated | `zdd/metadata/` |
| 6 | Agent index — feature-first orientation | Generated | `zdd/agent-index.md` |
| 7 | Human index — hosted graph view | Generated | `zdd/human-index.html` |

The semantic map is more than grouping that folder structure already does. It
is where the **blessings** live: one-liners in a concept naming the **exemplar
to copy** and the **pattern to refuse** — "adding an endpoint? copy this one;
never inline the auth check" — each citing the ADR that blessed it. They answer
a failure mode grep makes worse, not better: **pattern frequency in code is
never a verdict.** The most common pattern is often the deprecated one, and an
agent that copies the nearest example copies the wrong one with confidence. A
blessing is the curated answer; the engine's lint refuses a blessing whose ADR
has since been superseded, so a stale blessing cannot sit quietly (the format is
in [`skills/authoring.md`](plugins/zdd/skills/authoring.md)).

A blessing helps only if it is read before the code is written, so it has a
moment of its own. **"Choose patterns"** runs once the design is settled: it
reads the generated **blessing index** (every blessing's trigger question, one
line each) whole, opens the blessings that match the work, checks the inventory
for logic that already exists, and commits a **pattern plan** — per piece:
follow a blessing, depart from one and why, none applies, or a new pattern to
bless. **"Update ZDD"** then decides against the code as it merges: it mints
the blessings that survived, records the rest in the commit message and
deletes the plan; CI refuses a merge while the plan exists. The whole system,
with examples, is in [docs/patterns.md](docs/patterns.md).

Three spoken verbs carry each unit of work, and all work with any coding agent: **"load ZDD"**
before you work (the `load` skill, plus an auto-injected index), **"choose
patterns"** between the design and the code (the `patterns` skill) and **"update
ZDD"** before you finish (the `update` skill). With the CI check in place the unit
of work is the PR and stale generated artifacts cannot merge; without it, ZDD is
the verbs and the guarantee is a habit. A third hook guards the moment the
habit slips: when the agent declares done with code changed and nothing in
`zdd/` moved, the **Stop prompt** asks once — run the ritual, or say that nothing
met the ADR test ([decision 0008](docs/decisions/0008-stop-hook-prompts-the-curated-half.md)).
A fourth verb, **"upgrade ZDD"** (the `upgrade` skill), moves the repo to a
newer ZDD release when you choose to — showing every change before it writes.

## What the plugin is (and is not)

It ships the **machine that makes `zdd/` folders** — never anyone's docs. It carries
no glossary terms, no map, and **none of ZDD's own ADRs**: the rationale for *why*
ZDD is designed this way is baked into the mechanism, not shipped as decisions. An
adopter consumes it as a finished tool.

`bootstrap` is the install runbook. On an existing codebase it scans for each
extractor's convention and shows you the evidence ("SQL migrations under
`supabase/migrations`", "`APIRouter` under `api/routes`") to confirm rather than
describe; on a greenfield repo it asks for the intended stack and configures the
extractors ahead of the code. Then it offers the opt-ins as yes/no with defaults
on and **writes** them — the session-start auto-load, the generated-artifact
fence, the Stop prompt for the curated half, the CI workflow (or, if you decline
CI, a pre-push hook), ZDD's instructions in `zdd/instructions.md` with the
one line in `CLAUDE.md` that loads them (a copy between markers in `AGENTS.md`
for Codex) — plus an empty `zdd/` and one
seeded **ADR-0001** recording *your* decision to adopt ZDD: the corpus's first
entry *and* a worked example of the format. Branch protection is the one step it
prints instead of doing. Idempotent; and "upgrade ZDD" (the same script) is the
only thing that writes to those files later, showing every file it will change
before it writes. (The
generated artifacts are the engine's: `derive` and `render` write them on every
"update ZDD". Beyond those, only the `extractor` skill's scaffold writes to
your repo, and only when you run it.)

Contents: seven skills (`bootstrap`, `load`, `patterns`, `update`, `upgrade`, `grill`, `extractor`), a
shared authoring guide, three hooks (auto-load, fence, Stop prompt), the runbook
and scaffold scripts, the engine + composed
extractors + viewers (`packages/zdd-engine`, also the npm package
`@rich-rees/zdd-engine`), and templates (ZDD's instructions, CI workflow, pre-push
hook, config schema + example, the seed ADR-0001, and the extractor scaffold).

### What ZDD reads, per stack

| Layer | Extractor | Reads |
|---|---|---|
| Database | `supabase` | SQL migrations: tables, functions, triggers, buckets |
| API | `fastapi` | FastAPI decorators: routes, handlers, the tables a handler names |
| API + pages | `nextjs` | the App Router tree: route handlers, pages, layouts, middleware auth, `fetch('/api/…')` and `.from('x')` refs |
| Pages | `react-router` | a route tree declared in code: one surface per screen, its guards, the API calls one hop away |
| Native screens | `expo-router` *(early)* | the Expo Router folder tree: screens, layouts, `[id]` segments, platform pairs — namespaced so a native `/jobs` and a web `/jobs` are two surfaces |
| Components | `components` | React and React Native: exported, capitalised, returning JSX; props as written; **used by** / **uses** / **calls**; shared vs page-private |
| Background work | `jobs` | everything that runs without a user clicking (2.3): scheduled — Vercel crons (`vercel.json`), Railway `cronSchedule`, Cloudflare `wrangler.toml` triggers, Supabase `pg_cron` in migrations, Trigger.dev scheduled tasks, and GitHub Actions schedules as opt-in housekeeping; workers — Railway, a Procfile, Docker Compose; queues — BullMQ, Inngest, Trigger.dev, SQS, producer and consumer with the queue's name. Each record carries its trigger and what it hits (a route, a function, the module); a package script counts only when a manifest runs it; `reads` / `writes` from the tables a module names; the mode never guessed |
| External services | `external-services` (`services` before 2.3) | declared markers — a package import, an env-name prefix (names only, never values); **depends on** from the files that carry a marker — never a file that reaches the provider through a settings object; undeclared candidates warned about on every derive |
| Realtime | *(in `react-router` / `nextjs`)* | a page's Supabase Realtime subscription — `.on('postgres_changes', { table })` or a helper you name — as a **subscribes** edge |

Vue, Svelte and Angular are not read: write a local extractor with the
`extractor` skill (below) and, once it is proven on a real repo, lift it in.

### Your stack isn't read yet — add your own extractor

The built-in extractors read Supabase/Postgres migrations, the Next.js App
Router, FastAPI and React Router. For any other convention, bootstrap proposes
a map-only setup and points at the **`extractor` skill**. Ask your agent for
an extractor ("give me one for our C# controllers") and it reads a sample of
your source and interviews you about the convention. A script then writes
the module, its tests and fixture folder, and the config wiring, and the agent
walks the tests red to green. There are three tiers, in the order the skill offers them
([decision 0010](docs/decisions/0010-local-extractors-first-tier-engine-hands-them-io.md)):

1. **Local**: the extractor lives in your repo's `localExtractorDir`, and the
   engine loads it by name on the next `derive`. You don't fork or publish
   anything.
2. **Registry**: propose it here as a PR once it has proven itself, and it
   ships to everyone in the next minor release.
3. **Fork**: publish the engine under your own scope and repin the plugin
   to it, for a convention upstream won't take.

### Producing decisions — ZDD stands alone, grilling makes it sharper

ZDD *captures* decisions; how you *produce* them is your choice. The `update` and
`bootstrap` skills carry their own compact authoring discipline
([`skills/authoring.md`](plugins/zdd/skills/authoring.md) — the ADR-worthiness test,
the glossary/ADR formats, capture-at-crystallization), so ZDD writes decent
glossary entries and ADRs on its own, from plan-mode work or plain thinking.

For a sharper way to drive decisions out, use **`grill`** with
[Matt Pocock's skills](https://github.com/mattpocock/skills) (`mattpocock-skills`,
which installing `zdd` brings in at the release ZDD is tested with) — a
relentless design interview that writes the glossary and ADRs as it goes,
redirected into your `zdd/` folder. It self-checks: with the plugin absent it
points you at the install or at plan-mode + "update ZDD", and ZDD keeps working.
`bootstrap` says the same in plain words. **Recommended, never required.**

His skills read a root `GLOSSARY.md` and `docs/adr/` by name (`CONTEXT.md`
before his 1.3). `bootstrap` writes `docs/agents/domain.md`, the file they honour,
pointing them at `zdd/glossary.md` and `zdd/adr/` (only when absent; a
hand-written one is kept). Keep the glossary under `zdd/`: moved to a root
`glossary.md` it collides with his `GLOSSARY.md` on case-insensitive disks
(Windows, macOS) but not on Linux CI. `lint` warns while a root `GLOSSARY.md` or
`CONTEXT.md` sits beside the real glossary.

Claude Code loads two enabled copies of one plugin name as **one**, silently, and
the other copy can win — so `bootstrap` switches `mattpocock-skills@mattpocock`
and `mattpocock-skills@claude-plugins-official` off in the repo's committed
`.claude/settings.json` (they still work in your other repos; nothing is
uninstalled), and `load` warns when another copy is switched on for the repo
anyway. Taking a new Pocock release is a ZDD release.

## Install

### Before you start

Everything ZDD needs, and why — the install checks each of these before it
asks a question, and an upgrade checks them again:

- **Node.js 20 or newer** ([nodejs.org](https://nodejs.org)). ZDD's own
  scripts run on it, and so does the engine. A Claude Code installed on its
  own does not bring it.
- **`npx`**, which comes with Node.js. ZDD's plugin carries no engine: the
  first time a skill does real work, `npx` downloads
  `@rich-rees/zdd-engine` at the release's pinned version from the public
  npm registry, and again on each engine pin bump. No npm account is needed;
  the package is public.
- **git**, and a git repository. The release lock is a git tag, the
  freshness check reads the history, and "what git ignores is never source"
  asks git which files those are.
- **Access to github.com and registry.npmjs.org.** The plugin and Matt
  Pocock's skills are installed from public GitHub repositories; the engine
  from npm. A proxy or a firewall that blocks either is named in plain
  words by the check, not as a raw `npx` error mid-install.
- **No account anywhere.** Nothing in ZDD reads a secret or needs one.

Two paths: **adopting** ZDD in a repo (once, by whoever sets it up), and
**joining** a repo that already uses it (every other developer — the path most
people take). Each is a short, copy-pasteable sequence; the commands are the
same in PowerShell, bash and zsh. The install talks in plain words — it
assumes the person has never heard of ZDD and may not be a developer — and
asks one question at a time, with a recommendation, what it costs and what
saying no gives up. It works the same on a **greenfield** folder (an empty
`zdd/` that every task's "update ZDD" fills), a **young app** (the
inventory complete on day one, one mapping session, an optional backfill
offered once with an honest estimate of your review time) and a **mature
codebase** (the same, with the unclaimed list as a to-do list and decisions
never reconstructed from old code). Anything bulk is approved as one
reviewable file, never one question per item.

### Adopting ZDD in a repo

**Claude Code** — in a terminal, from the repo's folder (use the newest tag
from [the releases page](https://github.com/rich-rees/zero-drift-docs/releases)):

```
claude plugin marketplace add rich-rees/zero-drift-docs@v2.4.0 --scope project
claude plugin install zdd@zero-drift-docs --scope project
```

Start (or restart) Claude Code in the repo and say **"bootstrap ZDD"**.

Always add the marketplace **with its tag and `--scope project`**: that writes
the declaration into the repo's own `.claude/settings.json` — the lock every
teammate then follows. Added without a scope, Claude Code also records the
marketplace in *your* user settings, and that copy holds your machine on the
old release when the repo later moves
([decision 0022](docs/decisions/0022-the-pin-move-route-removes-a-stray-declaration-first.md)).

**Codex** — from a terminal:

```
codex plugin marketplace add rich-rees/zero-drift-docs
codex plugin add zdd@zero-drift-docs
```

Then run **`bootstrap`** in the repo. Codex has no dependency mechanism, so
install [Matt Pocock's skills](https://github.com/mattpocock/skills) yourself,
at the release named in `plugins/zdd/pocock.json`.

Bootstrap detects the stack, writes `zdd/`, the config, the opt-ins, ZDD's
instructions file (and the one line in `CLAUDE.md` that loads it) and the
**release lock** (the repo pinned to this ZDD
release — [decision 0021](docs/decisions/0021-bootstrap-locks-the-release-by-default.md)),
runs the first derive and render, and leaves you one step — below.

In Claude Code, installing `zdd` also installs **`mattpocock-skills@zero-drift-docs`**:
the one release of [Matt Pocock's skills](https://github.com/mattpocock/skills)
this ZDD release is tested with, fetched from his repository at a pinned tag and
commit ([decision 0014](docs/decisions/0014-a-zdd-release-pins-and-brings-in-one-pocock-release.md)).
Nothing is copied; `zdd` declares it as a dependency, and the repo's settings
switch your other copies of his skills off *in this repo only*.

Both hosts read the same marketplace file and the same plugin body — two
manifests (`.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`) pointing at
one set of skills and one `hooks.json`. The seven skills are `bootstrap`,
`load`, `patterns`, `update`, `upgrade`, `grill` and `extractor` (Claude Code
lists them as `/zdd:load` etc.). Install works from a private fork too — it
uses your git credentials.

### Joining a repo that already uses ZDD

**Claude Code** — clone the repo, open it in Claude Code once and accept the
folder-trust prompt (that brings ZDD's catalogue at the repo's locked release,
silently — it installs nothing yet). Then, in a terminal from the repo's folder:

```
claude plugin install zdd@zero-drift-docs --scope project
```

Restart Claude Code. If a session ever opens with a **"ZDD release
mismatch"** line, it names the exact commands that bring your machine to the
repo's release — run them and restart. A `claude plugin` command may rewrite
`.claude/settings.json` in its own key order: if `git diff
.claude/settings.json` shows only lines moving, nothing added or changed,
discard it with `git restore .claude/settings.json` — the committed file is
the team's. If you had your own edits in that file, keep them and undo only
the reordering.

**Codex** — the same two commands as adopting (`codex plugin marketplace add
…`, `codex plugin add zdd@zero-drift-docs`) and Matt Pocock's skills at the
release in `plugins/zdd/pocock.json`. There is no bootstrap to run: the repo is
already set up.

### …with CI — the real guarantee

In branch protection: require the **zdd** check to pass, and require branches to
be up to date before merging. Now stale generated artifacts **cannot merge**. Note
the split this enforces: CI makes *drift in the generated artifacts* un-mergeable —
the curated artifacts stay one unit of work behind on the ritual (no script can
judge "should this have been an ADR?"). The Stop prompt makes sure that judgment
is *made and said* before the agent finishes; it cannot check the answer.

### …without CI — the verbs

CI is a strong recommendation, not a hard dependency. Decline it and ZDD still
runs: the agent loads before it works and updates before it finishes. You lose
*enforcement* — ZDD drops from a provable guarantee to a good habit, and
`bootstrap` says so. The middle option it offers is a local git pre-push hook
running the engine's `--check`, which makes a forgotten update **loud** without a
merge gate.

### Known issues

- Vercel Queues are not read yet (the API was not stable enough to pin a
  shape to); BullMQ, Inngest, Trigger.dev and SQS are. Filed as a finding.
- A Supabase Realtime subscription written as a direct
  `.on('postgres_changes')` inside a hook yields no `subscribes` edge; name
  the wrapper in `subscribeCalls`. Filed as a finding.
- **Still on 2.2.1? The `services` extractor's default roots read gitignored
  folders**, including the `.claude/worktrees/` folder the Claude desktop app
  creates (a second checkout of the repo): the committed records can name
  worktree files, so local `derive --check` passes and CI fails. Until you
  move, set `extractorOptions.services.roots` to the folders that hold your
  source (for example `["apps", "scripts"]`). Fixed in 2.3.0: what git
  ignores is never source.
- Findings — things ZDD got wrong, as opposed to things wrong in your repo —
  live as [GitHub Issues labelled `finding`](https://github.com/rich-rees/zero-drift-docs/issues?q=is%3Aopen+label%3Afinding);
  a `blocker` is one a new user following this README can hit. A finding
  with a workaround on your side is logged, not released; findings ship
  together in a release train, and you move only when a release carries
  something you need.

### Upgrading

Updating the plugin never touches your repo; moving the repo to a newer release
is a choice you make. Say **"upgrade ZDD"**: it checks for a newer release and,
on your yes, moves the repo's lock — then you restart, run the commands the
session's first line names, restart again, and say "upgrade ZDD" once more.
That second run is the new release's own: it shows every file it will change
(config, engine pins, `zdd/instructions.md`, the lock), names any paragraph
in your `CLAUDE.md` / `AGENTS.md` that speaks to a rule ZDD's instructions now
state — with what ZDD says beside it — asks one question at a time, writes,
regenerates, and lists what to commit — one PR. After it merges, each
teammate's next session prints the commands that move their machine.

**A repo on a release before 2.2** has no "upgrade ZDD" yet, so move the lock
by hand once:

1. In `.claude/settings.json`, set
   `extraKnownMarketplaces["zero-drift-docs"].source.ref` to the new tag
   (`"v2.4.0"`). No lock there? Add the marketplace from the repo's folder with
   `claude plugin marketplace add rich-rees/zero-drift-docs@v2.4.0 --scope project`.
2. Restart Claude Code. The session's first line names the commands that move
   your machine (on a machine where the marketplace was ever added without a
   scope, that includes `claude plugin marketplace remove zero-drift-docs
   --scope user`) — run them, and restart again.
3. Say **"upgrade ZDD"**: from here it is the guided flow above.

From 1.3.1 (no session-start release check yet), step 2 is: `claude plugin
marketplace remove zero-drift-docs --scope user` if your user settings
(`~/.claude/settings.json`, or `settings.json` in `$CLAUDE_CONFIG_DIR` when you
set it) mention `zero-drift-docs`, restart, `claude plugin update
zdd@zero-drift-docs`, restart.

## Repo layout

```
.claude-plugin/marketplace.json     # this repo is a plugin marketplace (Claude Code + Codex): zdd + the pinned mattpocock-skills
plugins/zdd/
  .claude-plugin/plugin.json        # two manifests, one body (the Claude one declares the mattpocock-skills dependency)
  .codex-plugin/plugin.json
  pocock.json                       # the one Pocock release this release is tested with: tag, commit, version (decision 0014)
  hooks/hooks.json                  # SessionStart auto-load + PreToolUse fence + Stop prompt (opt-ins read from zdd/config.json)
  scripts/
    bootstrap.mjs                   # the runbook's writer: detect / apply / upgrade
    scaffold-extractor.mjs          # the extractor skill's writer: a local extractor's skeleton + config wiring
    inject-agent-index.mjs  fence.mjs  stop-check.mjs  check-skew.mjs  check-pocock.mjs  check-release.mjs
  skills/{bootstrap,load,patterns,update,upgrade,grill,extractor}/SKILL.md
  skills/extractor/upstream.md      # the registry and fork tiers
  skills/authoring.md               # shared curated-docs authoring discipline
  templates/
    instructions.md                 # ZDD's instructions: zdd/instructions.md, loaded by one line in CLAUDE.md; a block in AGENTS.md
    zdd.yml  pre-push               # CI check / local hook
    config.schema.json  config.example.json
    extractor/                      # the scaffold: module, test file, one comment/string mask per syntax
    adr-0001-adopt-zero-drift-docs.md   # seeded as the adopter's first ADR
  test/                             # seam 2: the runbook and hooks observed as files + processes
packages/zdd-engine/                # deriver / renderer / checks + extractors + viewers
  bin/zdd-engine.mjs                # the CLI (derive / render / lint / freshness)
  src/extractors/{supabase,nextjs,fastapi,react-router,components,expo-router,jobs,external-services,generic}/   # input end: one per convention
  src/viewers/{cytoscape,minimal}/  # output end: human-index viewers over graph.json
  test/fixture*/                    # the miniature proving repos
docs/patterns.md                    # blessings and "choose patterns", the whole system
docs/decisions/                     # this repo's own decision record (ADR format)
LICENSE   CONTRIBUTING.md   README.md
```

## Who needs which parts — solo versus team

ZDD is a team answer first. A solo developer on a conventional framework is the
single point of coherence — they *are* the enforcement, and they know when the
docs are stale. That stops being true with a second person, a second agent, or
a six-week gap. The table (lifted from an external review of this repo, 2026-09)
is the honest adoption guide; `bootstrap` offers every part as a yes/no, so
saying no to a row is a visible choice, not a fork.

| Component | Solo, conventional stack | Team, or large / unconventional repo |
|---|---|---|
| ZDD's instructions (`zdd/instructions.md`, one import line in `CLAUDE.md`; a block in `AGENTS.md`) | **Required.** This is the product at solo scale. | Required. |
| ADRs with the three-part test | **Required.** Solo devs forget their own reasoning within a quarter. | Required. |
| Constraint comments at the site | Required, and probably already happening. | Required. |
| Glossary | Start it the first time you correct a word. | **Required.** This is where vocabulary drift actually begins. |
| Semantic map (groupings, edges, blessings) | Skip the grouping; keep a blessing the first time you catch yourself copying the wrong example. | Worth it when someone will maintain it. The blessings are the part that pays; the lint keeps them honest. |
| Generated inventory (metadata) | Skip, or a ten-line pre-commit script. | Useful when the repo is big enough that orientation costs real tokens. |
| Agent index, auto-injected | Skip; `CLAUDE.md` is already loaded. | Measure first, then decide. |
| Human index / graph viewer | Skip. | Earns its place when someone must understand a system they didn't build. |
| `update` finish ritual + Stop prompt | Keep the idea; the Stop prompt is the enforcement that matters. | Same. |
| "choose patterns" + blessing index *(added in 2.0)* | Once you keep blessings: it is the step that reads them. | Comes with the blessings. |
| `load` skill / auto-load hook | Redundant without the index. | Comes with the index. |
| `bootstrap` runbook | Only if installing the rest. | Yes — it's what makes adoption survivable. |
| `grill` | Optional; plan mode with a good prompt gets most of it. | Useful for greenfield design sessions. |
| Engine, extractors, viewers, fence, CI check, pins, skew | Skip. | Only with the generated half. |

## Roadmap

- [x] **2.4.0** — the ZDD record: the agent says, at the moment, when an
      artifact turned or confirmed a decision or showed code to reuse;
      "update ZDD" writes those lines into the commit's message in five
      sections; `zdd-engine tally` counts them over history and names what
      no record ever named *(2026-10-10, CAS-105)*.
- [x] **2.3.0** — the plain-words install and upgrade, ZDD's instructions in
      a file of their own, external services, work-shaped blessings,
      background work, the two-level index, and the first-run findings from
      DiO's and Cascade's moves to 2.2.1 *(2026-10-09, CAS-103)*.

- [x] Extract the engine (`derive` / `render` / checks + `nextjs-supabase` adapter)
      from the PressPlay proving instance into `packages/zdd-engine` *(v0.2)*.
- [x] Decide engine distribution: **npm package** — `@rich-rees/zdd-engine` is the
      single source both CI (npx, no Claude Code) and the skills call *(v0.2)*.
- [x] Wire the skills' `TODO(engine)` steps to the real invocations *(v0.2)*.
- [x] Publish `@rich-rees/zdd-engine` to npm — live at 0.2.0, verified end-to-end
      via `npx` against the fixture *(2026-08-14)*.
- [x] **Composed extractors** — the `nextjs-supabase` adapter split into `supabase`
      + `nextjs` (byte-identical output), plus `fastapi` and `generic`; a declared
      repo-local extractor directory; greenfield repos derive clean *(engine 0.3.0,
      DIO-309; [decision 0001](docs/decisions/0001-composed-extractors.md))*.
- [x] **Graph artifact + pluggable viewers** — `render` writes the map+metadata
      join as `zdd/graph.json` (schema `zdd-graph/1`) and renders the human index
      through a viewer selected by config from a registry; the Cytoscape viewer
      is viewer #1, isolated under its Apache-2.0 notice, and `minimal` is the
      worked example *(engine 0.4.0, DIO-310;
      [decision 0002](docs/decisions/0002-graph-artifact-and-viewers.md))*.
- [x] **Bootstrap runbook, Codex, upgrade** — detect / greenfield modes with
      evidence, opt-ins written (auto-load, fence, CI or pre-push), `orient` →
      `load` with an engine-skew warning, `bootstrap --upgrade`, a Codex manifest
      beside the Claude one *(plugin 0.4.0, DIO-311; decisions
      [0003](docs/decisions/0003-kernel-and-opt-ins.md),
      [0004](docs/decisions/0004-pocock-skills-recommended-not-required.md),
      [0005](docs/decisions/0005-no-zdd-in-the-plugin-repo.md),
      [0006](docs/decisions/0006-one-repo-two-manifests.md))*.
- [x] **1.0.0** — live smoke test in both hosts against `rich-rees/zdd-smoke-test`,
      one review campaign over the whole 0.3.1 → 1.0 diff, tag `v1.0.0`,
      engine 1.0.0 on npm, repo public (DIO-312).
- [x] **1.1.0** — the Stop prompt for the curated half (third hook, opt-in,
      once per session); the blessing-citation lint (a blessing citing a
      superseded or missing ADR fails `lint` — the map's first hard check); the
      freshness nudge watches the source behind every metadata link, not just
      `resource:`; blessings defined, the "knowing tool" framing and the
      solo-versus-team table lifted from an external review *(engine + plugin
      1.1.0, DIO-313; [decision 0008](docs/decisions/0008-stop-hook-prompts-the-curated-half.md))*.
- [x] **1.2.0** — the `react-router` extractor (a route tree declared in
      code: one surface per leaf route, layout ancestors as guards, a screen's
      API calls resolved to the API extractor's routes); the unclaimed-records
      lint (every route, table, function and surface no feature slice links,
      a warning with the count in the human index header); bootstrap seeds
      one example feature slice and `update` names the slice as the unit of
      work's checklist *(engine + plugin 1.2.0, CAS-63;
      [decision 0009](docs/decisions/0009-unclaimed-records-warn-never-fail.md))*.
- [x] **1.3.0** — the `extractor` skill: an interview about the convention, a
      scaffold script that writes a local extractor (module, tests, fixture
      folder, config wiring), red to green against the CAS-63 hardening
      checklist, and the registry and fork paths beyond it; the engine hands
      every extractor `io` (read and walk that stay inside the repo) so a
      local extractor can be as safe as a built-in; bootstrap's map-only
      proposal points at the skill. Route refs now err toward "might touch":
      a call that fits several routes equally refs all of them, and a React
      Router screen is credited only with what its imports reach, not a
      whole data module. Opt-in strict claims (`claims.strict`: every
      record owned by exactly one feature slice, with an allow-list for
      plumbing). A renamed React Router routes file now fails `derive`
      when there is still code beside it, where it used to delete every
      screen record. All of these were found in Cascade
      *(engine + plugin 1.3.0, CAS-65; decisions
      [0010](docs/decisions/0010-local-extractors-first-tier-engine-hands-them-io.md),
      [0011](docs/decisions/0011-refs-err-toward-might-touch.md),
      [0012](docs/decisions/0012-strict-claims-are-opt-in.md),
      [0013](docs/decisions/0013-a-missing-routes-file-beside-code-fails-derive.md))*.
- [x] **1.3.1** — a ZDD release pins and brings in one Pocock release. Matt's
      1.3 renamed the root `CONTEXT.md` to `GLOSSARY.md` and ZDD adopters lost
      their glossary silently; now ZDD's marketplace lists `mattpocock-skills`
      at a pinned tag and commit, `zdd` depends on it, bootstrap writes
      `docs/agents/domain.md` (his skills' redirect) and the per-repo
      settings that keep any other copy off, `load` warns when one is on
      anyway, and `lint` warns about a stray root `GLOSSARY.md`/`CONTEXT.md`.
      Also fixes the ADR index cutting a markdown link at the length cap
      *(engine + plugin 1.3.1, CAS-93;
      [decision 0014](docs/decisions/0014-a-zdd-release-pins-and-brings-in-one-pocock-release.md))*.
- [x] **2.0.0** — "choose patterns": blessings are read before building.
      A third verb and skill (`patterns`) between the design and the code; a
      generated blessing index (one line per blessing, by trigger question,
      app-level first); a committed pattern plan that `update` reconciles
      against the final diff, minting the blessings that survived and
      recording the rest in the commit message; CI's `lint --merge` refuses
      a merge while the plan exists. Lint now fails a blessing with no
      trigger question, and warns on one with no reason or over 300
      characters; an ADR is encouraged, no longer required. Also fixes map
      links to a bracketed path (a Next.js route-grouped layout such as
      `(app)--_layout.json`), which were dropped silently *(engine + plugin
      2.0.0, CAS-96, with CAS-94's fix;
      [decision 0015](docs/decisions/0015-choose-patterns-blessings-are-read-before-building.md))*.
- [x] **2.1.0** — the front end mapped truthfully, and the back end's
      background work: a variable path segment matches a route parameter and
      never a fixed word (the `/${plural}` → `/health` bug), with literal
      unions expanded; typed edges (`facts.edges`, a `verb` on graph edges);
      four opt-in extractors — `components` (React and React Native),
      `expo-router` (early), `jobs` (workers and scheduled jobs from
      manifests), `services` (declared markers, env names only); realtime
      `subscribes` edges; app membership from the map's Application pages,
      a UI Components band, component fan-in thresholding and an app filter
      in the viewer; `claims.strictKinds`; the plugin's session-start
      release check *(engine + plugin 2.1.0, CAS-97; decisions
      [0016](docs/decisions/0016-typed-edges-are-additive.md)–[0020](docs/decisions/0020-jobs-from-manifests-services-from-declared-markers.md))*.
- [x] **2.1.1** — fixes from the first real adoption of 2.1 (Cascade): a
      subscribes or `.from()` ref reaches a table the migrations named with
      its schema (`public.audit_events`), and the migration replay treats
      `things` and `public.things` as one table, so a trigger or ALTER in
      the other spelling lands; the agent index links a service
      record as `.json`; a component's description is the comment attached to it, never an earlier JSDoc;
      the release check prints the route that moves a machine — restart,
      `claude plugin update`, restart *(engine + plugin 2.1.1, CAS-99)*.
      **Corrected in 2.2.0:** that route stalls on a machine where the
      marketplace was once added without a scope; 2.2.0's check adds the
      missing step there.
- [x] **2.2.0** — an install and an upgrade a new developer can't get
      wrong: bootstrap locks the repo to its release; **"upgrade ZDD"** (the
      `upgrade` skill) checks for a newer release, moves the lock, and on the
      new release shows every change before writing it, offers what is new
      with this repo's evidence, names the hand-written instructions the
      block now covers, and lists the commit; the release check removes a
      stray user-level declaration before the restart route; the instruction
      block carries the rules adopters had hand-written; bootstrap asks about
      Realtime wrappers; the README splits adopting from joining; a release
      checklist backed by tests binding writers to readers *(plugin 2.2.0,
      CAS-101; decisions
      [0021](docs/decisions/0021-bootstrap-locks-the-release-by-default.md)–[0022](docs/decisions/0022-the-pin-move-route-removes-a-stray-declaration-first.md))*.
- [x] **2.2.1** — the release and Pocock checks honour `CLAUDE_CONFIG_DIR`,
      found by 2.2.0's live smoke *(plugin 2.2.1, CAS-101)*.
- [ ] Next: a second viewer; Vue / Svelte / Angular extractors on their first
      real adoption.

## Versioning

Semver, tracked in both plugin manifests and the marketplace entry (kept in
sync — a test pins them together), and marked with a matching git tag
(`vX.Y.Z`). The plugin and the engine share a version line so `load`'s skew
warning can say "behind".

- **`0.x` — private, pre-release.** Building and proving against the PressPlay
  instance. The API (skill names, config shape, engine CLI) may change freely.
  `0.1.0` was the scaffold; `0.2.0` added the extracted + published engine;
  `0.3.0` made the curated half self-sufficient and added the optional `grill`
  companion; `0.4.0` was the runbook, `load`, the opt-in hooks and Codex.
- **`1.0.0` — first public release.** A clean repo adopts ZDD end-to-end in
  either host; engine and plugin both at 1.0.0. From here, breaking changes
  bump the major: on the engine, a config-schema or metadata-contract break,
  or a new *mandatory* generated file (it breaks adopters' CI —
  [decision 0002](docs/decisions/0002-graph-artifact-and-viewers.md)).
- **`1.1.0` — the curated half gets a prompt and a lint.** A third hook that
  is off until opted in; a wider advisory nudge; and one tightening of the
  blocking tier — a blessing citing a superseded or missing ADR now fails
  `lint`, so a repo carrying a stale blessing goes red on its first push after
  the pin moves (the lint doing its job; `--upgrade` says so and the fix is to
  re-bless or drop the line). No config-schema or metadata-contract change, so
  a minor.
- **`1.2.0` — the map learns what it has not placed.** A new extractor
  (`react-router`, backward-compatible: a config line), a new *warning* tier
  in `lint` (unclaimed records — exit 0, never a failure), a count in the
  human index header, and one more seeded file at fresh bootstrap. The
  header changes the human index's bytes, so a pin bump regenerates and
  commits it in the same PR as every engine bump does (`render --check` is
  red until then — the drift check doing its job, not the lint). Additive
  config-schema fields only, no metadata-contract change, so a minor.
- **`1.3.0` — your own stack, without a fork.** A fifth skill and its
  scaffold script, and one addition to the extractor contract: `derive` now
  receives `io`. Existing extractors ignore that argument; a scaffolded
  extractor needs 1.3.0 and says so loudly on an older engine. `io`'s shape is now public surface — changing what `read` or `walk`
  returns would be a major. Two ref fixes change bytes for some adopters
  ([decision 0011](docs/decisions/0011-refs-err-toward-might-touch.md)).
  Ambiguous route calls gain refs, and React Router screens lose the refs
  of data-module functions they never import. The pin bump regenerates
  them, like every engine bump. `claims` is an additive config key, off by
  default ([decision 0012](docs/decisions/0012-strict-claims-are-opt-in.md)).
  One case newly fails: a React Router `routesFile` that no longer exists
  beside a folder that does. That repo was already deriving the wrong
  inventory. No breaking config-schema or metadata-contract change, so a
  minor.
- **`1.3.1` — one Pocock release per ZDD release.** A patch: a bug fix (the
  ADR index link cut), a new *warning* in `lint`, two more files bootstrap
  writes only when absent (`docs/agents/domain.md`, the four plugin lines in
  `.claude/settings.json`), and a dependency the Claude manifest now
  declares. An adopter's `render` bytes change only where an index line was
  cut inside a link. From here the Pocock tag in `pocock.json` moves only
  with a ZDD release.
- **`2.0.0` — choose patterns.** A major, for two reasons decision 0002 names:
  a new *mandatory* generated file (`zdd/blessing-index.md` — `render --check`
  fails until it is rendered and committed), and a new hard failure in `lint`
  (a blessing that does not open with its trigger question). The CI template's
  lint step becomes `lint --merge`, and `--upgrade` migrates an owned
  workflow. New config keys `paths.blessingIndex` and `paths.patternsPlan`
  are additive. The agent index's reading-path footer changes, so every
  adopter's agent index gains two lines on the pin bump. **Maps that already
  link a bracketed path** (`[x](../../metadata/surface/(app)--_layout.json)`,
  or the `<…>` spelling) **gain an edge** — and the record becomes claimed,
  watched by freshness and a pointer candidate — where 1.x dropped the link
  without a word.

- **`2.1.0` — the front end, jobs and services.** A minor: everything is
  additive and opt-in, with one correction every adopter gets — a `*` in a
  scanned url no longer matches a fixed route segment
  ([decision 0019](docs/decisions/0019-a-variable-segment-matches-a-parameter-never-a-fixed-word.md)),
  so refs drop wherever a wildcard had reached `/health`; a `derive --check`
  diff on the pin bump, and lint now names the calls it could not place.
  Records gain `facts.edges` and graph edges gain `verb` only where an
  extractor emits one; the viewer bundle gains `app` and `layer` on every
  node and a `belongsTo` edge per record under an Application page, so the
  human index re-renders on the bump. New config keys (`claims.strictKinds`,
  the four extractors' options, `react-router.subscribeCalls`,
  `nextjs.refs.subscribeCalls`, `viewer.componentFanIn`) are additive. The
  extractor contract gains an optional `warnings` channel.

- **`2.1.1` — fixes.** A patch; no config or contract change, but bytes move
  on the pin bump wherever a fix applies, so re-derive and re-render: a
  table minted with its schema gains the edges that named it bare; a
  trigger function whose `create trigger … on public.x` targets a table
  created as `x` (or the reverse) gains its trigger facts and table edge; a
  component whose JSDoc sat after an exported type or constant gets its own
  description; an agent index with an External services list links `.json`.

- **`2.2.0` — the guided install and upgrade.** A minor: new bootstrap and
  upgrade behaviour, no config-schema or metadata-contract change, and no
  engine change beyond the shared version line — an adopter's generated
  artifacts do not move on the bump, only the engine pin in the workflow and
  config does. Bootstrap now writes `extraKnownMarketplaces` (the lock) into
  `.claude/settings.json`; an upgrade moves a lock that points at this
  repository and leaves any other alone. The instruction block grows by
  about a dozen lines, rewritten between its markers on upgrade (a managed
  pre-push hook is re-pinned too, like the workflow). A repo before 2.2
  moves its lock by hand once (see [Upgrading](#upgrading)).

- **`2.2.1` — the checks read the profile Claude Code reads.** A patch: the
  session-start release check and the Pocock-copy check read Claude Code's
  config folder from `CLAUDE_CONFIG_DIR` when it is set, instead of always
  `~/.claude` — under a custom profile they reported a false mismatch every
  session (also `CLAUDE_CODE_PLUGIN_CACHE_DIR`, and a hook whose environment
  was scrubbed finds the profile from its transcript). No config, contract or
  artifact change; the bump moves the engine pins and the release lock.

- **`2.4.0` — the ZDD record.** A minor: a new engine command, a new
  *warning* in `lint --merge`, and a rewritten `zdd/instructions.md` that
  "upgrade ZDD" replaces; no config-schema or metadata-contract change and
  no new generated file. **What moves on the bump**: nothing in
  `derive --check` or `render --check`; `zdd/instructions.md` and the pins.
  - *Say it when ZDD changes a decision*
    ([decision 0027](docs/decisions/0027-a-use-is-a-decision-turned-or-confirmed-said-at-the-moment-never-a-gate.md)):
    a use is the moment an artifact *turned* a decision, *confirmed* one, or
    showed code to *reuse*; reading never is. The agent prints one `ZDD: …`
    line then, with what would otherwise have happened, and carries on — no
    stop, no question. `load` declares with the same prefix and claims no
    benefit.
  - *The ZDD record*
    ([decision 0028](docs/decisions/0028-the-zdd-record-lives-in-the-update-commit-message-five-sections-in-plain-sentences.md)):
    "update ZDD" writes those lines into the update commit's message under
    `ZDD record:` — five sections (`glossary`, `adrs`, `blessings`, `map`,
    `comments`), fixed verbs, plain sentences. It replaces `Pattern record:`,
    which is still read as the blessings section. A host harness copies it
    out of the message; a squash merge loses it.
  - *The tally and its lint*
    ([decision 0029](docs/decisions/0029-the-tally-reads-git-and-the-stores-and-a-malformed-record-warns-never-fails.md)):
    `zdd-engine tally [--since <ref|date>] [--json]` counts turned,
    confirmed, reused and stored per section over the branch's history, then
    names the ADRs, glossary terms and blessings in the stores that no record
    ever named, and every commit whose record it could not fully read.
    `lint --merge` warns, never fails, on such a record; a branch with no
    update commit is never warned.
- **`2.3.0` — the plain-words install and upgrade.** A minor: every change
  below is additive, opt-in, or migrated for you by "upgrade ZDD". **What
  moves on the bump**, so you know what to expect in `derive --check` and
  `render --check`:
  - *ZDD's instructions* leave the marked block in `CLAUDE.md` for
    `zdd/instructions.md`, loaded by one line; the upgrade makes that change
    once and never edits `CLAUDE.md` again (`AGENTS.md` keeps a block;
    [decision 0024](docs/decisions/0024-zdd-instructions-in-a-file-of-their-own.md)).
    The text is rendered with your configured paths and names both install
    commands, the three cases a release line can mean, the merge-conflict
    steps, reuse-first, and where a finding is filed.
  - *What git ignores is never source* ([decision 0026](docs/decisions/0026-what-git-ignores-is-never-source.md)):
    a record that named a gitignored file (DiO's `.claude/worktrees/`
    copies) changes; `derive` stops when git cannot list the ignored set.
  - *External services*: the `services` extractor is `external-services`
    and its records `external-service` ([decision 0023](docs/decisions/0023-external-services-not-services-a-rename-that-moves-nothing-until-the-key-moves.md)).
    Under the old config key nothing moves; "upgrade ZDD" renames the keys,
    the strict kinds, the allow-list ids and the map's links, and the next
    `derive` moves `zdd/metadata/service/` to `zdd/metadata/external-service/`.
  - *Background work* ([decision 0025](docs/decisions/0025-background-work-is-what-runs-without-a-click.md)):
    the jobs extractor reads Vercel, Railway, Cloudflare and `pg_cron`
    schedules, Compose workers and BullMQ / Inngest / Trigger.dev / SQS
    queues, with a *Background work* section in the agent index; a
    package.json script counts only when a manifest runs it, so a hand-run
    script's job record leaves; GitHub Actions schedules are an opt-in.
  - *Blessings* are work-shaped pointers to reusable code; `lint` gains a
    *warning* for one that points at no code (never a failure).
  - *The agent index* gains `agentIndex.budgetTokens` and
    `agentIndex.levels` (two levels write `zdd/agent-index/<area>.md`; an
    explicit setting, so nothing moves unless you set it).
  - *New files*: `.gitattributes` gains one line; `zdd/instructions.md` is
    written. *New checks*: a preflight before any question, the CI offer
    only on GitHub (elsewhere the three commands), the Stop check silent on
    a question-ending turn and on ZDD's own files, the fence judging the
    write's target. The schema gains `jobs.includeGithubActions`,
    `agentIndex.budgetTokens`, `agentIndex.levels` and the
    `external-services` key (the old key accepted for this release).
  - *Release process*: a pushed tag publishes the engine and creates the
    GitHub release; the dry run proves the release on three scenario repos
    that are not DiO's or Cascade's.

## Contributing

Forks and pull requests welcome — the architecture is built for it, with a plug-in
point at **both ends**: **extractors** feed data in (a new convention — Rails,
Go, a router…), and **viewers** render it out (a new visualization of the human index). The
engine and the graph data model sit stable in the middle. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT — see [LICENSE](LICENSE).
