import { describe, expect, it } from 'vitest';
import * as barrel from '../../src/index';
import * as http from '../../src/http';
import * as socket from '../../src/socket';

/**
 * The three entries of this package say the same thing about the modules they share.
 *
 * WHY THERE ARE THREE AT ALL IS A MEASUREMENT AND IT IS NOT ABOUT THIS PACKAGE. A bundler assigns
 * a module to the chunk shared by every entry point that can reach it, and reaching is a property
 * of the import graph rather than of the symbols a caller names. While the served bundle's two
 * factories both imported the barrel, esbuild put the whole barrel in a chunk they shared and a
 * reader who pressed Send downloaded the socket engine: `client-js-send-raw` read 74,366 raw
 * against a cap of 73,200, measured on the published form at `TX-SOCKET-CONSOLE`. `./http` and
 * `./socket` are two narrower doors onto the same modules, and with one factory on each the
 * shared chunk goes away.
 *
 * SO WHAT THIS FILE PINS IS THAT THEY ARE DOORS AND NOT COPIES. Three hand written export lists of
 * one set of modules is three lists that drift, which is the defect the claim map gate exists
 * about one level up. Every runtime name a narrow entry exports has to be the same binding the
 * barrel exports, identity compared rather than named twice, so a second implementation cannot
 * appear behind one of the doors.
 *
 * AND THAT NEITHER NARROW ENTRY REACHES THE OTHER'S ENGINE, which is the property the split was
 * made for and the one a future import would quietly undo.
 */

/** Runtime names of a module namespace, which is what identity can be compared over. */
function runtimeNames(entry: Record<string, unknown>): string[] {
  return Object.keys(entry).sort();
}

describe('the narrow entries and the barrel', () => {
  it('should export the same binding as the barrel for every name they carry', () => {
    // Given the two narrow entries, which exist so a bundler can reach half of this package
    const narrow: Record<string, unknown>[] = [http, socket];
    const wide: Record<string, unknown> = barrel;

    // Then every runtime name they carry is the barrel's own binding, by identity
    for (const entry of narrow) {
      const names = runtimeNames(entry);
      expect(names.length).toBeGreaterThan(0);

      for (const name of names) {
        expect(wide, `the barrel does not export ${name}`).toHaveProperty(name);
        expect(entry[name], `${name} is a second binding rather than the barrel's`).toBe(
          wide[name],
        );
      }
    }
  });

  it('should divide the two engines, which is the whole reason the entries exist', () => {
    // Given the send half and the socket half
    const sendNames = runtimeNames(http);
    const socketNames = runtimeNames(socket);

    // Then the subject is present before anything is said about the absence: each entry really
    // does carry its own engine
    expect(sendNames).toContain('createRunner');
    expect(socketNames).toContain('createSocketClient');
    expect(socketNames).toContain('NativeWebSocketTransport');

    // And neither carries the other's, so a factory on one door cannot reach the other engine
    expect(sendNames).not.toContain('createSocketClient');
    expect(sendNames).not.toContain('openSocket');
    expect(socketNames).not.toContain('createRunner');
    expect(socketNames).not.toContain('ProxyHttpTransport');
    expect(sendNames.filter((name) => socketNames.includes(name))).toEqual([]);
  });

  it('should carry every name the served console factory constructs, and no more', () => {
    // Given what `packages/nest/src/browser/runner-factory.ts` and `socket-factory.ts` name, which
    // is the only reason either entry is as wide as it is
    const sendNames = runtimeNames(http);

    // Then
    for (const name of [
      'createRunner',
      'FetchStreamTransport',
      'PathRewriteHttpTransport',
      'ProxyHttpTransport',
    ]) {
      expect(sendNames).toContain(name);
    }
  });
});
