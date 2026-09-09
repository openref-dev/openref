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
withheld, so a consumer can prove the filter ran rather than assume it.

This is a documentation marking and not an access control. Who may reach the reference at all is
`visibility` and the guard around the mount. The operation page itself is unchanged and is still
drawn for any reader that guard admitted, recorded as the price rather than as an oversight: a
machine crawlable file cannot have a version per reader, so it takes the conservative audience.
