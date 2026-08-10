# Third party notices

Material in this repository that is not the work of this project and that ships to a user
inside a published package. Zone 4 of `ai-docs/SPEC.md` section 0.

**This file is a convenience for someone reading the repository. It is not delivered
attribution and does not count as any.** What discharges the obligation is the complete licence
text of each family and that package's own `NOTICE.md`, sitting beside the fonts inside the
published tarball. A package cannot lean on a file in a sibling package or on this one: a
reader who installs one theme on its own never sees the repository at all. That is asserted
against the packed tarball in `packages/theme/test/integration/packaged-attribution.spec.ts`,
because npm drops anything outside the `files` field silently and a working tree that is
missing nothing looks exactly like one that is.

Vendored test fixtures are a different zone and are not listed here. They stay in the
repository, ship to nobody, and carry their attribution in `packages/core/test/corpus/NOTICE`.

## Fonts

Every font file in this repository is a subset of its original: reduced to the latin and
latin-ext ranges and converted to woff2, keeping the kern, liga, tnum and calt layout features.
Outlines, metrics and TrueType hinting instructions are unchanged. A subset is a derivative
work, so each subset carries the licence of the family it came from.

Vendored today, in `@openref/theme`:

| Family | Version | Copyright | Licence | Upstream |
| --- | --- | --- | --- | --- |
| Space Grotesk | 2.000 | 2020 The Space Grotesk Project Authors | SIL OFL 1.1 | <https://github.com/floriankarsten/space-grotesk> |
| JetBrains Mono | 2.305 | 2020 The JetBrains Mono Project Authors | SIL OFL 1.1 | <https://github.com/JetBrains/JetBrainsMono> |

## Reserved font names

The product uses four families across its three designs, and none of them declares a Reserved
Font Name, so nothing is renamed anywhere. That is read out of each family's own licence header
rather than assumed to be the same across families, which is the whole reason the check exists.

| Family | Reserved font name | Used by |
| --- | --- | --- |
| Space Grotesk | none | vernier |
| JetBrains Mono | none | vernier, telltale, forge |
| Martian Mono | none | telltale |
| Instrument Sans | none | forge |

IBM Plex Mono was the mono family of the forge design until 2026-08-10. IBM Plex declares
`"Plex"` as a Reserved Font Name in its own copyright line, and subsetting removes glyphs,
which the licence calls a Modified Version. A Modified Version may not carry a reserved name.
Renaming would have been legal and would have meant rewriting the name table inside every
woff2 on every version bump, so the family was swapped for JetBrains Mono instead.

The telltale and forge designs are reference material in `ai-docs/design/` and become code in
T032. Martian Mono and Instrument Sans are not in this repository yet. When they arrive, each
theme package carries its own copy of every font it uses, its own complete licence text per
family, and its own `NOTICE.md`. JetBrains Mono ends up duplicated across all three theme
packages, and that is correct rather than waste: a tarball has to be complete on its own.
