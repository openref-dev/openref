/**
 * The harness both wire level suites drive a real client with.
 *
 * IT RECORDS BYTES AND NOT MEANINGS. The server keeps the request target as the request line
 * carried it, the header field values as they arrived, and the body as a buffer, so a comparison
 * made against it is between two wires and not between two interpretations of them.
 *
 * WHAT IS SHARED IS THE MECHANISM AND NOT THE VERDICT. Starting a loopback server and running a
 * command under `sh` is one question with one answer, so it lives here; what counts as the same
 * request differs per client, and each suite keeps its own comparison. Folding the verdicts
 * together would make a single relaxation in one of them quietly relax the other.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';

/** One request as the server saw it. */
export interface Wire {
  readonly method: string;
  readonly target: string;
  readonly headers: Readonly<Record<string, string>>;
  /**
   * Header values as octets rather than as text.
   *
   * NODE DECODES A FIELD VALUE AS LATIN-1, SO THE TEXT IT HANDS BACK IS A DECODING AND NOT THE
   * WIRE. The first edition of this comment claimed the two encodings of `café` compare equal as
   * text and that was false, as a blind review pointed out: `E9` decodes to `café` and `C3 A9`
   * decodes to `cafÃ©`, which are different strings. The real reason is narrower and still worth a
   * separate member. A comparison of decoded text is a comparison of what Node made of the octets,
   * one round trip away from what was sent, and an octet that is not valid on its own would come
   * back as something a case cannot reason about. `rawHeaders` carries the bytes themselves, so a
   * case that is about an encoding asserts the encoding.
   */
  readonly rawHeaders: Readonly<Record<string, Buffer>>;
  readonly body: Buffer;
}

/** What running one command produced. */
export interface ShellRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** A running loopback server and the requests it has recorded. */
export interface WireServer {
  readonly server: Server;
  readonly origin: string;
  /** Every request since the last {@link WireServer.reset}, in arrival order. */
  readonly seen: Wire[];
  reset(): void;
  close(): Promise<void>;
}

/** Reads the whole request body. */
async function bodyOf(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);

  return Buffer.concat(chunks);
}

/**
 * Starts a loopback server that records every request it receives.
 *
 * @returns The server, its origin and the list it records into
 */
