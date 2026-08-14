/**
 * How a request runner reaches the headless layer.
 *
 * DEFINED HERE RATHER THAN IMPORTED, exactly as `ISearchPort` is and for the same reason: the
 * dependency rule of STANDARDS 3.5 gives this package one upstream, `core`, so `vue` cannot see
 * `@openref/runner` and must not. A `RequestRunner` from that package satisfies this port
 * structurally, so the runner is not made to know about the port either, and the two are proved
 * to agree wherever they are composed.
 *
 * THE PORT HOLDS THE CREDENTIALS. They are not a member of the send call, not a prop and not a
 * field of any page model, so nothing above the runner ever holds one. A component reads a
 * value back to fill its own field and writes one when the reader types; both go through here.
 */

import type {
  IRParameterLocation,
  IRParameterStyle,
  IRSecuritySchemeType,
  UnsendableCause,
} from '@openref/core';

/**
 * What kind of value a parameter's schema declares, per SPEC 14.2.
 *
 * IT IS THE PROJECTION'S ANSWER AND NOT THE CONSOLE'S GUESS. Which cell of the matrix a
 * parameter lands in depends on whether its value is a primitive, an array or an object, and
 * only the document knows; a console deciding from the shape of what a reader typed would put
 * `1,2` in a different cell depending on whether they used a comma.
 */
export type RunnerValueKind = 'primitive' | 'array' | 'object';

/** One parameter, reduced to what sending it requires. */
export interface RunnerParameterView {
  readonly name: string;
  readonly in: IRParameterLocation;
  readonly required: boolean;
  readonly style: IRParameterStyle;
  readonly explode: boolean;
  readonly allowReserved?: boolean;
  /** `allowEmptyValue` of OpenAPI, which is what lets a required parameter be sent empty. */
  readonly allowEmptyValue?: boolean;
  /** What the schema declares, so the console offers a field that can express it. */
  readonly valueKind: RunnerValueKind;
}

/**
 * One value the reader supplied, in one of the three kinds SPEC 14.2 names.
 *
 * The same shape `@openref/runner` serializes, restated here rather than imported because
 * STANDARDS 3.5 gives this package one upstream and it is not that one. An object is ordered
 * pairs and not a record for the reason SPEC 12 gives: a record with integer-like keys iterates
 * them in numeric order, and every exploded style puts field order into the request.
 */
export type RunnerValue =
  | { readonly kind: 'primitive'; readonly value: string }
  | { readonly kind: 'array'; readonly value: readonly string[] }
  | { readonly kind: 'object'; readonly value: readonly (readonly [string, string])[] };

/**
 * Which control a media type's body is filled in with, per SPEC 14.3.
 *
 * THREE EDITORS FOR SIX MEDIA TYPES, and the mapping is read off the schema rather than written
 * per type. `text` is a textarea, and JSON, ndjson and plain text differ only in what the runner
 * validates. `fields` is one control per declared property, which is what a urlencoded and a
 * multipart body are made of. `binary` is a file, and it is what an octet stream is.
 */
export type RunnerBodyEditor = 'text' | 'fields' | 'binary';

/** One field of a form body, as the console draws it. */
export interface RunnerBodyFieldView {
  readonly name: string;
  readonly required: boolean;
  /** `file` when the schema declares this property a binary string. */
  readonly kind: 'text' | 'file';
  /**
   * Content type of this part in a multipart body.
   *
   * From the operation's `encoding` where it declares one, and otherwise from the property's own
   * type by the rule OpenAPI states: a binary string is an octet stream, an object is JSON, and
   * anything else is plain text. That default is what makes a JSON part beside a file part
   * expressible without a document having to spell it out.
   *
   * THE DEFAULT IS THE ONLY PATH A NORMALIZED DOCUMENT REACHES TODAY. `IRMediaType.encoding` is
   * declared in the IR and the OpenAPI normalizer never fills it, found while writing T027 and
   * owned by T028's sweep since: `stripe.yaml` carries encoding blocks on hundreds of operations,
   * so filling the field moves the corpus digests. It is `T034` in `ai-docs/BUILD-AMENDMENTS.md`,
   * with done-when clauses, and the defect class is in SPEC 0 as declared but never filled.
   */
  readonly contentType?: string;
}

