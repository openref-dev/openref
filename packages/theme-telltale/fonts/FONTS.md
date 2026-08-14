# The faces telltale ships

Per SPEC 0 zone 4. This file holds the reasoning behind `fonts.css`, which is served exactly as
written, so a comment in it is not a comment in a source file: it is prose in every response.

The rules below are the same ones `@openref/theme` states in its own `FONTS.md`, and they are
restated here rather than referenced because this directory is what a reader who installs only
this theme receives.

## Self hosted, and that is a security claim rather than a preference

No CDN and no external request of any kind. SPEC 19 puts the number of outgoing requests from
the client at zero, and a font served from someone else's origin is an outgoing request that
also tells them who is reading your documentation.

## Why this stylesheet is not built

A stylesheet whose `url()` names a binary beside it survives a bundler only by being kept away
from one. esbuild would rewrite the reference and move the file, and the licence text and the
`NOTICE.md` that have to travel with these bytes would stop travelling with them.

## Two families, and the second one appears at one size

JetBrains Mono is the whole interface, at 400 and 700. Martian Mono is strip headings and the
status bar only, at 700, at `--oref-font-size-100`, which is 10 px, in capitals. One weight is
enough because there is nothing for a second one to distinguish.

## Each face is two files

latin and latin-ext, selected by `unicode-range`. A reader of an English interface fetches the
latin half and nothing else.

## The latin-ext block comes first in every pair

The order is load bearing. The two ranges overlap on a handful of code points, and when two
faces of one family both match, the last declaration wins. Declaring latin second means the
overlap is served by the file a reader already has.

## font-display is swap everywhere

Text that is readable in a fallback face beats text that is not there, and the reference is a
document before it is a design.

## What the first paint waits for, and why it is a face from each family

`JetBrainsMono-400-latin.woff2` and `MartianMono-700-latin.woff2`, 45,188 bytes together against
a cap of 61,440. Both are on screen before a reader touches anything: the first is every row of
every table, the second is the heading of every strip. vernier's pair is its sans regular and
its mono regular for the same reason and not by the same rule, so the pair is named per theme in
`FONT_BUDGETS` rather than derived from a position in a list.

## The JetBrains Mono files here are copies of the ones in `@openref/theme`

Byte identical, and copied rather than re-subset. Two reasons, and the second is the one that
would have been missed. Attribution has to travel with the bytes into a tarball, and a tarball
carries one package. And a second subsetting run of the same source with a different version of
`pyftsubset` produces a different file under the same name: measured here at 29,856 bytes
against the committed 30,040 for the bold latin face. Two files that differ and are both called
JetBrains Mono 700 latin is a thing this repository would then have to explain.