export async function startWireServer(): Promise<WireServer> {
  const seen: Wire[] = [];

  const server = createServer((request, response) => {
    void (async () => {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        if (typeof value === 'string') headers[name] = value;
      }

      const rawHeaders: Record<string, Buffer> = {};
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        const name = (request.rawHeaders[index] ?? '').toLowerCase();
        rawHeaders[name] = Buffer.from(request.rawHeaders[index + 1] ?? '', 'latin1');
      }

      seen.push({
        method: request.method ?? '',
        target: request.url ?? '',
        headers,
        rawHeaders,
        body: await bodyOf(request),
      });

      // A REDIRECT IS A ROUTE RATHER THAN A MODE, so one server answers both kinds of case and no
      // suite has to start a second one. Only a target under `/redirect` is answered with a 302.
      if ((request.url ?? '').startsWith('/redirect')) {
        response.writeHead(302, { location: '/landed' }).end();
        return;
      }

      response.writeHead(204).end();
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');

  return {
    server,
    origin: `http://127.0.0.1:${String(address.port)}`,
    seen,
    reset: (): void => {
      seen.length = 0;
    },
    close: (): Promise<void> =>
      new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      ),
  };
}

/**
 * Runs one shell command and waits for it.
 *
 * A REAL SHELL AND NOT A PARSER OF THIS PROJECT'S OWN. Splitting the command in JavaScript and
 * replaying it would prove that an emitter agrees with a parser the same package wrote, which is
 * the shape of proof that lets both be wrong together. `sh -c` also puts the quoting under test.
 *
 * @param command - The command line, exactly as a sample prints it
 * @param cwd - Where to run it, so a sample naming a file finds one
 * @returns The exit code and both streams
 */
export function runShell(command: string, cwd: string): Promise<ShellRun> {
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', command], { cwd });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/**
 * Header fields a comparison between two clients may not hold against each other.
 *
 * THE LIST IS THE WHOLE OF THE EXEMPTION AND EVERY ENTRY HAS A REASON, which is the point of it
 * being a denylist rather than the allowlist it replaced. Until 2026-09-03 both wire suites compared
 * only the headers the plan named, so a client adding a header of its own was invisible by
 * construction: a second blind review found `Invoke-RestMethod` putting
 * `Content-Type: application/x-www-form-urlencoded` on a bodyless POST that the runner sends with no
 * content type at all, and no case could have caught it. That is SPEC 0's tenth class, a check whose
 * method excludes a class of defect so its silence cannot be told from absence.
 *
 * THE SEVEN ARE NOT ALL ONE KIND, AND CALLING THEM ALL IDENTITY OVERSTATED THE LIST. Four are
 * identity or addressing and cannot change what comes back: `user-agent` names the program, `host`
 * is derived from the address and is identical on both sides anyway, `connection` is hop by hop,
 * and `sec-fetch-mode` describes the caller's own context. Two are framing of the response body
 * rather than of the request: `accept` and `accept-encoding`, which change how a body is packed but
 * not which body it is.
 *
 * `accept-language` IS NEITHER, AND IT IS THE ONE HONEST QUALIFICATION ON THIS LIST. It is a
 * negotiation default, not identity, and a server is entitled to answer differently because of it:
 * the runner sends `*` and Swift was measured sending `en-US,en;q=0.9`, so a content negotiating
 * server could return a different representation to the sample than to the console. It is exempt
 * because no client here lets a caller suppress it and a comparison that failed on it would fail
 * every case forever; the cost is named rather than hidden, and it bounds what this suite proves.
 *
 * A DOCUMENT THAT NAMES ONE OF THE SEVEN IS STILL CAUGHT, which is what makes the exemption safe
 * and is verified rather than assumed. The exemption drops a field from the two-client comparison
 * only; the loop over `request.plan.headers` that runs after it holds both the runner and the tool
 * to the value the plan states, so a header parameter called `Accept-Language` is compared on both
 * sides exactly as any other is. A case pins that.
 *
 * `content-type` IS EXEMPT IN EXACTLY ONE PLACE, A MULTIPART BODY, AND THE CALLER HAS TO ASK FOR
 * IT. Everywhere else it is compared, which is what catches a client inventing one. The earlier
 * sentence here said it was never exempt; that was false of this harness on the day it was written,
 * because `curl-wire-equality.spec.ts` already passed it in for the multipart case. What the
 * exemption buys is that the field is not compared as a string, since the boundary inside it is
 * chosen by whoever frames the body and cannot match; what stands in its place is stronger than the
 * comparison it replaces on everything except the boundary: {@link withoutBoundary} holds the media
 * type and every other parameter of the field to the plan's, and the body is then compared part by
 * part. So a client adding `charset` to a multipart content type is caught, which the `startsWith`
 * form this replaced could not see.
 *
 * `content-length` IS EXEMPT IN EXACTLY TWO PLACES AND THE CALLER HAS TO ASK FOR IT, which is why it
 * is a parameter rather than a member of this list. It is framing rather than content, and it is
 * chosen by whoever frames the message: a request with no body may state `0` or state nothing, both
 * legal and both meaning the same thing, and the clients split on that with no way to be told
 * otherwise. A multipart body's length follows from a boundary the client picks, which is the one
 * difference this suite has always excused. Wherever there is a body the client did not frame
 * itself, it is compared, because there it is a fact about the content.
 */
export const CLIENT_IDENTITY_HEADERS: readonly string[] = [
  'accept',
  'accept-encoding',
  'accept-language',
  'connection',
  'host',
  'sec-fetch-mode',
  'user-agent',
];

/**
 * One content type with its `boundary` parameter taken off, so two framings can be compared.
 *
 * THE BOUNDARY IS THE WHOLE OF WHAT IS EXCUSED, AND THIS IS WHAT MAKES THAT TRUE RATHER THAN
 * CLAIMED. Whoever frames a multipart body picks its boundary, so the runner's and the tool's
 * differ by construction and no comparison of the field as a string can pass. Everything else in
 * the field is a fact about the content and is compared: the media type, and any parameter a client
 * added of its own.
 *
 * IT SPLITS ON `;` LIKE `boundaryOf` DOES, and the limit is the same one. A boundary written as a
 * quoted string containing a semicolon would be cut in the wrong place; no client here writes one,
 * and inventing a parameter parser for a form nothing produces would be a second implementation of
 * the grammar with nothing holding it to the first.
 *
 * @param contentType - The field as one side sent it
 * @returns The field with the boundary parameter removed, parameters otherwise in their order
 */
export function withoutBoundary(contentType: string): string {
  return contentType
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '' && !/^boundary=/iu.test(part))
    .join('; ');
}

/**
 * Every header of one request that is the request rather than the client that sent it.
 *
 * @param wire - One recorded request
 * @returns Field names lowercased, mapped to their values, minus client identity
 * @param extra - Field names this one comparison exempts for a reason it states
 */
export function comparableHeaders(
  wire: Wire,
  extra: readonly string[] = [],
): Readonly<Record<string, string>> {
  const exempt = new Set([...CLIENT_IDENTITY_HEADERS, ...extra]);
  const kept: Record<string, string> = {};

  for (const [name, value] of Object.entries(wire.headers)) {
    if (!exempt.has(name.toLowerCase())) kept[name.toLowerCase()] = value;
  }

  return kept;
}

/**
 * Whether a command line tool can be run here at all.
 *
 * A SUITE THAT CANNOT DETERMINE ITS FACT SAYS SO RATHER THAN PASSING, which is why this returns an
 * answer instead of throwing. cURL is required by its own suite because every machine this project
 * builds on has it; the five this guards, wget, HTTPie, PowerShell, Swift and Ruby, are not, so
 * their cases skip with the reason named rather than going green on a machine that proved nothing.
 *
 * @param probe - A command that succeeds when the tool is installed
 * @returns True when it ran and exited zero
 */
export async function toolIsRunnable(probe: string): Promise<boolean> {
  try {
    const run = await runShell(probe, process.cwd());

    return run.code === 0;
  } catch {
    return false;
  }
}
