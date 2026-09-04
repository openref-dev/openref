# The committed gates

```bash
pnpm gates              # every gate
pnpm gates <id> ...     # one or more by id
pnpm gates:licenses     # the licence gate on its own, which the release job calls
```

A gate is never relaxed to make a build pass. A red gate means the code is wrong.

## The reading of `ai-docs/`

`ai-docs/` holds the maintainer's private documents. It is excluded from git in
`.git/info/exclude`, so no clone restores it and no CI runner has it. Fourteen gates named absent
documents as a reason they may skip, and twelve of them actually skipped on every run that was not
on the maintainer's machine, which meant half the project's guarantees were enforced in one place.
Those are two different numbers of two different things, and `src/lib/skip-accounting.ts` sets out
all three that describe this change.

They now read `ai-docs-projection.json`, which is generated from those documents and committed.
Thirteen gates read it, being the twelve that used to skip plus `projection-privacy`.

### What keeps the private documents out of it

**The generator is the guarantee. The scan is a backstop.** `src/lib/projection.ts` reads named
fields out of the documents, a line count, a box, a range, a digest of a title, and writes those
and nothing else. Content can travel into the artefact only if somebody changes that file to carry
it, and what stops that is code review.

`src/lib/projection-prose.ts` then reads the committed artefact back and does two jobs, neither of
them the one above:

- it catches a mistake in such a change, by giving every position an anchored grammar and refusing
  any leaf that does not match it, in any language, plus any leaf at a path no rule names;
- it bounds the volume of whatever does travel, and bounds it **on the file as a whole**: how many
  bytes and how many leaves the artefact may hold in total, plus how many leaves may stand at a
  position, how many lines a projected document may hold, and how many digests the whole file may
  carry.

**It is not a defence against an author deliberately spelling a sentence like an identifier.** A
four word hyphenated leak and a four word hyphenated identifier are the same shape, and no bound
tells them apart. `ACKNOWLEDGED_RESIDUE` in that file names what fits under the bounds as they
stand, so the next reader finds it written down rather than discovering it.

Every leaf of the artefact is one of the kinds of value below and nothing else. That list is not a
claim written beside the file: the scan classifies each leaf into one of these kinds, and
`tools/gates/test/unit/projection.spec.ts` reconciles the census with this list in both directions.
A kind that appears in the file and is not named here, or a name here that the file no longer
carries, is a red test.

<!-- value-kinds -->

- `number`: line counts, byte sizes, line positions, thresholds, and the figures a claim map row
  states
- `box`: whether a box is ticked
- `identifier`: identifiers the gates already spell for themselves, being task ids, milestone ids,
  package names, routes, repository relative paths, custom property names, CSS selectors, claim
  ids and statuses, and the four form vocabulary of deferral markers
- `digest`: a SHA-256 prefix standing in for a text whose wording is the subject of a check
- `motion-value`: in a projected stylesheet, the durations, the easing curve and the aliases
  between them, which are the only values the reduced motion contract resolves. Every other
  declared value is written as `0`

<!-- /value-kinds -->

Every free text a gate compares travels as a digest, and where a gate needs to print the text it
compared it resolves the digest through the committed constant that already carries the same words.

A grammar says which characters may appear and not how many, so every position also carries a
bound, and a sentence written with hyphens, dots or camel humps instead of spaces is refused by
that rather than by the grammar. Each bound is sized to **what its kind can legitimately be**, with
headroom above what the artefact holds today, in four ways at once:

| Measure    | What it catches                                                            |
| ---------- | -------------------------------------------------------------------------- |
| characters | length, in any alphabet                                                    |
| segments   | a sentence written with hyphens or dots instead of spaces                  |
| per token  | the same, packed into one unbroken run                                     |
| capitals   | `DROPTELLTALEBEFOREM8`, which no segmenter can divide without a dictionary |

Bounds used to be the largest value the artefact happened to hold plus ten percent, borrowed from
`SIZE_BUDGETS`, whose subject is bytes of a built artefact. Sized that way they reddened ordinary
future work: a document named `PROJECT-STANDARDS.md`, a fourth stylesheet, a seven part token name,
a SPEC 21 row called `Observability`, the milestone `RELEASE`. A privacy check that reddens on
honest work gets edited away, and then it protects nothing.

