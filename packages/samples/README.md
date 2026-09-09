# @openref/samples

The code sample generator. It turns one operation into a request in fifteen languages, starting
with cURL, HTTPie, wget and PowerShell and running through TypeScript, Python, Go, C#, Rust, Swift,
Kotlin and Dart. Twelve are drawn as tabs on the page; PHP, Java and Ruby are written by the same
emitters and named rather than carried, which is the answer the page gives a reader looking for
Ruby. It depends on `@openref/core` and `@openref/runner`.

## Not published

This package is not on npm. It is architecturally separate, it has its own tests, and it ships
bundled inside `@openref/nest` and the `openref` CLI, which are the two packages that see both the
renderer and the runner and are therefore the two that can compose it. A host reaches it through
nothing at all, because every operation page draws what it writes: `withGeneratedSamples` is called
by `ReferenceService` on a mounted document and by both entry points of the static build, and its
`languages` argument defaults to the twelve the page carries.

## The fifteen, and where each is drawn

`SAMPLE_LANGUAGES` is one list, and each entry carries a level and a placement. The level says who
wrote the emitter, and the placement says whether the reference page carries the tab inline.
`PAGE_SAMPLE_LANGUAGES` and `OFF_PAGE_SAMPLE_LANGUAGES` are that one member read twice, rather than
two hand written lists that have to agree.

| Id           | Tab        | Level | Placement   |
| ------------ | ---------- | ----- | ----------- |
| `shell`      | cURL       | 1     | `page`      |
| `bash`       | HTTPie     | 1     | `page`      |
| `sh`         | wget       | 1     | `page`      |
| `powershell` | PowerShell | 1     | `page`      |
| `typescript` | TypeScript | 1     | `page`      |
| `python`     | Python     | 1     | `page`      |
| `go`         | Go         | 2     | `page`      |
| `php`        | PHP        | 2     | `elsewhere` |
| `java`       | Java       | 2     | `elsewhere` |
| `csharp`     | C#         | 2     | `page`      |
| `ruby`       | Ruby       | 2     | `elsewhere` |
| `rust`       | Rust       | 2     | `page`      |
| `swift`      | Swift      | 2     | `page`      |
| `kotlin`     | Kotlin     | 2     | `page`      |
| `dart`       | Dart       | 2     | `page`      |

Six level 1 and nine level 2. The order is the order the tabs appear in, so it is behaviour rather
than presentation, and the three held off the page stay in the position they always had rather than
being moved to the end. They are the three most expensive and that is the whole criterion: measured
on the runner, Ruby 3,122, Java 2,726 and PHP 2,374 bytes of one page against 15,435 for all
fifteen, which is 53 percent of the sample cost in three of the fifteen tabs. They are expensive by
highlighting rather than by source length, since their grammars travel as markup.

The ids are highlighter ids and not product names, because `IRCodeSample.lang` reaches the
highlighter: `csharp` and not `C#`. Four command line tools share one grammar and therefore spend
four ids on it, `shell`, `bash` and `sh` being three aliases of one; a tab strip is keyed by `lang`,
so a document writing its own `bash` sample takes the id HTTPie is keyed by, and the page says which
language is sharing that tab rather than letting the word vanish.

## One request, proven at the wire level

The sample a reader copies and the button beside it send the same request. The edge to
`@openref/runner` is what makes that true rather than aspirational: `buildSampleRequest` reads the
runner's own `buildRequest`, so the style matrix, the body encoder and the credential rule are one
implementation. A samples package that reached only `core` would rebuild all three, and the day one
of the copies changed, the reference would show a reader code that does not match the button.

The claim is worth exactly as much as the binary that was run to check it, so the integration suites
run real binaries through a real shell against a live server that records bytes rather than
meanings, and compare with what the runner's transport sent over the same plan. Using `sh -c` puts
the quoting under test too: a body carrying a quote, a dollar sign or a backtick reaches the server
as the reader wrote it, or the case fails. Parsing the command in JavaScript and replaying it with
`fetch` would only prove that this package's emitter agrees with a parser this package also wrote.

cURL is required outright, because every machine this project builds on has it. wget, HTTPie,
PowerShell, Swift, Ruby and the .NET SDK are each guarded: the group asserts its toolchain is
present and skips with the reason named when it is not, so it never passes without having sent
anything. Where each group runs is recorded, because a guard covering neither machine looks exactly
like one covering both. Kotlin, Dart, Python, Java, Go, PHP, Rust and TypeScript have no wire case,
and the reason for each is written down rather than left out.

The comparison covers the headers the plan states and, since it was widened, headers the client adds
of its own. That widening caught three clients inside one run, which is the point of widening it: a
check whose method excludes a class of defect cannot have its silence told from absence.

## What a level 2 template is allowed to be

A template renders a text body and refuses a byte one. A multipart form and a binary upload reach
the plan as bytes, and writing nine multipart encoders by hand would put nine untested body builders
into the one place a single answer is supposed to live; the refusal names the three tabs that do
carry it, cURL, TypeScript and Python. Each template sets the content type the way its own client
demands rather than the way the others do, which is the discipline of the package in one line: the
same bytes, spelled as each client spells them. The three mobile clients were added for a reader
rather than for symmetry, Swift, Kotlin and Dart covering iOS, Android and Flutter, each spelled
with the client its platform actually uses.

Level 1 does not mean "refuses nothing", and saying so would be false about cURL first of all: it
refuses a multipart field whose name carries `=`, because curl reads that character as the end of
the name. Every such refusal in this package was measured against the real binary rather than read
off a manual, and several of them corrected a first edition that had the fact backwards.

An emitter that cannot write a request answers with a refusal and the reason for it. There is no
third outcome, and in particular no sample with a hole in it: a template printing a comment where
the multipart body belongs would be code a reader copies, runs and watches fail, with the generator
having said nothing. Where the sample is faithful and simply will not do what a reader expects, the
answer is a note rather than a refusal: a client that stops at a redirect where the console follows
it, a credential no request can carry at all, a tab a document has claimed. Refusing those would
take away fifteen tabs that show the request correctly.