/** One media type an operation declares a body for, with what it takes to fill it in. */
export interface RunnerBodyMediaTypeView {
  readonly mediaType: string;
  readonly editor: RunnerBodyEditor;
  /** Empty unless the editor is `fields`. */
  readonly fields: readonly RunnerBodyFieldView[];
  /**
   * What the text editor arrives prefilled with, per `TX-PARITY-UI`: the declared example
   * first, the generated one second, the SPEC 5.5 precedence, so the bench works on a static
   * page. Absent for the other two editors and for a media type nothing can be generated
   * for. Optional so a hand-built view, a mock or a custom port's input, stays valid.
   */
  readonly exampleText?: string;
}

/**
 * A file the reader chose, as bytes rather than as a browser `File`.
 *
 * `Uint8Array<ArrayBuffer>` AND NOT THE DEFAULT, which is over `ArrayBufferLike` and so includes a
 * `SharedArrayBuffer`. A request body cannot be shared memory, the platform's `BodyInit` says so,
 * and with the loose type the browser's own `fetch` stops satisfying the transport this is
 * eventually handed to.
 */
export interface RunnerFile {
  readonly fileName: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

/** One named field of a form body, as the reader filled it in. */
export type RunnerBodyField =
  | {
      readonly kind: 'text';
      readonly name: string;
      readonly value: string;
      readonly contentType?: string;
    }
  | { readonly kind: 'file'; readonly name: string; readonly file: RunnerFile };

/**
 * What the reader supplied for the body, in one of the three forms of SPEC 14.3.
 *
 * The same shape `@openref/runner` encodes, restated here for the reason `RunnerValue` is: this
 * package has one upstream and it is not that one.
 */
export type RunnerBody =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'fields'; readonly fields: readonly RunnerBodyField[] }
  | { readonly kind: 'binary'; readonly file: RunnerFile };

/** The five OAuth2 flows of SPEC 14.4, keyed as OpenAPI keys them. */
export type RunnerOAuthFlowKind =
  'authorizationCode' | 'clientCredentials' | 'password' | 'implicit' | 'deviceAuthorization';

/**
 * One OAuth2 flow, reduced to the urls and scopes running it requires.
 *
 * A LIST RATHER THAN THE IR'S RECORD OF FOUR OPTIONAL MEMBERS, because a console offers one of
 * them and the answer to "which ones are there" should be a length rather than four checks.
 */
export interface RunnerOAuthFlowView {
  readonly kind: RunnerOAuthFlowKind;
  readonly authorizationUrl?: string;
  readonly tokenUrl?: string;
  readonly refreshUrl?: string;
  readonly deviceAuthorizationUrl?: string;
  /** Scope names, in the order the IR carries them, which is sorted by code point. */
  readonly scopes: readonly string[];
}

/** One security scheme, reduced to what sending it requires. */
export interface RunnerSecuritySchemeView {
  readonly id: string;
  readonly type: IRSecuritySchemeType;
  readonly in?: 'query' | 'header' | 'cookie';
  readonly name?: string;
  readonly scheme?: string;
  /** The flows an `oauth2` scheme declares, empty for every other type. */
  readonly flows: readonly RunnerOAuthFlowView[];
  /** Discovery document url, for `openIdConnect`. */
  readonly openIdConnectUrl?: string;
  /**
   * Why a browser cannot send this scheme, when it cannot.
   *
   * CARRIED IN THE PROJECTION SO THAT IT REACHES THE SERVER RENDERED PAGE. An unsupported scheme
   * that draws nothing is indistinguishable from a scheme the document never declared, which is
   * the failure `unsendableSchemeCause` in `@openref/core` exists to prevent; putting the answer
   * here means the explanation is in the markup a reader gets before any script runs. A cause and
   * not a sentence, because the words belong to whatever draws them.
   */
  readonly unsendableCause?: UnsendableCause;
}

/**
 * What a streaming operation needs before a console can watch it, per SPEC 14.6.
 *
 * IT IS ON THE PROJECTION AND NOT LOOKED UP FROM THE IR, for the reason the projection exists at
 * all: the page a reader loads carries this and not the document. The item schema is resolved to
 * a body here rather than left as a slot, because resolving one needs the document's schema map
 * and the browser has a bounded copy of it.
 */
