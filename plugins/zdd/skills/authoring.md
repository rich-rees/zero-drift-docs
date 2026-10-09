# Authoring the curated artifacts

Shared reference for `update`, `patterns`, `bootstrap`, and `grill`. The *generated*
artifacts (metadata, the graph, the indexes) are the engine's job and CI-enforced. The *curated*
ones — glossary, ADRs, comments, map — are judgment, and no script can gate them.
This is the discipline for writing them well.

When the metadata is thin because the engine does not read your stack's
convention, that is an extractor to add, not curation to write: the
[`extractor` skill](extractor/SKILL.md) scaffolds a local one in the repo.

*(The technique here is distilled from Matt Pocock's `domain-modeling` skill. If
the `mattpocock-skills` plugin is installed, `zdd:grill` runs the full interview
version live; this file is the compact form ZDD carries so it stands alone.)*

## Glossary entries

Format: one paragraph per term, `**Term**: definition.`

- **Canonical, not descriptive.** Each term has exactly one home; the glossary
  wins over any other document when they disagree.
- **No implementation detail.** The glossary says what a word *means*, never how
  it's built. If you're writing about tables or functions, it's not a glossary entry.
- **Sharpen, don't accumulate.** When a term is vague or overloaded, pin the precise
  canonical word and retire the fuzzy one ("you're saying *account* — do you mean
  Customer or User?"). Terms consolidate over time; they don't pile up. This is what
  keeps the glossary cheap enough to read whole at orientation.
- **Challenge conflicts on sight.** If new usage contradicts an existing entry, stop
  and resolve it — a silent redefinition is how vocabulary rots.

## ADRs — offer them *sparingly*

Write an ADR only when **all three** are true:

1. **Hard to reverse** — changing your mind later carries a real cost.
2. **Surprising without context** — a future reader will ask "why did they do it
   this way?"
3. **A real trade-off** — there were genuine alternatives and you picked one for
   specific reasons.

Miss any one and skip it — not every decision is an ADR, and a corpus full of
non-decisions is as useless as none. This three-way test is the judgment CI can
never make for you; it lives here on purpose.

Format (`zdd/adr/NNNN-kebab-title.md`, numbered continuing the sequence):

```markdown
# <Decision, as a short declarative title>

<The decision, and the context that forced it — a few sentences.>

## Why / rejected alternatives

- <Alternative considered> — <why it lost>.
```

**Supersession points both ways** and is linted (`zdd-engine lint`). When a new ADR
replaces an old one: the new one says it supersedes ADR-NNNN, and you stamp the old
one at the top — `**Superseded [in part] by ADR-MMMM**` — never edit a frozen ADR
into a new truth. History doesn't lie; it accretes.

## Semantic map — blessings

The map says *where, what-connects, what-to-copy*; never what the code does.
Groupings and non-textual edges are the first two. The third is the
**blessing**: a one-line entry under a `# Blessings` heading in a concept.

**A blessing is a generic, work-shaped pointer to reusable code.** It answers
a *recurring kind of work* ("Adding an upload?", "Adding an endpoint?") with
a pointer to **existing code to start from and, where possible, reuse** —
a shared base layer before a pattern to imitate — plus **the one trap it
refuses and its reason**. Pattern frequency in code is never a verdict — the
most common pattern is often the deprecated one — so a blessing is how the
map outranks "copy the nearest example", and how the AI reuses the helper
that already exists instead of writing a second one.

The model, from PressPlay (DIO-336):

```markdown
- Adding an upload? Start from `lib/media-upload-client.ts` (`uploadMedia`)
  — reuse or extend it before writing new upload code; video's larger flow is
  `VideoUploadContext` + the `signed-upload` route. Files go straight to
  Storage, never through a Vercel function (ADR-0098).
```

Three components already share `uploadMedia`, so a future PDF or audio
upload reuses it rather than writing new upload code. The old blessing
pointed only at the video route and hid that shared layer: a narrow pointer
at one feature's code is the shape to avoid.

**The test, applied wherever ZDD proposes or mints a blessing** — bootstrap's
mapping session and backfill, "choose patterns"' *new pattern, candidate
blessing*, and "update ZDD"'s minting step:

1. **Pointer first, and required.** Name the existing code to start from —
   a shared helper, a base layer, a reference implementation — before any
   pattern to imitate. A blessing with nothing to point at is not one: a
   rule whose substance is "decide X this way" ("Deciding where an answer
   is stored?") belongs in its **ADR and a code comment at the site**, not
   the map. `lint` warns on a blessing that points at no code.
2. **One trap, with its reason.** One instruction is allowed, as the thing
   the blessing refuses ("never through a Vercel function"), with the ADR or
   a "because".
3. **Generic, not narrow.** The question names a *kind* of work that recurs
   ("Adding an upload?"), not one feature's instance ("Adding the video
   upload?"); a map that drifts to many narrow blessings (PressPlay reached
   83) is re-cut to the shared layers (DIO-336 cut it to roughly 30–40).
4. **No exemplar yet: a candidate.** A new kind of work with no reusable code
   to point at is a *candidate blessing* in the pattern plan, minted at
   "update ZDD" once the code exists and the pointer is real.

A blessing is read at a known moment: **"choose patterns"** (the `patterns`
skill) reads the generated **blessing index** — one line per blessing, its
trigger question and its reason — before any code is written, and opens in
full only the blessings whose question matches the work. Blessings are
proposed there and **minted at "update ZDD"**, against the code as it merges.
So the shape below is what makes a blessing findable, not just tidy. The
whole lifecycle, with examples, is in
[docs/patterns.md](https://github.com/rich-rees/zero-drift-docs/blob/main/docs/patterns.md).

Format (one list item per blessing, under the heading):

```markdown
# Blessings
- Adding an endpoint here? Start from [POST /api/things](/metadata/route/things.json)
  — its auth and validation are the shared shape, per ADR-0012 — never inline
  the auth check.
- Saving a graph? Go through the RPC in `lib/graph-rpc.ts`, per ADR-0005 — never
  client-side diffing.
- Naming a migration? Prefix it with the ticket id, because two branches
  minting the same number merge without a conflict — never a bare sequence.
```

- **Open with the trigger question.** The first sentence is the question the
  blessing answers, ending in `?` — "Adding an endpoint here?", "A status that
  ends a record for good?". It is what the blessing index lists, so a
  blessing without one is invisible to a session choosing patterns, and
  `zdd-engine lint` **fails** it. Phrase it as the moment someone would reach
  for the pattern, not as the pattern's name.
- **Point at the code.** A metadata link (`/metadata/route/….json`) is what
  lets the freshness nudge notice when the blessed code changes; a path or a
  file in backticks (`lib/graph-rpc.ts`, with the function beside it) is fine
  for something the extractors do not inventory — a bare function name is
  not a pointer, name its file. An ADR link or a URL is the reason, not the
  exemplar. `lint` **warns** on a blessing with no pointer; a naming rule
  earns that warning and is fine.
- **Give the reason.** Cite the ADR that blessed it ("per ADR-0012"), or say
  why inline ("because …"). Neither is a lint **warning**: a blessing with no
  reason is an opinion. **An ADR is encouraged, not required** — cite one when
  the pattern passes the three-part test above; a house convention often does
  not, and forcing one breeds throwaway ADRs. A blessing citing an ADR that
  has been **fully superseded** (or that does not exist) **fails** the lint;
  one citing an ADR superseded *in part* gets a warning to check the blessed
  pattern — a stale blessing is worse than none, because it sends the agent
  to copy the refused pattern with a citation attached. When an ADR is
  superseded, re-bless under the new decision or drop the line, in the same
  unit of work.
- **Keep it short.** Over 300 characters of visible text (link text counts,
  link targets do not) is a lint **warning**. The question, the pointer, the
  refusal and the reason fit; the detail belongs in the ADR.
- **Name the refusal.** "Start from X" alone is a pointer; "start from X,
  never Y" is the judgment the reader needs.
- **App or feature.** A blessing that applies across an app (auth, data
  access, styling, uploads) goes in the app's concept under `map/apps/`; the
  index lists those first and a session reads all of them for an app it
  touches. A blessing for one feature's shape goes in that feature's slice.

## Code comments

A non-obvious *constraint* goes as a comment at the code site. A gotcha spanning
several sites is an ADR instead — one place, cited from each.

## The timing rule that makes all of it work

**Write it the moment it crystallizes — never batch, never "after merge."** The
value is captured while the context is hot; a decision reconstructed a week later
is half-remembered and usually wrong about the alternatives. Capture-as-you-go is
the whole trick, whether you're grilling, in plan mode, or mid-build.
