# Zero-Drift Docs (ZDD) — how this repo's documentation works

This repo uses ZDD: seven documentation artifacts kept at most one unit of work
behind the code — six in `<BUNDLE_DIR>/`, plus code comments in the source. Spoken
verbs carry it, and all work with any coding agent:

- **"load ZDD"** — before designing or building in an area. Read
  `<GLOSSARY>` whole, `<ADR_INDEX>` whole, and the ADRs your task
  cites; say what you loaded (`ZDD: loaded …`); then read the code fresh.
  Never trust the docs over the code. (Skill: `load`.)
- **"choose patterns"** — once the design is settled, before any code. First
  check for existing code to reuse, then read `<BLESSING_INDEX>` whole and
  open the blessings that match the work; commit `<PATTERNS_PLAN>`: per
  piece, reuse this code, follow a blessing, depart from one and why, none
  applies, or a new pattern to bless. (Skill: `patterns`.)
- **"update ZDD"** — before finishing a unit of work. Curate the artifacts the
  change touched (glossary / ADRs / comments / map); reconcile the pattern
  plan (mint the blessings that survived, record the rest in the commit
  message, delete the plan); regenerate the generated ones; write the ZDD
  record (below) into the commit's message; commit them with the code. Run it
  in the working session — never hand it to a subagent. (Skill: `update`.)
- **"upgrade ZDD"** — to move this repo to a newer ZDD release: it shows every
  change before writing it. (Skill: `upgrade`. First-time setup or repair:
  `bootstrap`; a stack ZDD does not read yet: `extractor`.)

**Say it when ZDD changes a decision.** A use is the moment an artifact *turned* a
decision (you were about to do one thing; it sent you another way), *confirmed* one,
or showed code to *reuse*; reading is never a use. Print one line then and carry on
— no stop, no question — saying what you would otherwise have done: `ZDD: ADR-0015
turned — I was about to read jobs straight from the database; the app goes through
/api/jobs`. "update ZDD" writes these as the **ZDD record** (sections `glossary`,
`adrs`, `blessings`, `map`, `comments`; `turned` / `confirmed` / `reused` / `stored`
lines in plain sentences, or `- none`) into the update commit's message;
`zdd-engine tally` counts them over the repo's history.

**A release or engine-skew line** from ZDD's session-start checks (or `load`)
is the **first line of your reply**, verbatim, and is fixed before the task.
Which fix depends on what the line says:
- *this machine is behind the repo's lock* — run the commands the line
  prints, then restart;
- *this branch is behind main* (a teammate's PR moved the lock and this branch
  has not merged it) — merge main into the branch; nothing to install;
- *the repo is behind the newest ZDD release* — "upgrade ZDD", only if the
  team chooses to; it is not a fault.

**Never hand-edit the generated artifacts** — `<METADATA_DIR>/`, `<GRAPH>`,
`<AGENT_INDEX>`, `<ADR_INDEX>`, `<BLESSING_INDEX>`,
`<HUMAN_INDEX>` — or this file (`<INSTRUCTIONS>`). A merge conflict in a generated file is
never resolved by hand: take either side (`git checkout --theirs -- <file>`,
then `git add <file>`; it is about to be rebuilt), finish the merge, commit
it, then regenerate with "update ZDD" and commit that. On a rebase, the same
for each replayed commit, regenerating once at the end. The drift check fails
otherwise, and it fails while `<PATTERNS_PLAN>` exists.

**If ZDD's skills are missing** in Claude Code, the developer has not installed ZDD
for this repo. Tell them to run, from the repo's folder:
`claude plugin install mattpocock-skills@zero-drift-docs --scope project`, then
`claude plugin install zdd@zero-drift-docs --scope project`, then restart Claude
Code. ZDD's design interview and related skills are built on Matt Pocock's skills,
so ZDD installs the one release of them it is tested with, and this repo switches
other copies off on purpose. Setup, and joining a repo: https://github.com/rich-rees/zero-drift-docs#readme.

Optional: `grill` runs a design interview that writes glossary terms and ADRs into
`<BUNDLE_DIR>/` as they crystallize (needs the `mattpocock-skills` plugin; without it,
work decisions out in plan mode and let "update ZDD" capture them). Matt Pocock's
skills read a root `GLOSSARY.md` and `docs/adr/` by default; this repo's are under `<BUNDLE_DIR>/`. See `docs/agents/domain.md`.

**A ZDD defect** — something ZDD itself got wrong, not something wrong in this
repo — goes to ZDD's issues page, https://github.com/rich-rees/zero-drift-docs/issues,
labelled `finding`. Propose filing it to the developer first, like any task.
