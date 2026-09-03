# Authoring the curated artifacts

Shared reference for `update`, `bootstrap`, and `grill`. The *generated*
artifacts (metadata, indexes) are the engine's job and CI-enforced. The *curated*
ones — glossary, ADRs, comments, map — are judgment, and no script can gate them.
This is the discipline for writing them well.

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

## Code comments

A non-obvious *constraint* goes as a comment at the code site. A gotcha spanning
several sites is an ADR instead — one place, cited from each.

## The timing rule that makes all of it work

**Write it the moment it crystallizes — never batch, never "after merge."** The
value is captured while the context is hot; a decision reconstructed a week later
is half-remembered and usually wrong about the alternatives. Capture-as-you-go is
the whole trick, whether you're grilling, in plan mode, or mid-build.
