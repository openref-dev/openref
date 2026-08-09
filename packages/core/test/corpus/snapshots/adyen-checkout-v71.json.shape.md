# Shape of adyen-checkout-v71.json

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
| nodes, operation | 28 |
| webhooks | 0 |
| schemas | 261 |
| schemas on a reference cycle | 0 |
| references, `$ref` nodes | 448 |
| references, `$cycle` nodes | 0 |
| use sites naming a schema | 151 |
| use sites inlining a schema | 14 |
| max anonymous nesting | 4 |
| max expansion depth | 14 |

## Nodes per tag

| tag | nodes |
| --- | --- |
| Donations | 2 |
| Modifications | 6 |
| Orders | 3 |
| Payment links | 3 |
| Payments | 6 |
| Recurring | 4 |
| Utility | 4 |

## Navigation, two levels

Leaf children are counted by kind rather than listed. Their ids are in the digest, which is
where a list of six hundred entries belongs. A child that is itself a group is listed in full,
because that is structure rather than content.

- group Payments (6): 6 node
- group Donations (2): 2 node
- group Payment links (3): 3 node
- group Modifications (6): 6 node
- group Recurring (4): 4 node
- group Orders (3): 3 node
- group Utility (4): 4 node
- group Schemas (261): 261 schema
