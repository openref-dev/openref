# @openref/samples

The code sample generator. It turns one operation into a request in fifteen languages, starting
with cURL, HTTPie, wget and PowerShell and running through TypeScript, Python, Go, C#, Rust, Swift,
Dart and Kotlin. Twelve are drawn as tabs on the page; PHP, Java and Ruby are written by the same
emitters and named rather than carried, which is the answer the page gives a reader looking for
Ruby. It depends on `@openref/core` and `@openref/runner`.

## Not published

This package is not on npm. It is architecturally separate, it has its own tests, and it ships
bundled inside `@openref/nest` and the `openref` CLI, which are the two packages that see both the
renderer and the runner and are therefore the two that can compose it. A host reaches it through
nothing at all, because every operation page draws what it writes.

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

An emitter that cannot write a request answers with a refusal and the reason for it. There is no
third outcome, and in particular no sample with a hole in it: a template printing a comment where
the multipart body belongs would be code a reader copies, runs and watches fail, with the generator
having said nothing.
