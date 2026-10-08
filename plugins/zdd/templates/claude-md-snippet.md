<!-- zdd:begin -->
<!-- Managed by Zero-Drift Docs (zdd): "upgrade ZDD" (`zdd:bootstrap --upgrade`) rewrites everything between the zdd:begin and zdd:end markers. -->
## Documentation — Zero-Drift Docs (ZDD)

This repo uses ZDD: seven documentation artifacts kept at most one unit of work
behind the code — six in `zdd/`, plus code comments in the source. Spoken
verbs carry it, in this order, and all work with any coding agent:

- **"load ZDD"** — before designing or building in an area. Read
  `zdd/glossary.md` whole, `zdd/adr-index.md` whole, and the ADRs your task
  cites; say what you loaded; then read the code fresh. Never trust the docs
  over the code. (Skill: `load`.)
- **"choose patterns"** — once the design is settled, before any code. Read
  `zdd/blessing-index.md` whole, open the blessings that match the work, and
  commit `zdd/patterns-plan.md`: per piece, follow a blessing, depart from one
  and why, none applies, or a new pattern to bless. (Skill: `patterns`.)
- **"update ZDD"** — before finishing a unit of work. Curate the artifacts the
  change touched (glossary / ADRs / comments / map), reconcile the pattern
  plan, regenerate the generated ones, and commit them with the code. Run it
  in the working session — never hand it to a subagent, which lacks the
  context it curates from. (Skill: `update`.)
- **"upgrade ZDD"** — to move this repo to a newer ZDD release: shows every
  change before writing it. (Skill: `upgrade`; first-time setup or repair:
  `bootstrap`; a stack ZDD does not read yet: `extractor`.)

A **release or engine-skew line** from ZDD's session-start checks (or `load`)
is the **first line of your reply**, verbatim, and is fixed before the task.

Never hand-edit the generated artifacts — `zdd/metadata/`, `zdd/graph.json`,
`zdd/agent-index.md`, `zdd/adr-index.md`, `zdd/blessing-index.md`,
`zdd/human-index.html`. A merge conflict in them is never resolved by hand:
merge the branch, commit the merge, then regenerate with "update ZDD". The
drift check fails otherwise, and it fails while `zdd/patterns-plan.md` exists.

**If ZDD's skills are missing** in Claude Code, the developer has not
installed it for this repo: tell them to run, from the repo's folder,
`claude plugin install zdd@zero-drift-docs --scope project`, then restart.
This repo switches other copies of Matt Pocock's skills off on purpose — ZDD
brings the one release it is tested with. Setup for each host, and joining a
repo: the ZDD README.

Optional: `grill` runs a design interview that writes glossary terms and ADRs
into `zdd/` as they crystallize (needs the `mattpocock-skills` plugin; without
it, work decisions out in plan mode and let "update ZDD" capture them). Matt
Pocock's skills read a root `GLOSSARY.md` and `docs/adr/` by default; this
repo's are under `zdd/`. See `docs/agents/domain.md`.
<!-- zdd:end -->