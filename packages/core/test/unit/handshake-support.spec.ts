/**
 * `handshakeBlockedCause`, the platform fact SPEC 14.7 rests on.
 *
 * THE SUBJECT IS THE WHOLE UNION AND THE SUITE SAYS SO IN THE TYPE. The expectation below is a
 * total record over `IRSecuritySchemeType`, so a fifteenth scheme type arriving in the IR fails
 * this file's compile rather than shipping with an answer nobody chose. That is the mechanism
 * SPEC 8.2's thirteen row table already uses one level up, applied to the question this slice
 * added.
 */

import { describe, expect, it } from 'vitest';
import { handshakeBlockedCause, unsendableSchemeCause } from '../../src/index';
import type { HandshakeBlockedCause, IRSecuritySchemeType } from '../../src/index';

/**
 * What each of the fourteen types answers when it declares no location.
 *
 * `apiKey` AND `httpApiKey` ARE THE TWO WHOSE ANSWER IS NOT A CONSTANT, so the record holds what
 * they answer with nothing said, which is `undeclared`, and the location cases are separate.
 */
const BY_TYPE: Readonly<Record<IRSecuritySchemeType, HandshakeBlockedCause>> = {
  apiKey: 'undeclared',
  httpApiKey: 'undeclared',
  http: 'handshake-header',
  oauth2: 'handshake-header',
  openIdConnect: 'handshake-header',
  mutualTLS: 'transport-certificate',
  X509: 'transport-certificate',
  symmetricEncryption: 'message-encryption',
  asymmetricEncryption: 'message-encryption',
  userPassword: 'connection-credential',
  plain: 'connection-credential',
  scramSha256: 'connection-credential',
  scramSha512: 'connection-credential',
  gssapi: 'connection-credential',
};

describe('handshakeBlockedCause', () => {
  it('should answer for every one of the fourteen scheme types the IR knows', () => {
    // Given, the union as a total record, so a fifteenth member would not compile
    const types = Object.keys(BY_TYPE) as IRSecuritySchemeType[];

    // When
    const answers = types.map((type) => [type, handshakeBlockedCause({ type })] as const);

    // Then, the subject is present before anything is asserted about it
    expect(types).toHaveLength(14);
    expect(answers).toEqual(types.map((type) => [type, BY_TYPE[type]]));
  });

  it('should let a key in the query through, because the query is part of the address', () => {
    // Given
    const scheme = { type: 'apiKey', in: 'query', name: 'token' };

    // When
    const cause = handshakeBlockedCause(scheme);

    // Then
    expect(cause).toBeUndefined();
  });

  it('should let a key in a cookie through, because the browser sends it at the handshake itself', () => {
    // Given, the case where the two questions of this file disagree: `fetch` refuses a cookie
    // apiKey and a handshake carries it without the page taking part.
    const scheme = { type: 'apiKey', in: 'cookie', name: 'session' };

    // When
    const atHandshake = handshakeBlockedCause(scheme);
    const inARequest = unsendableSchemeCause(scheme);

    // Then
    expect(atHandshake).toBeUndefined();
    expect(inARequest).toBe('cookie-api-key');
  });

  it('should block a key in a header, which is the row SPEC 14.7 points at the bridge', () => {
    // Given
    const scheme = { type: 'httpApiKey', in: 'header', name: 'X-Api-Key' };

    // When
    const cause = handshakeBlockedCause(scheme);

    // Then
    expect(cause).toBe('handshake-header');
  });

  it('should read an AsyncAPI apiKey in the connection user field as a connection credential', () => {
    // Given, SPEC 8.2: AsyncAPI's `apiKey` substitutes into the user or the password of the
    // connection, and a browser socket has neither field.
    const asUser = { type: 'apiKey', in: 'user' };
    const asPassword = { type: 'apiKey', in: 'password' };

    // When
    const causes = [handshakeBlockedCause(asUser), handshakeBlockedCause(asPassword)];

    // Then
    expect(causes).toEqual(['connection-credential', 'connection-credential']);
  });

  it('should block a bearer token, which a request carries and a handshake cannot', () => {
    // Given, the other direction of the same disagreement
    const scheme = { type: 'http', scheme: 'bearer' };

    // When
    const atHandshake = handshakeBlockedCause(scheme);
    const inARequest = unsendableSchemeCause(scheme);

    // Then
    expect(atHandshake).toBe('handshake-header');
    expect(inARequest).toBeUndefined();
  });

  it('should answer undeclared for a scheme nothing declared, rather than defaulting to success', () => {
    // Given, what a requirement naming a scheme outside the document's table reaches this with,
    // which is the `unknown` the page already prints.
    const scheme = { type: 'unknown' };

    // When
    const cause = handshakeBlockedCause(scheme);

    // Then, a check that cannot establish the fact says so
    expect(cause).toBe('undeclared');
  });

  it('should answer undeclared for an apiKey whose location the document never wrote', () => {
    // Given, both spellings of nothing said
    const absent = { type: 'apiKey' };
    const empty = { type: 'httpApiKey', in: '' };

    // When
    const causes = [handshakeBlockedCause(absent), handshakeBlockedCause(empty)];

    // Then
    expect(causes).toEqual(['undeclared', 'undeclared']);
  });

  it('should refuse a location it cannot place rather than letting it become a query parameter', () => {
    // Given, a location outside the five the IR knows, which is what a later specification
    // edition would arrive as
    const scheme = { type: 'apiKey', in: 'body' };

    // When
    const cause = handshakeBlockedCause(scheme);

    // Then
    expect(cause).toBe('connection-credential');
  });
});
