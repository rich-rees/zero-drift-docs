# Blessings and "choose patterns"

How ZDD makes an agent copy the right pattern instead of the nearest one,
from the blessing's file to the record in the commit. The rationale and the
alternatives that lost are in
[decision 0015](decisions/0015-choose-patterns-blessings-are-read-before-building.md)
and, for the blessing store, [decision 0031](decisions/0031-blessings-live-in-a-store-of-their-own-one-file-each-with-a-where-and-a-kind.md);
the authoring rules are in
[`plugins/zdd/skills/authoring.md`](../plugins/zdd/skills/authoring.md).

## Why blessings exist

Grep finds patterns by frequency, and **frequency is never a verdict**. The
most common way a codebase does something is often the deprecated way: the
old pattern has had longer to spread. An agent that copies the nearest
example copies the wrong one with confidence, and code review sees locally
plausible code. When the agent does not know that a helper already exists,
it writes a second one.

A **blessing** is the curated answer: one short file in the blessing store,
`zdd/blessings/`, naming **where** the code to copy or extend is, the
**pattern to refuse**, and **why**. It is how ZDD outranks "copy the nearest
example". It is the developer who built a great file-upload component
shouting across the table so everyone reuses it: "need X? here's the code,
and here's why".

```markdown
---
where: app/deps.py (current_user)
kind: copy
applies-to: apps/api
adr: ADR-0024
---

Adding an endpoint? Take the user with `Depends(current_user)`, as
[GET /me](../metadata/route/me.json) does — never check a role inside the
endpoint's body.
```

The file name, `adding-an-endpoint.md`, is the blessing's name. `kind` says
which of two things it is: **`copy`**, a method you imitate in new code
without touching the exemplar, or **`extend`**, shared code you reuse and,
if you must, extend — and then everything that already uses it has to be
retested.

A blessing is worth something only if it is read **before the code is
written**, by a session that knows what it is about to build. Before 2.0, ZDD
wrote and linted blessings carefully and nothing read them at that moment.
"Choose patterns" is that moment.

## The three moments

ZDD has three spoken verbs. Each works with any coding agent, and each has a
skill that carries it.

| Moment | Verb (skill) | Reads | Writes |
|---|---|---|---|
| Before designing | **"load ZDD"** (`load`) | glossary, ADR index (and the harness ADR index for work on how the team builds), cited ADRs, agent index | nothing; it declares what it loaded and points at the next step |
| Design settled, before code | **"choose patterns"** (`patterns`) | blessing index, matching blessings, agent index and metadata | `zdd/patterns-plan.md` |
| Before finishing | **"update ZDD"** (`update`) | the plan, the final diff | curated artifacts, new blessings, regenerated artifacts, the ZDD record in the commit message (its `blessings` section is the reconciled plan); deletes the plan |

**Load** says what exists. The **design** (a grilling session, plan mode, a
spec) says what we want. **Choose patterns** needs both, so it runs after the
design is settled and before any code. When the work is split into tickets,
it runs per ticket, as that ticket's build starts. A spec may list likely
blessings as a hint; only the ticket's own step binds.

## The blessing index

`render` writes `zdd/blessing-index.md` (`paths.blessingIndex`): one line per
blessing, its trigger question linked to its file, then **where** and
**why**. House rules come first, under the app they apply to; every other
blessing follows in one list, by question.

```markdown
## Applies to [API](map/apps/api.md)

- [Adding an endpoint?](blessings/adding-an-endpoint.md) — copy: `app/deps.py` (current_user) · why: [ADR-0024](adr/0024-auth-at-the-dependency.md)
- [Recording who did what?](blessings/recording-who-did-what.md) — extend: `app/audit.py` (record_change), used by 3: /jobs, /offers, /tenants · why: [ADR-0026](adr/0026-audit-in-the-transaction.md)

## Every other blessing

- [Naming a job state?](blessings/naming-a-job-state.md) — copy: `app/jobs/states.py` · why: because the mobile app switches on the string
- [Writing to something a tenant owns?](blessings/writing-to-a-tenant-record.md) — copy: `app/tenancy/lock.py` (lock_then_judge) · why: [ADR-0042](adr/0042-lock-then-judge.md)
```

It is a generated artifact like the agent and ADR indexes: never edited by
hand, fenced against edits when the fence is on, and checked by
`render --check`. It exists so the step can **read every question at once
and open only the blessings that match**. Each blessing costs about 95 tokens
in full and about 25 tokens as an index line, so the index stays cheap to read
whole at hundreds of blessings, where reading every blessing would not.

**House rules** carry `applies-to:` naming an app or package page
(`apps/api`). They are cross-cutting rules such as auth, data access or
styling, so the step reads **every one of them in full** for each app the
work touches. Every other blessing is opened when its question matches.
`first-built-in:` remembers the slice a pattern was first built for; it
never decides where the blessing applies — a file-upload pattern does not
"belong" to the feature that happened to need it first.