export interface RunnerStreamView {
  /** Which wire format the response is read as. */
  readonly format: 'sse' | 'ndjson';
  /** The value that ends the stream normally, from `@ApiStream({ terminator })`. */
  readonly terminator?: string;
  /**
   * What each element is checked against, within the limits SPEC 14.6 names.
   *
   * Absent when the document declares no item schema, which is a stream a console can show and
   * cannot check. That absence is a `doctor` finding of its own and never a silent pass here.
   */
  readonly itemSchema?: StreamItemSchemaView;
}

/** The subset of a schema the bounded item check of SPEC 14.6 reads. */
export interface StreamItemSchemaView {
  readonly type?: string | readonly string[];
  readonly required?: readonly string[];
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly properties?: Readonly<Record<string, StreamItemSchemaView>>;
}

/** One element of a running stream, as whatever draws it receives it. */
export interface RunnerStreamElement {
  readonly seq: number;
  readonly data: string;
  readonly event?: string;
  readonly id?: string;
  /** Why this element does not match the declared item schema, when it does not. */
  readonly problem?: string;
}

/** Why a stream is no longer running. */
export type RunnerStreamEndReason =
  'complete' | 'terminator' | 'stopped' | 'timeout' | 'refused' | 'failed';

/** How a stream ended, and what it delivered before it did. */
export interface RunnerStreamEnd {
  readonly reason: RunnerStreamEndReason;
  readonly received: number;
  readonly invalid: number;
  readonly message?: string;
}

/** Where a running stream reports to. */
export interface RunnerStreamHandlers {
  readonly onElement: (element: RunnerStreamElement) => void;
  readonly onEnd?: (end: RunnerStreamEnd) => void;
}

/** A stream that is running, and the one thing that can be done to it. */
export interface RunnerStreamHandle {
  /** Aborts the request, which closes the connection rather than stopping the reading. */
  stop: () => void;
  /** Resolves once the stream has ended, whatever ended it. */
  readonly done: Promise<RunnerStreamEnd>;
}

/**
 * One operation, reduced to what sending it requires.
 *
 * A plain JSON projection rather than the IR node, so it travels inside a rendered page without
 * the document travelling with it. {@link runnerOperationOf} derives it from the IR.
 */
export interface RunnerOperationView {
  readonly nodeId: string;
  readonly method: string;
  readonly path: string;
  readonly parameters: readonly RunnerParameterView[];
  /** Server urls, the operation's own overrides first, else the document's. */
  readonly servers: readonly string[];
  readonly security: readonly RunnerSecuritySchemeView[];
  /**
   * Media types the request body is declared with, and how each one is filled in.
   *
   * IN THE ORDER THE IR CARRIES THEM, WHICH IS SORTED BY CODE POINT AND NOT THE DOCUMENT'S. The
   * normalizer sorts a content map, so `application/json` precedes `text/plain` whichever way
   * round the author wrote them. It matters because the console offers the first as the default,
   * and the sentence that used to be here said document order, which was never true.
   */
  readonly body: readonly RunnerBodyMediaTypeView[];
  /**
   * What it takes to watch this operation, when the application says it streams.
   *
   * ABSENT IS THE ANSWER FOR EVERY OPERATION THAT DOES NOT STREAM, and it is what a console reads
   * to decide whether to offer a Stream control at all. A control offered on every operation would
   * be a control that mostly opens a connection nothing will ever send down.
   */
  readonly stream?: RunnerStreamView;
}

/** One response header. */
export interface RunnerResultHeader {
  readonly name: string;
  readonly value: string;
}

/**
 * Something about the session that the response alone does not say, per SPEC 14.4.1.
 *
 * A 401 whose cause is an expired session never surfaces as a bare status code, because that is
 * the moment a reader concludes the endpoint is broken rather than their sign in.
 */
export interface RunnerNotice {
  readonly kind: 'renewed' | 'session-ended' | 'renew-failed';
  readonly message: string;
}

/** What came back, and how long it took. */
export interface RunnerResult {
  readonly status: number;
  readonly statusText: string;
  readonly headers: readonly RunnerResultHeader[];
  readonly body: string;
  readonly durationMs: number;
  /** What happened to the session while this request was being answered, when anything did. */
  readonly notice?: RunnerNotice;
}

/** What the reader supplied about an OAuth2 client. */
export interface RunnerOAuthClient {
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly scopes?: readonly string[];
  readonly username?: string;
  readonly password?: string;
}

