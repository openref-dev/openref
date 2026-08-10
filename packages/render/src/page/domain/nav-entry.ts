/**
 * One entry of the navigation tree.
 *
 * IN A MODULE OF ITS OWN BECAUSE THREE THINGS SHARE IT. The page model builds it, the slice
 * cuts it and the rows flatten it, and while the type lived in the model the slice had to
 * import the model that imports the slice. A type only cycle typechecks and is still a cycle:
 * the graph linter reads it as one because a later change can turn it into a real one, and the
 * rule that catches it is the same rule that keeps `core` acyclic.
 */

/** One entry of the navigation tree, flattened to what a renderer needs. */
export interface NavEntryModel {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly nodeId: string | null;
  readonly schemaId: string | null;
  readonly deprecated: boolean;
  /**
   * The second line: `METHOD /path` for an operation, the address for a channel, empty for a
   * group.
   *
   * It exists because the label is the operation's summary when it has one, and a reader
   * searching for `/orders/{id}` would otherwise find nothing on a document whose authors
   * wrote summaries. It is what the command palette matches on as well as shows.
   */
  readonly hint: string;
  /**
   * Children this entry has in the whole navigation, which is not what it carries.
   *
   * A page ships the navigation it can draw and nothing else, per `nav-payload.ts`, so a
   * closed group arrives with an empty `children` and a count above zero. The two together are
   * what let the sidebar render a group as openable without holding what is inside it, and
   * what let it tell a closed group from an empty one, which look identical from `children`.
   */
  readonly childCount: number;
  readonly children: readonly NavEntryModel[];
}
