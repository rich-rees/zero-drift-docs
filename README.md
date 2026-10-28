# Zero-Drift Docs (ZDD)

A documentation architecture for repos built by **human + agent pairs**. ZDD keeps
eight documentation artifacts *at most one unit of work behind the code* — and, with
CI, makes drift in the machine-generated ones **un-mergeable**.

> **Status: 0.11.0.** The plugin installs in Claude Code
> and in Codex from this one repo; `bootstrap` detects your stack (or grills
> for it on a greenfield repo), proposes extractors with evidence, and *writes*
> the opt-ins; the engine (`packages/zdd-engine`, npm `@rich-rees/zdd`) is a
> core that knows no stack beside a catalogue of adapters, and carries the
> graph artifact + viewer registry. Two plug-in points are open for
> contributors: adapters in, viewers out. 0.9.0 starts a new version line:
> the old one, `@rich-rees/zdd-engine` 0.2.0 to 2.5.0, came before it
> ([decision 0042](docs/decisions/0042-the-engine-is-a-new-package-on-a-new-version-line.md)).

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
each what it needs, off **eight artifacts** — the design test for every fact:

> **Document only what grep cannot find and code cannot say.**

Five are **curated** (they can rot, so a per-PR ritual + CI watch them) and three are
**generated** (rot-proof by construction, never hand-edited). The count is by
*role*, not by file: the generated half also lands on disk as `zdd/adr-index.md`
(the ADRs' index, rendered; a harness set has `zdd/adr-harness-index.md` too, and
only then), `zdd/blessing-index.md` (the blessings, one line
each: the trigger question, where the code is, and why) and `zdd/graph.json`
(the machine form of the whole generated half — schema `zdd-graph/1` — from
which the human index is rendered). All are mandatory outputs of `render` and
all are fenced, but they are forms of artifacts 6–8, not a ninth, tenth and
eleventh.

| # | Artifact | Kind | Home |
|---|----------|------|------|
| 1 | Glossary — the ubiquitous language | Curated | `zdd/glossary.md` |
| 2 | ADRs — decisions + rejected alternatives (optionally a harness set beside the application set) | Curated | `zdd/adr/` (+ `zdd/adr-harness/`) |
| 3 | Code comments — constraints at the site | Curated | the source |
| 4 | Semantic map — groupings and non-textual edges | Curated | `zdd/map/` |
| 5 | Blessings — the code to copy or extend for a kind of work, and why | Curated | `zdd/blessings/` |
| 6 | Codebase metadata — mechanical inventory | Generated | `zdd/metadata/` |
| 7 | Agent index — feature-first orientation | Generated | `zdd/agent-index.md` |
| 8 | Human index — hosted graph view | Generated | `zdd/human-index.html` |

The semantic map is more than grouping that folder structure already does: it
names the product's parts and says what belongs to each, with the links the
code cannot show. The **blessings** sit beside it, one short file each naming
**where** the code to copy or extend is and the **pattern to refuse** —
"adding an endpoint? copy this one; never inline the auth check" — with the
ADR that blessed it. A blessing is the developer who built a great
file-upload component shouting across the table so everyone reuses it. They
answer a failure mode grep makes worse, not better: **pattern frequency in
code is never a verdict.** The most common pattern is often the deprecated one, and an
agent that copies the nearest example copies the wrong one with confidence. A
blessing is the curated answer; the engine's lint refuses a blessing whose ADR
has since been superseded, or whose `where:` names a file that no longer
exists, so a stale blessing cannot sit quietly (the format is in
[`skills/authoring.md`](plugins/zdd/skills/authoring.md)). A blessing is
**`copy`** (imitate this method) or **`extend`** (reuse this shared code); for
an `extend` blessing the index names who uses the code, worked out from the
metadata, because extending it means retesting them.

The ADRs can come in **two sets** (decisions 0033, 0034), when a team opts in:
the **application** set says what the product does, and can be handed to a
stakeholder as it stands; the **harness** set says how the team builds it —
review, tests, CI, the tracker, ZDD itself. Each has its own index. One number
line runs across both, so `ADR-0019` is one decision wherever it lives, a
citation never changes, and splitting an existing set renumbers nothing.

A blessing helps only if it is read before the code is written, so it has a
moment of its own. **"Choose patterns"** runs once the design is settled: it
reads the generated **blessing index** (every blessing's trigger question,
where and why, one line each) whole, opens the blessings that match the work, checks the inventory
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
`@rich-rees/zdd`), and templates (ZDD's instructions, CI workflow, pre-push
hook, config schema + example, the seed ADR-0001, and the extractor scaffold).