/** What a device flow told the reader to do. */
export interface RunnerDeviceAuthorization {
  readonly userCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete?: string;
  readonly expiresInSeconds: number;
  readonly intervalSeconds: number;
}

/** What a sign in produced. */
export type RunnerSignInOutcome =
  | { readonly kind: 'signed-in' }
  | { readonly kind: 'redirect'; readonly url: string }
  | { readonly kind: 'device'; readonly device: RunnerDeviceAuthorization };

/** What one scheme's session looks like to whatever draws it. */
export interface RunnerSessionStatus {
  readonly signedIn: boolean;
  /** An estimate and never a gate: the authority on whether a token is alive is the API's 401. */
  readonly expiresAtMs?: number;
  readonly renewable: boolean;
}

/** One send: which operation, against which server, with what typed into it. */
export interface RunnerSendInput {
  readonly operation: RunnerOperationView;
  readonly serverUrl: string;
  /**
   * Parameter values keyed by `${location}:${name}`.
   *
   * A KEY THAT IS NOT THERE AND A KEY HOLDING AN EMPTY VALUE ARE DIFFERENT REQUESTS, per SPEC
   * 14.2. Until T026 this was `Record<string, string>` and the empty string had to mean both.
   */
  readonly values: Readonly<Record<string, RunnerValue>>;
  readonly body?: RunnerBody;
  readonly mediaType?: string;
}

/** A request runner, as the headless layer sees one. */
export interface IRunnerPort {
  /**
   * @param schemeId - Id of the security scheme
   * @returns The stored credential, or undefined when there is none
   */
  credential(schemeId: string): string | undefined;

  /**
   * @param schemeId - Id of the security scheme
   * @param value - The credential as the reader typed it, empty to clear it
   */
  setCredential(schemeId: string, value: string): void;

  /**
   * @param input - Operation, server and what the reader typed
   * @returns Status, headers, body and duration
   */
  send(input: RunnerSendInput): Promise<RunnerResult>;

  /**
   * Opens a streaming response, per SPEC 14.6.
   *
   * OPTIONAL FOR THE REASON THE OAUTH2 HALF IS: a host may compose a runner that sends requests
   * and cannot stream, and a console that finds no `stream` here says so rather than drawing a
   * control that does nothing.
   *
   * @param input - Operation, server and what the reader typed
   * @param handlers - Where elements and the ending are reported
   * @returns A way to stop it, and a promise for how it ended
   */
  stream?(input: RunnerSendInput, handlers: RunnerStreamHandlers): RunnerStreamHandle;

  /**
   * OPTIONAL, AND THE OPTIONALITY IS THE HONEST PART. A host may supply a runner that sends
   * requests and knows nothing about OAuth2, and the console says so rather than drawing a sign in
   * button that does nothing. `@openref/runner` implements all of them.
   *
   * @param schemeId - Id of the security scheme
   * @param flow - The flow the reader chose
   * @param client - Client id, secret and scopes as the reader supplied them
   * @param redirect - Where an authorization server returns the reader to, and where they were
   * @returns Whether the reader is signed in, has to be redirected, or has a code to enter
   */
  signIn?(
    schemeId: string,
    flow: RunnerOAuthFlowView,
    client: RunnerOAuthClient,
    redirect?: { readonly redirectUri: string; readonly returnPath: string },
  ): Promise<RunnerSignInOutcome>;

  /**
   * @param schemeId - Id of the security scheme
   * @returns Nothing, once the reader has approved the device and a token is in place
   */
  completeDeviceAuthorization?(schemeId: string): Promise<void>;

  /**
   * @param params - The callback parameters, from the query string or the fragment
   * @returns Which scheme was signed in and where the reader was, or undefined when nothing was
   *          pending on this page
   */
  completeAuthorization?(
    params: Readonly<Record<string, string>>,
  ): Promise<{ readonly schemeId: string; readonly returnPath: string } | undefined>;

  /**
   * @param openIdConnectUrl - The discovery document url the scheme declares
   * @returns The flows the provider advertises
   */
  discover?(openIdConnectUrl: string): Promise<readonly RunnerOAuthFlowView[]>;

  /**
   * @param schemeId - Id of the security scheme
   * @returns Whether there is a token, when it is estimated to run out, and whether it can renew
   */
  sessionStatus?(schemeId: string): RunnerSessionStatus;

  /**
   * @param schemeId - Id of the security scheme
   */
  signOut?(schemeId: string): void;
}
