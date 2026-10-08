# 0022 — The pin-move route removes a stray declaration first

**Date:** 2026-10-08 · **Status:** accepted · **Origin:** CAS-101, from CAS-99. When a PR moves a repo's lock, every other developer runs the *pin-move route*. 2.1.0's release check printed a remove → add → install route; 2.1.1 (CAS-99) replaced it with restart → `claude plugin update` → restart, observed working on the CAS-98 PC. On Rich's laptop the same restart route **failed**: coming from 1.3.1, the catalogue stayed at `v1.3.1` and `plugin update` said "already at the latest version". Only remove → `add …@<tag> --scope project` → install → restart worked.

## What the experiment established (2026-10-08, Claude Code 2.1.289 → 2.1.295)

Two throwaway profiles (`CLAUDE_CONFIG_DIR`), each with a scratch repo
declaring the marketplace at `v1.3.1`, logged in and trusted interactively:

| Profile | How the catalogue was first added | After the repo's lock moved to `v2.1.0` and a restart |
|---|---|---|
| D | only from the repo's declaration (trusting the folder) | catalogue moved to `v2.1.0`, silently |
| M | a plain `claude plugin marketplace add rich-rees/zero-drift-docs@v1.3.1` | catalogue **stayed** at `v1.3.1`, silently |

- A plain `marketplace add` (no `--scope`) also writes a **user-level**
  declaration ("declared in user settings") into `~/.claude/settings.json`.
  While it is there, the repo's newer ref does not move the catalogue.
- `claude plugin marketplace remove zero-drift-docs --scope user` deleted
  only that declaration; the catalogue and both project installs survived
  (the repo still declares the marketplace). The next restart moved the
  catalogue to `v2.1.0`, and `claude plugin update zdd@zero-drift-docs` moved
  the install 1.3.1 → 2.1.0 (scope auto-detected).
- `claude plugin marketplace update` keeps the recorded ref either way.
- Headless `claude -p` applies no declaration in an untrusted or logged-out
  profile: the reproduction needs an interactive, logged-in session.
- Trusting a folder clones a declared catalogue but installs **no** plugins
  and shows no prompt; `claude plugin install zdd@zero-drift-docs --scope
  project` installs zdd and, as its dependency, the pinned Pocock.
- A plain `marketplace add` also rewrites the repo's `.claude/settings.json`
  in its own key order.

The laptop's catalogue had been added by hand at 1.3.1; the CAS-98 PC's came
from Cascade's declaration. That is the whole difference.

## Decision

The release check reads the marketplace's declarations outside the repo's
project settings — the user's `~/.claude/settings.json` and the repo's
`.claude/settings.local.json` — and, when the catalogue is behind the lock,
prints for each one found `claude plugin marketplace remove zero-drift-docs
--scope <user|local>` **before** the rest of the route: restart (the catalogue
follows the lock), `claude plugin update` each installed plugin (install a
missing one with `--scope project`), restart again. On a machine with no
stray declaration the route is the short one; nobody runs a step they do not
need. A stray declaration while the catalogue is at the lock is not
reported: the check speaks only about a mismatch.

Adopters never run a plain `marketplace add`: bootstrap writes the
declaration ([0021](0021-bootstrap-locks-the-release-by-default.md)), and
the README's joining path is install-only.

## Why / rejected alternatives

- **Always print the heavy route** (remove every scope → add at the lock →
  install → restart). Works everywhere, but the full remove uninstalls the
  plugins and the add rewrites the repo's settings file, on every machine,
  every release, to cure a state most machines are not in.
- **The restart route alone** (2.1.1). Fails silently wherever a hand add
  left a user-level declaration — the laptop — which is exactly the
  developer who set ZDD up first.

## Consequences

- 2.1.1's notes and GitHub release are corrected to point here.
- If a future Claude Code lets a project declaration win over a user one,
  the remove step becomes a harmless no-op the check stops printing once the
  stray line is gone; nothing else changes.
