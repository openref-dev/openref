/**
 * Where a bridged message comes from, which is always a host and never this package.
 *
 * THIS PORT IS THE WHOLE OF THE BRIDGE'S REACH, AND THAT IS A SECURITY DECISION BEFORE IT IS A
 * PACKAGING ONE. A documentation server that dials a broker address taken from a request is the
 * forgery primitive of SPEC 14.5 written a second time in a second place. Here there is no address
 * at all: a request carries one value, the channel name, it is checked against the explicit
 * allowlist of SPEC 14.8, and only then is this port asked for anything. Whatever the connection
 * to Kafka, NATS, RabbitMQ or Redis is, the host already has it and this package never sees it.
 *
 * IT IS ALSO WHY THE SUITES MAKE NO EXTERNAL REQUEST. SPEC 19.4 promises zero of those, and a
 * bridge that opened a broker connection of its own could not be tested without one.
 */

/** One message as it leaves the broker, reduced to what a stream can carry. */
export interface BridgeMessage {
  /**
   * The payload, already text.
   *
   * TEXT AND NOT AN OBJECT, because SSE carries text and something has to decide how a value
   * became one. That decision belongs to the host, who knows whether the broker speaks JSON, Avro
   * or Protobuf; a serializer chosen here would silently rewrite payloads on the way to a reader
   * who is looking at them to find out what the broker really sends.
   */
  readonly data: string;
  /** The broker's own id for this message, when it has one. Reaches the reader as the SSE `id`. */
  readonly id?: string;
}

/** A subscription this package holds and is responsible for closing. */
export interface BridgeSubscription {
  /** Stops delivery and releases whatever the host allocated for it. */
  close(): void | Promise<void>;
}

/** How the host hands messages to the bridge. */
export interface IBridgeSource {
  /**
   * Subscribes to one channel.
   *
   * THE CHANNEL IS ALWAYS ONE THE ALLOWLIST ADMITTED. Nothing else ever reaches this call, so an
   * implementation does not have to guard the name a second time, and a name it does not
   * recognize is the host's own configuration disagreeing with the host's own broker.
   *
   * @param channel - Address of the channel, as the allowlist spells it
   * @param deliver - Called once per message, from whatever context the broker client uses
   * @returns The subscription, which the bridge closes when the reader leaves
   */
  subscribe(
    channel: string,
    deliver: (message: BridgeMessage) => void,
  ): BridgeSubscription | Promise<BridgeSubscription>;
}
