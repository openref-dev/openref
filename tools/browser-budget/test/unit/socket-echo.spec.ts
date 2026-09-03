import { describe, expect, it } from 'vitest';
import { acceptKeyFor, decodeClientFrame, encodeTextFrame } from '../../src/fixture/socket-echo';

/**
 * The three pieces of RFC 6455 the fixture speaks, held to the specification's own vector.
 *
 * WRITTEN BECAUSE THE FIRST VERSION OF THE MAGIC STRING WAS WRONG AND ONLY A BROWSER SAID SO. The
 * constant was mistyped, every handshake was refused with `Incorrect 'Sec-WebSocket-Accept' header
 * value`, and what the browser suite reported was a socket that closed with 1006 four times, which
 * reads exactly like a product defect in the reconnection budget. A protocol constant with no cheap
 * check is a slow failure wearing another feature's face, so the vector RFC 6455 prints in its own
 * section 1.3 is asserted here, in the suite that runs on every push.
 */
describe('the handshake', () => {
  it("should answer the specification's own key with the accept value it prints", () => {
    // Given the example of RFC 6455 section 1.3
    const key = 'dGhlIHNhbXBsZSBub25jZQ==';

    // When
    const accept = acceptKeyFor(key);

    // Then
    expect(accept).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });
});

/** Masks a payload the way a browser must, so a decode can be checked against a real frame. */
function maskedTextFrame(text: string, mask: readonly number[]): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const masked = Buffer.from(payload.map((byte, index) => byte ^ (mask[index % 4] ?? 0)));

  return Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), Buffer.from(mask), masked]);
}

describe('the frames', () => {
  it('should unmask a client text frame and say how much of the buffer it used', () => {
    // Given one whole frame followed by the first byte of the next
    const frame = maskedTextFrame('{"id":"ord_2048"}', [1, 2, 3, 4]);
    const buffer = Buffer.concat([frame, Buffer.from([0x81])]);

    // When
    const decoded = decodeClientFrame(buffer);

    // Then
    expect(decoded?.opcode).toBe(0x1);
    expect(decoded?.payload).toBe('{"id":"ord_2048"}');
    expect(decoded?.consumed).toBe(frame.length);
  });

  it('should report that a frame has not fully arrived rather than reading a short one', () => {
    // Given, because a partial read that returned a payload would echo half a message
    const frame = maskedTextFrame('{"id":"ord_2048"}', [1, 2, 3, 4]);

    // When
    const decoded = decodeClientFrame(frame.subarray(0, frame.length - 3));

    // Then
    expect(decoded).toBeNull();
  });

  it('should refuse an unmasked client frame rather than accepting it', () => {
    // Given a frame written the way a server writes one, which a client may never send
    const frame = encodeTextFrame('hello');

    // When, Then
    expect(() => decodeClientFrame(frame)).toThrow('must be masked');
  });

  it('should write a server frame unmasked, with the length in the header', () => {
    // Given
    const frame = encodeTextFrame('hello');

    // Then
    expect(frame[0]).toBe(0x81);
    expect(frame[1]).toBe(5);
    expect(frame.subarray(2).toString('utf8')).toBe('hello');
  });
});
