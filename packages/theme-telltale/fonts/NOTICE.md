# Fonts shipped with `@openref/theme-telltale`

These files are not the work of this project. They are third party typefaces, vendored under
zone 4 of SPEC 0, and they ship inside the published package.

**Every file here is a subset of the original.** Each face was reduced to a unicode range and
converted to woff2, keeping the kern, liga, tnum and calt layout features. Outlines, metrics
and TrueType hinting instructions are unchanged. A subset is a derivative work, so each subset
is under the same licence as the family it came from.

**Each face is two files, latin and latin-ext**, chosen by the browser through `unicode-range`
in `fonts.css`. A reader whose text stays inside the latin range never fetches the other half.

The complete licence text of each family sits beside these files, taken verbatim from that
family's own repository and never rewritten. It is the full text and not a pointer to anything
else in the repository: this file and those texts are what travel into the published package,
and a reader who installs this package on its own has nothing but this directory.

`manifest.json` records the exact source of every file, the date it was retrieved and the
digest of the bytes as they are here.

**The four JetBrains Mono files are byte identical to the four in `@openref/theme` and that is a
copy rather than a link.** Byte deduplication holds in this repository and in `node_modules`,
and it does not hold in a published tarball: a reader who installs this theme on its own gets
this directory and nothing else, so attribution that lived one package away would stop
travelling with the bytes it attributes. They are copied rather than re-subset so that the
digests recorded here are the digests already recorded and verified for those bytes, and so that
this repository does not carry two differently subset JetBrains Mono under one name.

## JetBrains Mono

- Version 2.305
- Copyright 2020 The JetBrains Mono Project Authors
- <https://github.com/JetBrains/JetBrainsMono>
- SIL Open Font License 1.1, text in `JetBrainsMono-OFL.txt`
- No Reserved Font Name is declared, read from that file rather than assumed
- Files: `JetBrainsMono-400-latin.woff2`, `JetBrainsMono-400-latin-ext.woff2`,
  `JetBrainsMono-700-latin.woff2`, `JetBrainsMono-700-latin-ext.woff2`

## Martian Mono

- Version 1.000
- Copyright 2020 The Martian Mono Project Authors
- <https://github.com/evilmartians/mono>
- SIL Open Font License 1.1, text in `MartianMono-OFL.txt`
- No Reserved Font Name is declared, read from that file rather than assumed
- Files: `MartianMono-700-latin.woff2`, `MartianMono-700-latin-ext.woff2`
