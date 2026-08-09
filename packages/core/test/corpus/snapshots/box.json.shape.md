# Shape of box.json

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
| nodes, operation | 296 |
| webhooks | 0 |
| schemas | 305 |
| schemas on a reference cycle | 0 |
| references, `$ref` nodes | 375 |
| references, `$cycle` nodes | 0 |
| use sites naming a schema | 994 |
| use sites inlining a schema | 687 |
| max anonymous nesting | 8 |
| max expansion depth | 28 |

## Nodes per tag

| tag | nodes |
| --- | --- |
| AI | 5 |
| AI Studio | 5 |
| App item associations | 2 |
| Authorization | 4 |
| Box Sign requests | 5 |
| Box Sign templates | 2 |
| Classifications | 4 |
| Classifications on files | 4 |
| Classifications on folders | 4 |
| Collaborations | 4 |
| Collaborations (List) | 4 |
| Collections | 3 |
| Comments | 5 |
| Device pinners | 3 |
| Domain restrictions (User exemptions) | 4 |
| Domain restrictions for collaborations | 4 |
| Downloads | 1 |
| Email aliases | 3 |
| Events | 2 |
| File requests | 4 |
| File version legal holds | 2 |
| File version retentions | 2 |
| File versions | 5 |
| Files | 6 |
| Folder Locks | 3 |
| Folders | 6 |
| Group memberships | 6 |
| Groups | 5 |
| Integration mappings | 8 |
| Invites | 2 |
| Legal hold policies | 5 |
| Legal hold policy assignments | 6 |
| Metadata cascade policies | 5 |
| Metadata instances (Files) | 5 |
| Metadata instances (Folders) | 5 |
| Metadata taxonomies | 15 |
| Metadata templates | 8 |
| Recent items | 1 |
| Retention policies | 5 |
| Retention policy assignments | 6 |
| Search | 2 |
| Session termination | 2 |
| Shared links (App Items) | 1 |
| Shared links (Files) | 5 |
| Shared links (Folders) | 5 |
| Shared links (Web Links) | 5 |
| Shield information barrier reports | 3 |
| Shield information barrier segment members | 4 |
| Shield information barrier segment restrictions | 4 |
| Shield information barrier segments | 5 |
| Shield information barriers | 4 |
| Skills | 5 |
| Standard and Zones Storage Policies | 2 |
| Standard and Zones Storage Policy Assignments | 5 |
| Task assignments | 5 |
| Tasks | 5 |
| Terms of service | 4 |
| Terms of service user statuses | 3 |
| Transfer folders | 1 |
| Trashed files | 3 |
| Trashed folders | 3 |
| Trashed items | 1 |
| Trashed web links | 3 |
| Uploads | 2 |
| Uploads (Chunked) | 7 |
| User avatars | 3 |
| Users | 6 |
| Watermarks (Files) | 3 |
| Watermarks (Folders) | 3 |
| Web links | 4 |
| Webhooks | 5 |
| Workflows | 2 |
| Zip Downloads | 3 |

## Navigation, two levels

Leaf children are counted by kind rather than listed. Their ids are in the digest, which is
where a list of six hundred entries belongs. A child that is itself a group is listed in full,
because that is structure rather than content.

- group AI (5): 5 node
- group AI Studio (5): 5 node
- group App item associations (2): 2 node
- group Authorization (4): 4 node
- group Box Sign requests (5): 5 node
- group Classifications (4): 4 node
- group Classifications on files (4): 4 node
- group Classifications on folders (4): 4 node
- group Collaborations (4): 4 node
- group Collaborations (List) (4): 4 node
- group Collections (3): 3 node
- group Comments (5): 5 node
- group Device pinners (3): 3 node
- group Domain restrictions (User exemptions) (4): 4 node
- group Domain restrictions for collaborations (4): 4 node
- group Downloads (1): 1 node
- group Email aliases (3): 3 node
- group Events (2): 2 node
- group File requests (4): 4 node
- group File version legal holds (2): 2 node
- group File version retentions (2): 2 node
- group File versions (5): 5 node
- group Files (6): 6 node
- group Folder Locks (3): 3 node
- group Folders (6): 6 node
- group Integration mappings (8): 8 node
- group Group memberships (6): 6 node
- group Groups (5): 5 node
- group Invites (2): 2 node
- group Legal hold policies (5): 5 node
- group Legal hold policy assignments (6): 6 node
- group Metadata cascade policies (5): 5 node
- group Metadata instances (Files) (5): 5 node
- group Metadata instances (Folders) (5): 5 node
- group Metadata taxonomies (15): 15 node
- group Metadata templates (8): 8 node
- group Recent items (1): 1 node
- group Retention policies (5): 5 node
- group Retention policy assignments (6): 6 node
- group Search (2): 2 node
- group Session termination (2): 2 node
- group Shared links (Files) (5): 5 node
- group Shared links (Folders) (5): 5 node
- group Shared links (Web Links) (5): 5 node
- group Shared links (App Items) (1): 1 node
- group Shield information barriers (4): 4 node
- group Shield information barrier segments (5): 5 node
- group Shield information barrier segment members (4): 4 node
- group Shield information barrier reports (3): 3 node
- group Shield information barrier segment restrictions (4): 4 node
- group Box Sign templates (2): 2 node
- group Skills (5): 5 node
- group Standard and Zones Storage Policies (2): 2 node
- group Standard and Zones Storage Policy Assignments (5): 5 node
- group Task assignments (5): 5 node
- group Tasks (5): 5 node
- group Terms of service (4): 4 node
- group Terms of service user statuses (3): 3 node
- group Transfer folders (1): 1 node
- group Trashed files (3): 3 node
- group Trashed folders (3): 3 node
- group Trashed items (1): 1 node
- group Trashed web links (3): 3 node
- group Uploads (2): 2 node
- group Uploads (Chunked) (7): 7 node
- group User avatars (3): 3 node
- group Users (6): 6 node
- group Watermarks (Files) (3): 3 node
- group Watermarks (Folders) (3): 3 node
- group Web links (4): 4 node
- group Webhooks (5): 5 node
- group Workflows (2): 2 node
- group Zip Downloads (3): 3 node
- group Schemas (305): 305 schema
