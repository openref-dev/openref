/**
 * Whether one received message is any of the messages the channel declares.
 *
 * THE VALIDATOR IS THE STREAM'S, NOT A SECOND ONE. `checkStreamItem` already reads the JSON Schema
 * subset SPEC 14.6 chose for the browser, and a second implementation beside it would be two
 * policies that disagree the first time one is edited, each with its own green tests. What is new
 * here is only the arity: a stream declares one item schema and a channel declares several
 * messages, so the question changes from "is this it" to "is this any of them".
 *
 * THE THREE ARITIES ARE THREE DIFFERENT ANSWERS AND ARE NOT COLLAPSED. No declared message means
 * there is nothing to check and no verdict at all; a message checked against nothing is not a
 * message that passed. One declared message means its own sentence, which is the one a reader can
 * act on. Several means the message is marked only when it matched none of them, and the mark says
 * how many were tried, because naming one of five schemas a message failed would send a reader to
 * whichever happened to be first.
 */

import { checkStreamItem, type StreamItemSchema } from '../../stream/domain/item-check';

/** One message a channel declares, with the schema of its payload. */
export interface NamedMessageSchema {
  /** What the document calls this message, which is what a verdict names. */
  readonly name: string;
  /** The payload schema, in the subset of SPEC 14.6. */
  readonly schema: StreamItemSchema;
}

/** What checking one received message concluded. */
export interface SocketMessageVerdict {
  /** Name of the declared message this one matched, absent when none did or none was declared. */
  readonly matched?: string;
  /** One sentence saying why nothing matched, absent when something did or nothing was declared. */
  readonly problem?: string;
}

/**
 * Checks one received message against the messages a channel declares.
 *
 * @param data - The message as it arrived, as text
 * @param schemas - The declared messages, in the order the document wrote them
 * @returns Which message it is, or why it is none of them, or neither when none was declared
 *
 * @example
 * const verdict = checkSocketMessage('{"id":1}', [{ name: 'OrderPlaced', schema }]);
 */
export function checkSocketMessage(
  data: string,
  schemas: readonly NamedMessageSchema[],
): SocketMessageVerdict {
  if (schemas.length === 0) return {};

  const problems: string[] = [];

  for (const declared of schemas) {
    const problem = checkStreamItem(data, declared.schema);
    if (problem === null) return { matched: declared.name };

    problems.push(problem);
  }

  if (schemas.length === 1) {
    const only = schemas[0];

    return {
      problem: `this message does not match ${only?.name ?? ''}: ${problems[0] ?? ''}`,
    };
  }

  return {
    problem: `this message matches none of the ${String(schemas.length)} messages the channel declares`,
  };
}
