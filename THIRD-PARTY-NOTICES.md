# Third party notices

Material in this repository that is not the work of this project and that ships to a user
inside a published package. Zone 4 of `ai-docs/SPEC.md` section 0.

This list is for someone reading the repository. It does not replace the `NOTICE.md` that sits
beside each set of files: that one works only while it stays next to what it describes, and it
is what travels into the published tarball.

Vendored test fixtures are a different zone and are not listed here. They stay in the
repository, ship to nobody, and carry their attribution in `packages/core/test/corpus/NOTICE`.

## Fonts

Every font file in this repository is a subset of its original: reduced to the latin and
latin-ext ranges, TrueType hinting instructions dropped, converted to woff2. A subset is a
derivative work, so each subset carries the licence of the family it came from.

| Family | Version | Copyright | Licence | Upstream | Shipped in |
| --- | --- | --- | --- | --- | --- |
| Space Grotesk | 2.000 | 2020 The Space Grotesk Project Authors | SIL OFL 1.1 | <https://github.com/floriankarsten/space-grotesk> | `@openref/theme` |
| JetBrains Mono | 2.305 | 2020 The JetBrains Mono Project Authors | SIL OFL 1.1 | <https://github.com/JetBrains/JetBrainsMono> | `@openref/theme` |

Neither family declares a Reserved Font Name. That is read out of each family's own licence
text rather than assumed to be the same across families, so both subsets ship under their
original family names. The licence texts are `packages/theme/fonts/SpaceGrotesk-OFL.txt` and
`packages/theme/fonts/JetBrainsMono-OFL.txt`, verbatim from the family's own repository.

The telltale and forge designs name three further families, Martian Mono, Instrument Sans and
IBM Plex Mono. None of them is in this repository: those themes are reference material in
`ai-docs/design/` and become code in T032.
