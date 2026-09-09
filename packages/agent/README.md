# @openref/agent

The agent surface. For one mounted document it answers `<route>/llms.txt`, `<route>/llms-full.txt`
and `<route>/mcp`: an index a crawler can follow, the full text of the reference, and a JSON-RPC
endpoint exposing the document's operations as MCP tools and its two text files and health report as
MCP resources. It stands on `@openref/core` and `@openref/render`, and the edge to the renderer is
the address and title authority rather than a convenience: `links.ts` decides where a page lives and
`materializeNode` decides what a node is called, so a file that spelled either itself would be a
broken link or a second title for one operation.

It reads and never sends. Every answer is a projection of a document this process already holds: no
request leaves, no state is kept between calls, and nothing here can reach the API the reference
describes. Performing a request is the runner and the same-origin proxy, which have an allowlist and
an SSRF defence.

## Not published

This package is not on npm. It is architecturally separate, it has its own tests, and it ships
bundled inside `@openref/nest`, because a host configures it with two booleans and calls none of it
directly.

## The two switches, and where a host writes them

`agent` is an `{ llmsTxt?: boolean, mcp?: boolean }` pair. `llmsTxt` defaults to true and `mcp`
defaults to false, and the asymmetry is the point: the two text files are a projection of a document
this process already holds, while MCP is a protocol endpoint a third party agent drives, so turning
it on is a sentence somebody wrote rather than a state they arrive in. One switch covers both files,
because they are one artefact at two depths and a deployment wanting the index without the content
would be asking a reader to follow links that switch just turned off.

It sits on both entry points of `@openref/nest`, for the reason `visibility` and `guard` do. A host
writes `OpenRefModule.setup('/docs', app, { document, agent: { mcp: true }, guard })`, or puts the
same member on an entry of `OpenRefModule.forRoot({ documents: [...] })`. `forRoot({ agent })` at
the root is the default every mount inherits, and an entry naming its own overrides it for that
mount alone, the same relation `theme` has to its per document form. The federated reference takes
it too.

All three addresses are registered on every mount, whatever the switches say. A route that existed
only when a feature was on would make "off" and "no such address" the same 404 from outside, so a
switched off file answers 403 naming the option that switches it on, in the same words on the HTTP
address and inside the MCP resource read.

## The boot refusal

`mcp: true` on a mount that supplies no guard does not boot. Authentication is mandatory when MCP is
on, and the mechanism is the host's own guard rather than a second one: this package holds no
credential, no token store and no header convention, deliberately, and every route already passes
one admission object the host's guards run inside.

Two details of the check are decisions rather than incidentals. The count is what decides, not the
presence of the member, so `guard: []` reads as guarded and guards nothing and is refused here as it
is refused elsewhere. And the pair the check sees is the entry's own `agent` resolved against the
root default, so a `forRoot` that switches MCP on at the root and writes a guard on no entry is
refused, which is exactly the arrangement it exists for. It is a boot refusal rather than a per
request one because the state being described is a host who believes an endpoint is authenticated
while it is open, and the moment to say so is while the application is still starting.

## The six MCP methods

`<route>/mcp` takes one JSON-RPC 2.0 request in the body of a POST, and answers six methods.
Anything else is `methodNotFound` naming all six. A message with no id is a notification, so it is
answered with 202 and an empty body; `notifications/initialized` is the one every client sends after
the handshake. The GET is registered so that the address answers about this endpoint rather than
falling through to the operation page route, and it carries no body, so it says so.

- `initialize`: protocol version `2025-06-18`, a constant rather than an echo of what the client
  asked for, `capabilities` of `tools` and `resources` and nothing else, `serverInfo` named
  `openref` with the document's own title and version, and instructions naming the three things a
  remediation consumer may rely on.
- `ping`: an empty result.
- `tools/list`: one tool per exposed operation, in document order.
- `tools/call`: the contract of the named operation as text. The name is resolved against the
  exposed set rather than against the document, and an unknown name and a withheld one answer the
  same way, because a different message would tell a caller that an operation it may not see exists.
- `resources/list`: what this mount will actually serve, in a fixed order.
- `resources/read`: one resource by uri.

A tool describes an operation and never performs one. Its name is derived from the node id, which is
the one identifier guaranteed unique, with characters outside the MCP name set replaced rather than
dropped; its `inputSchema` is an empty object, because a tool describing one fixed operation takes
nothing and accepting arguments would invite a caller to believe they were sent somewhere. The
annotations are truthful about the tool, `readOnlyHint` true and `openWorldHint` false, and what the
documented operation would do is carried as data instead: `mutating` and `requiresConfirmation`, and
the first line of the description, where both a program and a person meet it. The question is asked
of the HTTP method and of nothing else, `get`, `head`, `options` and `trace` being safe, so an
unenumerated method is treated as mutating. Channels are not tools, because a tool is a thing an
agent calls over HTTP and a channel is not one; they are not hidden either, and appear in both text
files.

Three resources, at `openref://llms.txt`, `openref://llms-full.txt` and `openref://health`. The
third exists because remediation is a supported use: it is the versioned doctor report, served whole
with its `version` member intact, so a consumer that pins a shape refuses one it does not understand
instead of reading a changed shape as an empty report, which looks exactly like a clean one. It goes
through `canonicalize`, so two reads of one unchanged document produce identical bytes and a
pipeline can diff them without a JSON aware differ. The two text files are already deterministic by
construction and are not canonicalized, because they are not JSON.

## What is withheld, and by which function

A node marked `x-openref-audience: internal` is not exposed to an agent, and `agentExposure` is the
one place that decides it. It is computed once per document, and every agent answer reads that one
result: the tool list, a tool call, the health report, and both text files. The failure mode of
writing the rule once per surface is that two of the three agree and the third is the leak.

The filter lives in the file generators rather than on the MCP path, and that placement was bought
with a finding. Both text files are served twice, at their HTTP address and as an MCP resource, and
a blind review read `POST /admin/impersonate` back through `resources/read openref://llms-full.txt`
on a booted, guarded application while `tools/list` on the same address withheld it. Filtering on
the MCP path alone would have closed that hole and opened another, one document with two spellings,
so both routes now serve the same bytes because they call the same function.

A drift finding on an internal node is an internal node. The health report is the one answer whose
subject is a node id rather than a node, so it is where the filter is easy to forget and impossible
to see having been forgotten: a report naming an internal route in a `subject` string has exposed it
just as surely as a tool would have. `AgentExposure` therefore carries the ids of everything
withheld, so a consumer can prove the filter ran rather than assume it. The filtered report is the
doctor report shape plus one member, `withheldFindings`, so an agent written against the unfiltered
type reads it without knowing anything about audiences; its score and its suppression figures are
recomputed over what is left, because a number about findings the reader cannot see is a number
nothing in the payload supports.

This is a documentation marking and not an access control. Who may reach the reference at all is
`visibility` and the guard around the mount. The operation page itself is unchanged and is still
drawn for any reader that guard admitted, recorded as the price rather than as an oversight: a
machine crawlable file cannot have a version per reader, so it takes the conservative audience.