**Who uses an `extend` blessing's code** is worked out on every render from
the metadata: every record that references the exemplar's record, or that
it says uses it. "Users unknown to ZDD" means no record has that file (an
extractor that is off, a language ZDD does not read): the step greps for the
callers instead. The list is never written by hand, because a hand-written
list is stale the first time someone adds a caller.

The agent index's reading path names the blessing index, so a session that
has only the auto-injected index still learns where the patterns are.

## Choosing patterns

The `patterns` skill walks the session through it:

1. **Inputs.** ZDD is loaded. The design is named in one line and split into
   **pieces of work**: "a new endpoint", "a screen", "a table and its
   migration", "a background job". The apps it touches are named.
2. **Read the blessing index whole**, open every house rule for a touched
   app, and open every blessing whose question matches a piece. A piece that
   extends an `extend` blessing's code lists its users on the plan's
   *Retest* line.
3. **Look for logic that already exists.** Blessings cover *how to build X*.
   "This already exists" is the inventory's job, so the step checks the agent
   index's pointers and the metadata (functions, routes, modules, tables) and
   then greps. A function to reuse is a line in the plan.
4. **Name unblessed precedent**: existing code the session means to copy that
   no blessing covers. Saying so turns a silent copy into a decision someone
   can check.
5. **Choose one outcome per piece:**
   - **follow** a blessing, because …
   - **depart from** a blessing, because … (legitimate when it has a reason;
     a silent departure is the failure the step prevents)
   - **no blessing applies** (and what was checked)
   - **new pattern, candidate blessing**, because …
6. **Commit the plan.**

## The pattern plan's lifecycle

```
choose patterns ──► zdd/patterns-plan.md committed on the branch
        │                 │  (crosses sessions and machines)
        ▼                 ▼
      build ──────► changes of mind = edits to the plan, with the reason
        │
        ▼
  update ZDD ─────► reconcile against the final diff
                    ├─ mint the candidates that survived (one file each, in zdd/blessings/)
                    ├─ check every Retest line was retested
                    ├─ record the dropped ones, and why
                    ├─ offer unblessed precedent (minted on the developer's word)
                    ├─ write the "ZDD record:" (its blessings section) into the update commit's message
                    └─ git rm the plan in that same commit
        │
        ▼
     merge ───────► CI's `lint --merge` has refused the merge while the plan existed
```

- **The plan is a committed working file**, so another session or another
  machine can pick up the build where this one stopped.
- **Propose at plan, decide at update.** The build can kill a pattern, change
  it, or create one the plan never saw. So blessings are **minted at
  update**, against the code as it will merge, never at plan time.
- **The record lives in the update commit's message**, as the `blessings`
  section of the ZDD record (2.4, decisions 0027–0029; `Pattern record:`
  before that), one plain-sentence line per piece opening with its verb:
  `followed`, `departed … because`, `minted … pointing at <path>`,
  `dropped candidate … because`, `precedent … minted | declined`,
  `no blessing applied`. `zdd-engine tally` counts them over history.
- **The plan is deleted in the update commit, never at merge.** A merge runs
  no code. If the plan were left for the merge, it would land on the base
  branch.
- **A late update** (a fix after update already ran) reads the plan and the
  first record back from git history and writes an **amended record** with
  only what changed.

The plan file's shape:

```markdown
# Pattern plan

Work: CAS-123 — invite a planner to a tenant
Apps touched: api, web (house rules read in full)

## Plan

- **POST /invitations** — follow `adding-an-endpoint` ("Adding an endpoint?") — the admin dependency covers the role check
- **invitation email** — follow `asking-another-system` ("Asking another system to do something?")
- **invite form** — depart from `an-admin-form` ("A form an administrator fills in?") — because the invitee picks no tenant; one field
- **invitation expiry** — new pattern, candidate blessing (copy): "A record that lapses on its own? Store the deadline, judge it on read — never a sweep." — because there is no job runner on web

## Retest

- **invitation email** — extends `asking-another-system`'s `apps/api/app/outbound.py`: retest /jobs, /offers

## Reuse

- **invitation email** — reuse `enqueue_email` in `apps/api/app/outbound.py`

## Unblessed precedent

- **invite form** — copying `apps/web/src/admin/UsersPage.tsx`, which no blessing covers — because it already has the admin shell
```

## Enforcement

