# Shape of kubernetes-apps-v1.json

The readable half of this document's snapshot. Its digest beside it pins every byte but says
only that something moved; this says what moved. It is kept short on purpose, because the whole
argument for having it is that a person reads it in full.

Every figure is derived from IR alone, on the same canonical ordering as every other artefact.

`max expansion depth` is an upper bound on how deep a cycle safe expander can descend: the
longest path of the reference graph with its strongly connected components collapsed, each
component weighted by the anonymous nesting of its members. It is finite even where named
cycles exist, and named cycles do exist, which is why `schemas on a reference cycle` is a row.

## Counts

| what | count |
| --- | --- |
| nodes, operation | 77 |
| webhooks | 0 |
| schemas | 166 |
| schemas on a reference cycle | 0 |
| references, `$ref` nodes | 249 |
| references, `$cycle` nodes | 0 |
| use sites naming a schema | 626 |
| use sites inlining a schema | 657 |
| max anonymous nesting | 3 |
| max expansion depth | 29 |

## Nodes per tag

| tag | nodes |
| --- | --- |
| apps_v1 | 77 |

## Navigation, two levels

Leaf children are counted by kind rather than listed. Their ids are in the digest, which is
where a list of six hundred entries belongs. A child that is itself a group is listed in full,
because that is structure rather than content.

- group apps_v1 (77): 77 node
- group Schemas (166): 166 schema