The volume bounds are separate and are the half no per value rule can see. A thousand conforming
lines of CSS custom properties are a thousand conforming lines; twelve thousand words arrive
anyway. So each position bounds its leaf count, each projected document its line count, and the
whole file its digest count, because a digest is eight bytes nobody can read.

**Per position bounds cannot bound volume, because they multiply.** Measured on 2026-09-03 by
filling every position to exactly its own limit: 4,725,296 bytes over 6,840 leaves, and the scan
reported nothing, because no position was over. So the artefact carries one budget of its own,
`PROJECTION_ARTEFACT_BUDGET` in `src/config.ts`, where every other threshold in this project lives:
144 KB and 800 leaves, against 128,068 bytes and 625 leaves today. The headroom is two milestones
of ordinary writing at the cost a milestone has measured, and the derivation is in the comment
beside it. The per position counts stay and are what they always were, anomaly detection on one
position. The `projection-privacy` gate prints both readings beside both budgets on every run.

**The leaf count sits in a corridor, and the corridor is narrow on purpose.** `PROJECTION_LEAF_FLOOR`
is 500, the budget is 800, and the artefact reads 625. The two numbers answer two different
questions about the same one quantity, which is the only quantity either of them has:

| Number    | The question it asks             | What a failure means                                    |
| --------- | -------------------------------- | ------------------------------------------------------- |
| floor 500 | is there an artefact here at all | the file was emptied or truncated, so an absence is passing every grammar |
| budget 800 | is there too much of one        | volume arrived that no per value grammar can see        |

An emptied file passes every grammar in `projection-prose.ts`, because each leaf it still holds is
admissible and the leaves it lost cannot be refused, so without a floor an absence reads as the
cleanest run the gate ever has. Both numbers are taken from one artefact of one size, so the gap
between them is about as wide as one artefact is and was never going to be wider. **When growth
reaches 800, re-derive the budget the way its own comment derives it**, by pricing a milestone off
the artefact as it then reads and covering the milestones the plan still holds. Do not raise it to
fit the reading that just went red, and do not move the floor after it: the floor's subject is
emptiness rather than volume, so it moves only if the smallest honest artefact changes shape.

The scan runs twice and both runs are committed: as a case in `projection.spec.ts`, and as the
`projection-privacy` gate, so `pnpm gates` answers it too. The gate carries no rule of its own; it
calls the same function and adds the three questions a gate has to ask, being whether the file was
there, whether the walk covered enough of it to mean anything, and whether the rule table and the
file still name the same positions in both directions.

### Regenerating it

```bash
pnpm gates:projection
```

Run it whenever a document under `ai-docs/` changes, and commit the result. It needs the
directory, so it is the maintainer's step; every other checkout reads what it wrote. The script
runs prettier over the file it writes, because the artefact is inside the format allowlist and
the `format` gate holds it to prettier's shape like every other committed JSON.

### What happens if you forget

- On a tree that has `ai-docs/`, `build-manifest` regenerates the projection in memory and
  compares it with the committed file. A difference is an error naming the sections that moved
  and this command. **Forgetting the step is a red build where `ai-docs/` is present, which is the
  maintainer's machine.** On a clone the comparison cannot be made by anybody, and `build-manifest`
  says so in a warning that does not colour the verdict, so a clone can be green over an artefact
  that no longer matches the documents.
- On any checkout, the artefact carries a digest of its own contents, so a corrupted file fails to
  load and every gate that reads it reports the same error. **That digest is a corruption check and
  not a tamper check:** it is computed from the data beside it with no secret, so anybody who edits
  the artefact on purpose and recomputes the field passes every reader.
- A missing artefact is an error and never a skip. The file is committed, so a checkout without
  one is a defect in the tree rather than a property of the machine.

### What still needs the directory

Two gates, both conditionally, and both declared in `SKIP_REASONS`:

| Gate                | What it reads                | What it still does without it                        |
| ------------------- | ---------------------------- | ---------------------------------------------------- |
| `budget-exceptions` | the plan, to expire an entry | passes while the exception list is empty             |
| `coverage`          | STANDARDS 9.1's floor table  | measures coverage and enforces every committed floor |