| Check | Where | Result |
|---|---|---|
| A blessing that does not open with a trigger question | `lint` | **fails** (it would be invisible in the index) |
| A blessing citing a fully superseded or missing ADR | `lint` | **fails** (unchanged since 1.1) |
| A blessing with no `where:`, or one that names no file in the repo | `lint` | **fails** (2.5: a blessing is a pointer to reusable code; a moved exemplar goes red) |
| A blessing with no `kind:`, or one that is neither `copy` nor `extend` | `lint` | **fails** (2.5) |
| An `applies-to:` that names no app or package page | `lint` | **fails** (2.5) |
| A Blessings section left on a semantic-map page | `lint` | **fails** (2.5: "upgrade ZDD" moves them) |
| A `first-built-in:` that names no map page, or a header line ZDD does not read | `lint` | warning |
| A blessing with no reason (no ADR, no "because …") | `lint` | warning |
| A blessing over 300 visible characters | `lint` | warning |
| A blessing's `where:` file changed without the blessing | `freshness` | listed, advisory |
| The blessing index out of date, hand-edited or missing | `render --check` | **fails** |
| The pattern plan exists | `lint --merge` (CI) | **fails** |
| The pattern plan exists | `lint` (local, pre-push) | warning: the branch must stay pushable mid-build |
| A hand edit to the blessing index | the fence (opt-in) | refused, naming `update` |

The CI template runs `lint --merge`. "upgrade ZDD" adds the flag to an
owned workflow's lint step and names a workflow of any other shape for you to
edit by hand.

## The shape of a blessing

Full rules are in [`authoring.md`](../plugins/zdd/skills/authoring.md). In
short:

- **A pointer to reusable code first** (2.3, CAS-103): a blessing answers a
  recurring *kind* of work with the existing code to start from and reuse —
  a shared helper or base layer before a pattern to imitate — plus the one
  trap it refuses. "Adding an upload? Start from `lib/media-upload-client.ts`
  (`uploadMedia`) — reuse or extend it before writing new upload code … never
  through a Vercel function (ADR-0098)." A rule with no code to point at is an
  ADR and a code comment, not a blessing; a kind of work with no exemplar yet
  is a candidate, minted once the code exists.
- **Open with the trigger question.** The first sentence is the question the
  blessing answers, ending in `?`, phrased as the moment someone would reach
  for the pattern: "Adding an endpoint?", "A status that ends a record for
  good?".
- **Give the reason**: an ADR citation, or an inline "because …". An ADR is
  encouraged when the pattern passes the three-part test, not required.
  House conventions often do not pass it.
- **Keep it under 300 visible characters.** Link text counts and link targets
  do not. The question, the exemplar, the refusal and the reason fit; the
  detail belongs in the ADR.
- **Name the code in `where:`**, a repo file and optionally the symbol in
  brackets. Freshness notices when that file changes; lint fails when it no
  longer exists.
- **Say the `kind:`**: `copy` or `extend`.
- **Name the refusal**: "copy X, never Y".

```markdown
Adding an endpoint? Copy POST /api/things, per ADR-0012 — never inline the
auth check.                                     ✓ (with where: and kind: in its header)
Copy POST /api/things for new endpoints.         ✗ no question: lint fails
Adding an endpoint? Copy POST /api/things.       ⚠ passes, with a warning: no reason
Naming a migration? Prefix it with the ticket id. ✗ no where: — a naming rule is an ADR and a code comment, not a blessing
```

## How a host harness carries it

ZDD relies on two things only: the plan file on the branch, and the record in
the update commit's message. A harness that wraps the build can carry them
further. For example, Cascade's harness:

- runs "choose patterns" after its design session and before it writes the
  **build manifest**, and the manifest carries the plan as a `Patterns:` line
  beside its `Seams:` line;
- on its decompose path, runs the step per ticket as that ticket's build
  starts;
- puts a **Patterns** section in its build summary (followed, departed and
  why, candidates minted or dropped), refreshed at closure from the record.

None of that is required. A repo with no harness gets the same guarantee from
the spoken verbs and the merge gate.

## Adopting it in an existing repo

Say "upgrade ZDD", then:

1. **Move the blessings** (2.5, [decision 0032](decisions/0032-the-upgrade-moves-blessings-out-of-the-map-after-showing-the-list.md)).
   The upgrade lists every blessing still on a map page with what it would
   write — its file name, `where:`, a proposed `kind:`, `applies-to:` for a
   blessing from an app page, `first-built-in:` — and writes nothing until
   the developer has read the list, checked each kind, and said yes. A
   blessing with no question, or nothing in it that names a repo file, stays
   where it is and is named, to fix by hand.
2. `render`, and commit `zdd/blessing-index.md` in the upgrade PR.
3. `lint`: every blessing it fails for having no trigger question gets one.
   Propose them as **one reviewable file** — each blessing with the question
   it would answer, one line each — approved by the developer in one pass
   (2.3: never one question per blessing; PressPlay had 62 at once).
4. Optionally, take a pass over the length and reason warnings.

From the next unit of work on, say "choose patterns" once the design is
settled.
