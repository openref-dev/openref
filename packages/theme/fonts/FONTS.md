# The faces the default theme ships

Per SPEC 0 zone 4. This file holds the reasoning behind `fonts.css`, which used to carry it
as a comment.

IT MOVED HERE ON 2026-08-10, IN `T012-R3`, AND THE REASON IS THE ONE THE RETROFIT IS ABOUT.
`fonts.css` is the one stylesheet the theme serves exactly as written, so a comment in it is
not a comment in a source file, it is 1,992 bytes of prose in every response, 34 percent of
the file. `theme.css` goes through tsup and loses its comments between `src` and `dist`,
27,714 source bytes to 19,761 shipped, and nothing was lost by that. This file is how
`fonts.css` gets the same treatment without going through a bundler, which it must not.

## Self hosted, and that is a security claim rather than a preference

No CDN and no external request of any kind. SPEC 19 puts the number of outgoing requests from
the client at zero, and a font served from someone else's origin is an outgoing request that
also tells them who is reading your documentation.

## Why this stylesheet is not built

A stylesheet whose `url()` names a binary beside it survives a bundler only by being kept away
from one. esbuild would rewrite the reference and move the file, and the licence text and the
`NOTICE.md` that have to travel with these bytes would stop travelling with them. Every file
here is a subset, so it is a modified work under OFL, and `packages/theme/fonts` carries the
licence text of each family, a `NOTICE.md` and a manifest recording the exact source of every
byte.

## Each face is two files

latin and latin-ext, selected by `unicode-range`. A reader of an English interface fetches the
latin half and nothing else, which took the first paint from 58.7 KB to 44.9 KB and a whole
session from 144.3 KB to 107.9 KB. The directory got heavier, 176.8 KB against 144.3, because a
split face carries `fpgm`, the `name` table and every latin base glyph its accented glyphs
compose from in both halves. SPEC 20 budgets the three numbers separately for that reason.

## The latin-ext block comes first in every pair

The order is load bearing. The two ranges overlap on a handful of code points, and when two
faces of one family both match, the last declaration wins. Declaring latin second means the
overlap is served by the file a reader already has.

## font-display is swap everywhere

Text that is readable in a fallback face beats text that is not there, and the reference is a
document before it is a design. The two latin regulars are what the first paint waits for and
are budgeted separately, per SPEC 20; every other file arrives when it arrives and swaps in.
