/**
 * A WebSocket server the fixture answers on, written out rather than installed.
 *
 * WHY IT IS HAND WRITTEN, WHICH IS THE SAME ANSWER `serve-authorization.ts` GIVES. The console of
 * SPEC 14.7 can only be proved where a reader presses it if something on the other end completes a
 * handshake, and the socket half of the proof is the browser's own `WebSocket` talking to a real
 * listener. No transport package is installed anywhere in this repository, and the approval
 * recorded against `T065` for one is recorded as unspent; a first runtime dependency arriving to
 * serve one test fixture would spend it for the look of it. What a test fixture needs of RFC 6455
 * is the handshake, one client frame read, one server frame written, and the close, so that is what
 * is here and nothing else.
 *
 * IT ECHOES, AND THE ECHO IS WHAT MAKES THE PROOF A ROUND TRIP. A server that only pushed would
 * prove the socket opened; a server that answers what it was sent proves the reader's own message
 * left the page, crossed the wire and came back into the window the engine publishes.
 *
 * IT IS NOT A WebSocket IMPLEMENTATION AND MUST NOT BE READ AS ONE. Continuation frames are
 * refused rather than assembled, an unmasked client frame is refused rather than accepted, and
 * nothing here is reachable from a published package: it lives in the harness, beside the fake
 * authorization server, and both exist so that a proof has something real to talk to.
 */

import { createHash } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';

/** The constant RFC 6455 appends to the client key before hashing it. */
const ACCEPT_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** Opcode of a text frame, the only payload frame this fixture speaks. */
const OPCODE_TEXT = 0x1;

/** Opcode of a close frame. */
const OPCODE_CLOSE = 0x8;

/** Opcode of a ping, which is answered with a pong so a browser keeps the socket up. */
const OPCODE_PING = 0x9;

/** Opcode of a pong, which is read and ignored. */
const OPCODE_PONG = 0xa;

/**
 * The `Sec-WebSocket-Accept` value one client key earns.
 *
 * @param key - The `Sec-WebSocket-Key` header the browser sent
 * @returns The base64 accept value
 */
export function acceptKeyFor(key: string): string {
  return createHash('sha1').update(`${key}${ACCEPT_GUID}`).digest('base64');
}

/**
 * Encodes one text frame, server to client, which RFC 6455 forbids masking.
 *
 * @param text - The payload
 * @returns The frame
 */
export function encodeTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const length = payload.length;

  if (length < 126) {
    return Buffer.concat([Buffer.from([0x80 | OPCODE_TEXT, length]), payload]);
  }

  if (length < 65_536) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | OPCODE_TEXT;
    header[1] = 126;
    header.writeUInt16BE(length, 2);

    return Buffer.concat([header, payload]);
  }

  const header = Buffer.alloc(10);
  header[0] = 0x80 | OPCODE_TEXT;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);

  return Buffer.concat([header, payload]);
}

/** One frame read off the wire, and how many bytes of the buffer it consumed. */
export interface DecodedFrame {
  readonly opcode: number;
  readonly payload: string;
  readonly consumed: number;
}

/**
 * Reads one client frame out of a buffer, or reports that the whole of it has not arrived.
 *
 * A CLIENT FRAME IS ALWAYS MASKED, per RFC 6455, and one that is not is a protocol error rather
 * than a frame to be lenient about. A fixture that accepted both would be answering a question
 * nobody asked it.
 *
 * @param buffer - Everything read so far
 * @returns The frame, or null when more bytes are needed
 * @throws Error when the frame is unmasked or is a continuation, neither of which this speaks
 */
export function decodeClientFrame(buffer: Buffer): DecodedFrame | null {
  if (buffer.length < 2) return null;

  const first = buffer[0] ?? 0;
  const second = buffer[1] ?? 0;
  const opcode = first & 0x0f;

  if ((first & 0x80) === 0) {
    throw new Error('this fixture reads whole frames only, and a continuation arrived');
  }
  if ((second & 0x80) === 0) {
    throw new Error('a client frame must be masked, and this one is not');
  }

  let length = second & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    length = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }

  if (buffer.length < offset + 4 + length) return null;

  const mask = buffer.subarray(offset, offset + 4);
  offset += 4;

  const masked = buffer.subarray(offset, offset + length);
  const payload = Buffer.alloc(length);
  for (let index = 0; index < length; index += 1) {
    payload[index] = (masked[index] ?? 0) ^ (mask[index % 4] ?? 0);
  }

  return { opcode, payload: payload.toString('utf8'), consumed: offset + length };
}

/** How the echo answers. */
export interface SocketEchoOptions {
  /**
   * A message pushed to the reader as soon as the socket opens, or nothing.
   *
   * PUSHED RATHER THAN ONLY ECHOED, so a case can prove the receive half without having to send
   * first: the two directions are two facts and a fixture that could only answer would make them
   * one.
   */
  readonly greeting?: string;
}

/**
 * Answers WebSocket upgrades on a server that is already listening.
 *
 * @param server - The http server the fixture serves its pages from, so the socket is same origin
 * @param options - What to push on open
 */
export function attachSocketEcho(server: Server, options: SocketEchoOptions = {}): void {
  server.on('upgrade', (request: IncomingMessage, socket: Duplex) => {
    const key = request.headers['sec-websocket-key'];

    if (typeof key !== 'string') {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }

    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKeyFor(key)}`,
        '',
        '',
      ].join('\r\n'),
    );

    if (options.greeting !== undefined) socket.write(encodeTextFrame(options.greeting));

    let pending = Buffer.alloc(0);

    socket.on('data', (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);

      for (;;) {
        const frame = decodeClientFrame(pending);
        if (frame === null) return;

        pending = pending.subarray(frame.consumed);

        if (frame.opcode === OPCODE_CLOSE) {
          // The mirror of the close the reader asked for: one close per open, which is the
          // contract the engine's own port states and the state machine is driven by.
          socket.end(Buffer.from([0x88, 0x00]));
          return;
        }
        if (frame.opcode === OPCODE_PING) {
          socket.write(Buffer.from([0x80 | OPCODE_PONG, 0x00]));
          continue;
        }
        if (frame.opcode !== OPCODE_TEXT) continue;

        socket.write(encodeTextFrame(frame.payload));
      }
    });

    // A SOCKET THAT ERRORS IS ENDED RATHER THAN LEFT, because an unhandled error event on a
    // detached duplex takes the fixture process down and a boot that dies reads as a broken
    // product rather than as a closed connection.
    socket.on('error', () => {
      socket.destroy();
    });
  });
}