### What ZDD reads, per stack

| Layer | Extractor | Reads |
|---|---|---|
| Database | `supabase` | SQL migrations: tables, functions, triggers, buckets |
| API | `fastapi` | FastAPI decorators: routes, handlers, and the functions a handler calls (one hop, through the file's imports; an ambiguous target is skipped) |
| Data access (JS / TS) | `supabase-js` | the Supabase JavaScript client — `.from()`, `.rpc()`, Realtime `.on("postgres_changes")` and the wrapper calls named in `subscribeCalls` — one record per top-level declaration (the module's own top-level code as `<module>`) |
| Data access (Python) | `supabase-py` | the Supabase Python client — `.table()`, `.from_()`, `.rpc()` — one record per function |
| Data access (Python) | `sqlalchemy` | raw SQL in string literals (`text("…")`, any driver): the tables after `FROM` / `JOIN` (**reads**) and `INTO` / `UPDATE` / `DELETE FROM` (**writes**), one record per function; the ORM is not read |
| API + pages | `nextjs` | the App Router tree: route handlers, pages, layouts, middleware auth, `fetch('/api/…')` refs, and the code each file runs (for a data-access adapter) |
| Pages | `react-router` | a route tree declared in code: one surface per screen, its guards, the API calls and the code it runs one hop away |
| Native screens | `expo-router` *(early)* | the Expo Router folder tree: screens, layouts, `[id]` segments, platform pairs — namespaced so a native `/jobs` and a web `/jobs` are two surfaces |
| Components | `components` | React and React Native: exported, capitalised, returning JSX; props as written; **used by** / **uses** / **calls**; shared vs page-private |
| Background work | `background-vercel`, `background-railway`, `background-cloudflare`, `background-procfile`, `background-compose`, `background-pg-cron`, `background-bullmq`, `background-inngest`, `background-trigger-dev`, `background-sqs`, `background-github-actions` (opt-in), `background-declared` | everything that runs without a user clicking, one reader per platform file (0.9, decision 0038): scheduled — Vercel crons (`vercel.json`), Railway `cronSchedule`, Cloudflare `wrangler.toml` triggers, `pg_cron` in migrations, Trigger.dev scheduled tasks, and GitHub Actions schedules as housekeeping; workers — Railway, a Procfile, Docker Compose; queues — BullMQ, Inngest, Trigger.dev, SQS, producer and consumer with the queue's name; tasks declared by hand. One **background task** per task, however many readers see it (the same code, or the same command from the same folder). Each carries its trigger and what it hits (a route, a function, the module); a package script counts only when a manifest runs it; `reads` / `writes` from the tables the module's code reaches, as the data-access adapters read it; the mode never guessed |
| External services | `external-services` (`services` before 2.3) | declared markers — a package import, an env-name prefix (names only, never values); **depends on** from the files that carry a marker — never a file that reaches the provider through a settings object; undeclared candidates warned about on every derive |
| Realtime | *(in `supabase-js`)* | a Supabase Realtime subscription — `.on('postgres_changes', { table })` or a helper you name in `subscribeCalls` — as a **subscribes** edge on the page, screen, component or module whose code makes it |

**A Railway file is read by Railway too.** `background-railway` learns a
Railway service's start command and schedule from a committed
`railway.toml` / `railway.json`, but Railway applies that file as well — its
values override the dashboard — and Railway is retiring the format (a
service already using such a file keeps it working until 2026-12-01; a new
service cannot take it up; its Infrastructure as Code replaces it).
Commit one only if you mean Railway to apply it; otherwise keep it matching
what the dashboard runs, as a statement for the map. A start command that
names build output (`node dist/server.js`) is not a file in the repo: derive
warns, and a `background-declared` entry in config names the source file.

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
hand-written one is kept — after a split, `split-adrs` names it so the harness
folder can be added by hand). Keep the glossary under `zdd/`: moved to a root
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
  `@rich-rees/zdd` at the release's pinned version from the public
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

None of it on your machine yet? The next section is the whole list.

### Nothing installed yet

Node.js and git come from one command, and your coding agent can run it for
you (or read it out while you type). Say yes to the permission prompts it
raises, and **open a new terminal** when it finishes — the one you ran it in
does not know about the new programs yet.

- **Windows:** `winget install OpenJS.NodeJS.LTS Git.Git` (`winget` is the
  installer built into Windows 10 and 11).
- **Mac**, with [Homebrew](https://brew.sh): `brew install node git`.

`npm` and `npx` are not separate installs: they come with Node.js. In the
new terminal, `node --version` printing `v20` or higher means all three are
there.

**One Windows trap.** PowerShell may refuse to run `npx` with an error that
names the *execution policy* ("running scripts is disabled on this system").
That is a Windows safety setting, not a ZDD problem, and the fix is one line
that applies to your own user account only:

```
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

An agent should explain this one and ask before running it, because it
changes a setting rather than installing a program: it tells Windows that
scripts written or installed on this machine may run, while anything
downloaded still has to be signed — nothing more.

**The app must be a git repository.** If the folder has never been under git
(there is no `.git` folder in it), make it one, and tell git who you are
before the first commit:

```
git init
git config user.name "Your Name"
git config user.email "you@example.com"
```

ZDD reads the repo's history and locks its release by a git tag, so it does
not run on a plain folder. With these in place, carry on to the install
commands below: bootstrap opens with a **preflight** that checks every item
on the list above and names anything missing in plain words. When it reports
that everything ZDD needs is here, "bootstrap ZDD" is your next step.

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
claude plugin marketplace add rich-rees/zero-drift-docs@v0.11.0 --scope project
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
  `.on('postgres_changes')` inside a hook gives the hook's own module its
  `subscribes` edge (0.9), not the Next.js page that uses the hook: Next.js
  pages are read by folder, not by import. Name the hook in
  `supabase-js.subscribeCalls` and the page's call to it carries the edge.
- **Still on 2.2.1? The `services` extractor's default roots read gitignored
  folders**, including the `.claude/worktrees/` folder the Claude desktop app
  creates (a second checkout of the repo): the committed records can name
  worktree files, so local `derive --check` passes and CI fails. Until you
  move, set `extractorOptions.services.roots` to the folders that hold your
  source (for example `["apps", "scripts"]`). Fixed in 2.3.0: what git
  ignores is never source.
- Something ZDD got wrong, as opposed to something wrong in your repo, goes
  to the repo's [Discussions](https://github.com/rich-rees/zero-drift-docs/discussions),
  in "Bug reports"; your agent explains it and offers a ready-written report
  ([decision 0041](docs/decisions/0041-a-zdd-defect-goes-to-the-developer-and-the-repos-discussions.md)).
  Fixes ship together in a release, and you move only when a release
  carries something you need.

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

**A repo on the old line (2.5.0 or earlier)** moves to 0.9 by hand once:
the numbers start again at 0.9.0, so an old release's check for a newer one
never finds it ([decision 0042](docs/decisions/0042-the-engine-is-a-new-package-on-a-new-version-line.md)).
**A repo on a release before 2.2** has no "upgrade ZDD" at all. Either way,
move the lock by hand:

1. In `.claude/settings.json`, set
   `extraKnownMarketplaces["zero-drift-docs"].source.ref` to the new tag
   (`"v0.11.0"`). No lock there? Add the marketplace from the repo's folder with
   `claude plugin marketplace add rich-rees/zero-drift-docs@v0.11.0 --scope project`.
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
  bin/zdd-engine.mjs                # the CLI (derive / render / lint / freshness / tally / detect / coverage / preview)
  src/core/                         # the stack-free core: derive, render, lint, the stores, the viewers
  src/core/viewers/{cytoscape,minimal}/  # output end: human-index viewers over graph.json
  src/adapters/{supabase,nextjs,fastapi,react-router,components,expo-router,background-*,external-services,supabase-js,supabase-py,sqlalchemy,generic}/   # input end: one adapter per convention
  src/adapters/{js,python,background}/  # helpers adapters share (no index.mjs: not adapters)
  test/fixture*/                    # the miniature proving repos
docs/patterns.md                    # blessings and "choose patterns", the whole system
docs/decisions/                     # this repo's own decision record (ADR format)
LICENSE   CONTRIBUTING.md   README.md
```

## When ZDD starts to pay

On a small, young codebase a model can read everything it needs in one pass:
there is one way to do each thing, and the file that does it is the only
candidate grep returns. ZDD earns little there — and the generated half costs
almost nothing to keep, so there is no harm in having it from day one. As a
codebase grows and ages, grep starts guessing. It finds patterns by frequency,
misses the exemplar you meant, and copies the wrong one with complete
confidence: the approach you rejected in March comes back because three files
still carry it. That is where the curated artifacts — the glossary, the ADRs,
the blessings — and the two indexes pay: they tell the agent which candidate
is the one you meant, before it looks.

The axis is the codebase's **age and size**, not the team's. A one-person repo
of two years is exactly where this bites, because the agent is the second
person on every solo project: it has none of your memory, and it rebuilds its
picture of the repo from grep every session. `bootstrap` offers every opt-in
as a yes/no, so saying no to one is a visible choice, not a fork.

| Part | Solo developer | Team |
|---|---|---|
| The curated half — glossary, ADRs, blessings, map — and the "choose patterns" step that reads them | Keep. This is what you forget first. | Keep. |
| The generated half — inventory, agent index, human index — with `load`, `update` and their hooks | Keep. The inventory is what the map claims against, what the indexes render from and what lint checks; drop it and the proof goes with it. | Keep. |
| The CI check | Skip, and take the pre-push hook: it keeps a forgotten update loud without a merge gate. | Keep — the real guarantee. |
| The harness ADR set | Skip; one ADR set is enough until the repo carries a harness of its own. | Take it when the repo carries one. |
| `grill`, `extractor` | As needed. | As needed. |

## Roadmap

- [ ] Next: a second viewer; Vue / Svelte / Angular extractors on their first
      real adoption.
- [x] **0.11.0** — blessings carry an importance: `importance: high` for
      one that is often needed and costly to reinvent, listed first and
      marked in the blessing index, pinned with a chip in the Blessings
      peek, kept scarce by a lint warning *(ZDD-7; decision 0045)*.
- [x] **0.10.0** — a Blessings peek in the human index, beside Glossary
      and ADRs: every blessing by trigger question, its exemplar, app,
      users and cited ADRs; a filter and a back history in every peek
      *(ZDD-2; decision 0043)*.
- [x] **0.9.0** — a new line and a new package, `@rich-rees/zdd`: a core
      that knows no stack beside a catalogue of adapters, routes reaching
      tables through data-access records, background work one reader per
      platform file, detection in each adapter with a coverage report and
      a map check done together, an adapter contract number and one
      standard suite, ZDD defects to Discussions, and "upgrade ZDD"
      carrying an old-line repo across *(ZDD-3; decisions 0036–0042)*.
      1.0.0 follows with the video.
- [x] **Before 0.9** — ZDD was built and proven privately on an earlier
      line, `@rich-rees/zdd-engine` 0.2.0 to 2.5.0: the engine and its
      composed extractors, the graph artifact and its viewers, the bootstrap
      runbook in both hosts, blessings and "choose patterns", the release
      check and the guided upgrade, the ZDD record, and the blessing store.
      That line is retired; its notes, release by release, are in this
      repo's git history.

## Versioning

Semver, tracked in both plugin manifests and the marketplace entry (kept in
sync — a test pins them together), and marked with a matching git tag
(`vX.Y.Z`). The plugin and the engine share a version line so `load`'s skew
warning can say "behind".

**Two lines.** Before 0.9, ZDD was built and proven privately as
`@rich-rees/zdd-engine`, 0.2.0 to 2.5.0, and a repo's config pinned it as
`engine`. That line is retired, and its release-by-release notes live in git
history. From `0.9.0` the engine is `@rich-rees/zdd` and the pin is
`release`; every old-line release comes before every new-line one, whatever
the numbers say
([decision 0042](docs/decisions/0042-the-engine-is-a-new-package-on-a-new-version-line.md)).
A repo still on the old line moves its lock by hand once, then says "upgrade
ZDD" (see Upgrading). Before 1.0 the adapter contract stays at 1 and may
still change; 1.0.0 freezes it.

- **`0.11.0` — blessings carry an importance.** A blessing file's header
  may say `importance: high` for a blessing that is often needed **and**
  costly to reinvent (the side peek every details page uses, so nobody
  builds a modal of their own). The blessing index lists it first in its
  section with a bold **high**; the human index pins it to the top of the
  Blessings peek with a chip; ZDD's instructions say a plan that departs
  from it says why. A session proposes it and the developer confirms;
  `lint` fails any value but `high` and warns when more than a fifth of
  the store is high. The viewer contract's blessing entry gains
  `importance`, high entries first (decision 0045). **What moves on the
  bump**: every pin ZDD owns names `@rich-rees/zdd@0.11.0`; `render --check`
  moves `human-index.html`; "upgrade ZDD" rewrites `zdd/instructions.md`
  and the `AGENTS.md` block (one clause); `blessing-index.md` moves only
  once a blessing is marked high; no graph or metadata byte changes.
  Nothing to answer — the upgrade never marks a blessing high.
- **`0.10.0` — a Blessings peek in the human index.** A Blessings button
  beside Glossary and ADRs opens every blessing in the store, listed by
  trigger question with its kind and app as chips; a blessing's page shows
  its body, its exemplar on GitHub (via `repoBase`), the app it applies to,
  the slice it was first built in, who uses an `extend` exemplar, and the
  ADRs it cites, which open in the same peek. One filter box now serves the
  glossary, the ADRs and the blessings, and the peek keeps a back history
  that names where back goes. The viewer contract's `docs` gains
  `blessings`, ready-read by the engine (decision 0043). **What moves on the
  bump**: every pin ZDD owns names `@rich-rees/zdd@0.10.0`, and
  `render --check` moves `human-index.html` only, and only with the
  reference (`cytoscape`) viewer — `minimal` or a viewer of your own may
  ignore the new key and show no change — no graph, metadata, agent-index
  or blessing-index byte changes. "upgrade ZDD" rewrites the
  pins and re-renders; nothing to answer.
- **`0.9.0` — a stack-free core and a catalogue of adapters, on a new line.**
  The engine is a new package, `@rich-rees/zdd`, numbered from 0.9.0
  (decision 0042); the plugin keeps its marketplace address. Its files can
  no longer be imported (an `exports` map opens `package.json` only): the
  command line is the contract. The config's `engine` pin becomes
  `release`; an `engine` found beside a `release` (written by a teammate's
  plugin from before 0.9) is dropped and named, and a `release` that is not a
  version is refused. **What moves on the
  bump**: every pin ZDD owns (config, CI workflow, pre-push hook) names
  `@rich-rees/zdd@0.9.0`; `derive --check` moves wherever a route or screen
  reached a table — routes now reach tables through data-access records,
  so each repo with a database gains data-access records and its graph
  gains a box between route and table (one adopter: 327 records on 2.5,
  313 without `supabase-js`, 327 with it; another gains 68 with
  `sqlalchemy`) — and every `metadata/job/` record moves to
  `metadata/background-task/`; `render --check` then moves `graph.json`,
  the agent index and the human index with them. The CI workflow gains the
  `suite` step. "upgrade ZDD" adds the data-access adapters detection
  proposes, moves `subscribeCalls` to `supabase-js`, splits `jobs`, rewrites
  the pins and `zdd/instructions.md`, and repairs map links to old `job:`
  records — a minor by decision 0035, on the new line.
  - *The core and the catalogue* (decision 0036): `src/core` names no
    stack, held by a test; each adapter in `src/adapters` owns its reader,
    detection, options and fixtures. The built-in fallback non-area tags
    (`rls-disabled`, `media-project`) are gone: list them in `nonAreaTags`
    if your areas leaned on them.
  - *Data access* (decision 0037): `supabase-js`, `supabase-py` and
    `sqlalchemy` record each function's tables; a route reaches them on
    file + function. Without one, derive warns `[data-access]` on every run.
  - *Background tasks* (decision 0038): `job` is `background-task`, one
    reader per platform file (`background-vercel`, `-railway`,
    `-cloudflare`, `-procfile`, `-compose` and the queue readers).
  - *Detection in each adapter* (decision 0039): `zdd-engine detect`,
    `coverage` and `preview`; bootstrap names what is covered and what is
    not, and the first map check is done together.
  - *The adapter contract and the suite* (decision 0040): `CONTRACT = 1`
    and one standard suite, run in CI on a repo's own adapters;
    `suiteChecks` says how many checks block.
  - *Defects* (decision 0041): a ZDD defect is explained to the developer
    and offered as a report to ZDD's Discussions; the repo has no Issues.

## Contributing

Forks and pull requests welcome — the architecture is built for it, with a plug-in
point at **both ends**: **extractors** feed data in (a new convention — Rails,
Go, a router…), and **viewers** render it out (a new visualization of the human index). The
engine and the graph data model sit stable in the middle. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT — see [LICENSE](LICENSE).
